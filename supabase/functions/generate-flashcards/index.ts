import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Allowed tags - AI must choose ONLY from these
const ALLOWED_TAGS = {
  organ: ['heart', 'lungs', 'kidneys', 'liver', 'brain', 'spinal cord', 'nerves', 'blood', 'vessels', 'gastrointestinal', 'muscle', 'bone', 'skin', 'eye', 'ear'],
  system: ['cardiovascular', 'respiratory', 'renal', 'neurology', 'endocrine', 'reproductive', 'haematology'],
  region: ['head & neck', 'thorax', 'abdomen', 'pelvis', 'upper limb', 'lower limb'],
  discipline: ['anatomy', 'physiology', 'pathology', 'pharmacology', 'histology', 'embryology', 'biochemistry', 'genetics', 'microbiology', 'immunology'],
  process: ['innervation', 'blood supply', 'conduction', 'circulation', 'ventilation', 'metabolism', 'hormones', 'acid-base', 'electrolytes', 'fluid balance', 'inflammation', 'nutrition'],
  clinical: ['diagnostics', 'treatment'],
}

const ALL_ALLOWED_TAGS = new Set(Object.values(ALLOWED_TAGS).flat())

const FLASHCARDS_PROMPT = `Generate high-yield medical Anki flashcards from the provided tagged lecture notes.

PRIMARY OBJECTIVE
Maximise active recall for exams using atomic, source-grounded cards.

CARD DESIGN RULES
1. One card = one concept only.
2. Front must be a precise, answerable recall question (<=10 seconds to answer).
3. No vague verbs ("describe/discuss/outline"), no MCQs, no case vignettes, no multi-part questions.
4. Back must contain answer content only (no restating the question).
5. Prefer concise noun-phrase style answers.
6. Use arrows/symbols where useful (->, up/down markers).
7. Max 5 lines per answer; split if needed.

GROUNDING RULES (CRITICAL)
1. Every card must be directly supported by the provided source bullets.
2. If a fact is not explicitly supported by source text, do not create that card.
3. Every card must include exactly one valid source pointer:
   - source.section_index (integer)
   - source.point_index (integer)

COVERAGE RULES
1. Prioritise: definitions, mechanisms/pathways, diagnostic thresholds/criteria, key contrasts, clinical associations, high-yield pharmacology.
2. Include confusion-buster cards for commonly mixed concepts where present in source.
3. Exclude low-yield trivia.
4. Epidemiology/statistics only if explicitly taught as a key examinable takeaway in source.

COUNT RULES
1. Target count should scale with source density:
   - Aim roughly 0.6-1.0 cards per meaningful source bullet
   - Minimum 20, maximum 50
2. Prefer fewer high-quality cards over forced low-quality cards.

LANGUAGE
Use UK English spelling.

OUTPUT (STRICT)
Return ONLY a JSON array:
[{"front":"Question?","back":"Answer","source":{"section_index":0,"point_index":0}}]`

// Validate and filter tags to only allowed values
function validateContentTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const tags = value
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((tag) => ALL_ALLOWED_TAGS.has(tag))

  // Deduplicate and limit to 5 tags max
  return [...new Set(tags)].slice(0, 5)
}

function clampConfidence(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function parseSourceMap(notesTaggedText: string) {
  const sectionTitles = new Map<number, string>()
  const sourceMap = new Map<string, { sectionTitle: string; pointText: string }>()

  const lines = String(notesTaggedText || '').split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const sectionMatch = line.match(/^Section\s+\[S(\d+)\]\s+(.+)$/)
    if (sectionMatch) {
      const sectionIndex = Number(sectionMatch[1])
      if (Number.isInteger(sectionIndex)) {
        sectionTitles.set(sectionIndex, sectionMatch[2].trim())
      }
      continue
    }

    const pointMatch = line.match(/^-+\s*\[S(\d+)P(\d+)\]\s+(.+)$/)
    if (pointMatch) {
      const sectionIndex = Number(pointMatch[1])
      const pointIndex = Number(pointMatch[2])
      if (!Number.isInteger(sectionIndex) || !Number.isInteger(pointIndex)) continue
      const pointText = pointMatch[3].trim()
      const sectionTitle = sectionTitles.get(sectionIndex) || `Section ${sectionIndex + 1}`
      sourceMap.set(`${sectionIndex}:${pointIndex}`, { sectionTitle, pointText })
    }
  }

  return sourceMap
}

// Keywords that strongly indicate embryology content
const EMBRYOLOGY_KEYWORDS = [
  'embryo', 'fetal', 'fetus', 'foetal', 'foetus', 'develop', 'primitive',
  'septum primum', 'septum secundum', 'foramen ovale', 'ductus',
  'truncus', 'bulbus', 'endocardial cushion', 'neural crest',
  'pharyngeal', 'branchial', 'somite', 'mesoderm', 'ectoderm', 'endoderm',
  'gastrulation', 'neurulation', 'organogenesis', 'morphogenesis',
  'day 21', 'day 28', 'week 4', 'week 5', 'week 6', 'week 7', 'week 8',
  'congenital', 'malformation', 'atresia', 'stenosis', 'defect'
]

// Fallback: extract tags from card content (section title, front, back)
function fallbackContentTagsFromCard(card: { front?: string; back?: string; sectionTitle?: string }): string[] {
  // Combine all text sources
  const allText = [
    String(card.sectionTitle || ''),
    String(card.front || ''),
    String(card.back || '')
  ].join(' ').toLowerCase()

  if (!allText.trim()) return []

  const matchedTags: string[] = []

  // Check for embryology keywords first (high priority)
  const hasEmbryologyContent = EMBRYOLOGY_KEYWORDS.some(keyword => allText.includes(keyword))
  if (hasEmbryologyContent) {
    matchedTags.push('embryology')
  }

  // Check if any allowed tag appears in the combined text
  for (const tag of ALL_ALLOWED_TAGS) {
    if (matchedTags.includes(tag)) continue // Skip if already added

    // For "ear", require it to be a standalone word to avoid "heart", "earliest" false positives
    if (tag === 'ear') {
      const earRegex = /\bear\b/
      if (earRegex.test(allText)) {
        matchedTags.push(tag)
      }
    } else if (allText.includes(tag)) {
      matchedTags.push(tag)
    }
  }

  return matchedTags.slice(0, 5)
}

// Legacy function name for compatibility - now delegates to improved version
function fallbackContentTagsFromSection(sectionTitle: string): string[] {
  return fallbackContentTagsFromCard({ sectionTitle })
}

// Process a single batch with retry logic
async function processBatchWithRetry(
  payload: any[],
  batchNumber: number,
  anthropicApiKey: string,
  maxRetries: number = 2
): Promise<any[] | null> {
  const prompt = `You are assigning CATEGORICAL STUDY TOPIC tags to medical flashcards.

You MUST choose tags ONLY from the predefined list below. Do NOT invent new tags.

ALLOWED TAGS BY CATEGORY:

Organ: heart, lungs, kidneys, liver, brain, spinal cord, nerves, blood, vessels, gastrointestinal, muscle, bone, skin, eye, ear (the auditory organ)

System: cardiovascular, respiratory, renal, neurology, endocrine, reproductive, haematology

Region: head & neck, thorax, abdomen, pelvis, upper limb, lower limb

Discipline: anatomy, physiology, pathology, pharmacology, histology, embryology, biochemistry, genetics, microbiology, immunology

Process: innervation, blood supply, conduction, circulation, ventilation, metabolism, hormones, acid-base, electrolytes, fluid balance, inflammation, nutrition

Clinical: diagnostics, treatment (only use when clearly relevant)

RULES:
1. Choose the MOST appropriate tag from each relevant category
2. Generally use only ONE tag per category unless content clearly overlaps
3. Typical cards need 2-4 tags total (e.g., one organ + one discipline)
4. Clinical tags only when the card is specifically about diagnosis or treatment
5. All tags must be lowercase and match the allowed list EXACTLY
6. Tags refer to SEMANTIC MEANING, not substring matches. "ear" means the auditory organ only, NOT words containing "ear" like "earliest" or "heart"
7. Content about embryonic/fetal development, organ formation, or developmental defects should include "embryology"
8. "pathology" means disease mechanisms, causes, and pathophysiology - NOT treatments. Cards about interventions, drugs, or management should use "treatment" (and "pharmacology" if drug-related), NOT "pathology"
9. Do NOT combine "treatment" with "pathology" unless the card explicitly discusses both disease mechanism AND its treatment

OUTPUT FORMAT (STRICT):
Return a JSON array where each object has these REQUIRED fields:
- "index": integer (REQUIRED - copy the exact index from the input card)
- "content_tags": array of strings (tags from allowed list only)
- "confidence_content": number between 0 and 1

Example output for 3 cards:
[
  {"index": 0, "content_tags": ["heart", "embryology"], "confidence_content": 0.95},
  {"index": 1, "content_tags": ["heart", "anatomy", "circulation"], "confidence_content": 0.9},
  {"index": 2, "content_tags": ["kidneys", "physiology", "acid-base"], "confidence_content": 0.85}
]

IMPORTANT: You MUST include the "index" field for EVERY card, copying it from the input.

Input cards:
${JSON.stringify(payload)}`

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delayMs = Math.pow(2, attempt - 1) * 500 // 500ms, 1000ms, 2000ms...
        console.log(`[TagSuggestion] Batch ${batchNumber} - Retry ${attempt}/${maxRetries} after ${delayMs}ms delay`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: 'You are a precise semantic tagger. Output strict JSON only.',
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - API error: ${response.status}`, errorData)
        // Don't retry on auth errors (401, 403) or billing errors (402)
        if (response.status === 401 || response.status === 402 || response.status === 403) {
          throw new Error(errorData?.error?.message || `Tagger Claude API error: ${response.status}`)
        }
        continue // Retry on other errors
      }

      const data = await response.json()
      const rawText = data.content?.[0]?.text || ''
      console.log(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - Response length: ${rawText.length}`)

      const jsonMatch = rawText.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.warn(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - No JSON array found. Raw: ${rawText.slice(0, 300)}`)
        continue // Retry
      }

      let parsed: any[] = []
      try {
        parsed = JSON.parse(jsonMatch[0])
        console.log(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - Parsed ${parsed.length} items`)
        return parsed // Success!
      } catch (parseError) {
        console.warn(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - JSON parse failed, attempting recovery...`)
        const candidate = jsonMatch[0]
        const lastComplete = candidate.lastIndexOf('}')
        if (lastComplete >= 0) {
          try {
            parsed = JSON.parse(`${candidate.slice(0, lastComplete + 1)}]`)
            console.log(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - Recovery succeeded, parsed ${parsed.length} items`)
            return parsed // Success with recovery!
          } catch (recoveryError) {
            console.error(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - Recovery parse also failed`)
          }
        }
        continue // Retry
      }
    } catch (error) {
      console.error(`[TagSuggestion] Batch ${batchNumber} attempt ${attempt} - Exception:`, error)
      if (attempt === maxRetries) {
        throw error // Re-throw on final attempt
      }
    }
  }

  console.warn(`[TagSuggestion] Batch ${batchNumber} - All ${maxRetries} attempts failed, returning null`)
  return null
}

async function suggestTagsForCards(cards: any[], anthropicApiKey: string) {
  console.log(`[TagSuggestion] Starting tag suggestions for ${cards?.length || 0} cards`)

  if (!Array.isArray(cards) || cards.length === 0) {
    console.log('[TagSuggestion] No cards to process, returning early')
    return cards
  }

  const batchSize = 5
  const mergedSuggestions = new Map<number, any>()

  for (let i = 0; i < cards.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(cards.length / batchSize)
    console.log(`[TagSuggestion] Processing batch ${batchNumber}/${totalBatches} (cards ${i} to ${Math.min(i + batchSize - 1, cards.length - 1)})`)

    const batch = cards.slice(i, i + batchSize)
    const payload = batch.map((card, localIndex) => ({
      index: i + localIndex,
      front: String(card.front || '').slice(0, 280),
      back: String(card.back || '').slice(0, 420),
      section_title: String(card.sectionTitle || '').slice(0, 140),
      source_point_text: String(card.sourcePointText || '').slice(0, 320),
    }))

    console.log(`[TagSuggestion] Batch ${batchNumber} payload sample:`, JSON.stringify(payload[0]).slice(0, 200))

    let parsed: any[] | null = null
    try {
      parsed = await processBatchWithRetry(payload, batchNumber, anthropicApiKey, 2)
    } catch (error) {
      console.error(`[TagSuggestion] Batch ${batchNumber} - Fatal error, skipping batch:`, error)
    }

    if (!parsed || parsed.length === 0) {
      console.warn(`[TagSuggestion] Batch ${batchNumber} - No results, cards ${i}-${Math.min(i + batchSize - 1, cards.length - 1)} will use fallback`)
      continue
    }

    let matchedCount = 0
    let inferredCount = 0

    for (let itemIdx = 0; itemIdx < parsed.length; itemIdx++) {
      const item = parsed[itemIdx]
      let cardIndex = Number(item?.index)
      let indexSource = 'explicit'

      // If AI didn't return a valid index, infer from array position + batch offset
      if (!Number.isInteger(cardIndex)) {
        cardIndex = i + itemIdx  // batch start offset + position in parsed array
        indexSource = 'inferred'
        console.log(`[TagSuggestion] Batch ${batchNumber} - Item ${itemIdx} missing index, inferring as card ${cardIndex}`)
        inferredCount++
      }

      // Validate the index is within bounds
      if (cardIndex < 0 || cardIndex >= cards.length) {
        console.warn(`[TagSuggestion] Batch ${batchNumber} - Card index ${cardIndex} out of bounds (0-${cards.length - 1}), skipping`)
        continue
      }

      const validatedTags = validateContentTags(item?.content_tags)
      console.log(`[TagSuggestion] Card ${cardIndex} (${indexSource}) - Raw tags: ${JSON.stringify(item?.content_tags)} → Validated: ${JSON.stringify(validatedTags)}`)
      mergedSuggestions.set(cardIndex, {
        contentTags: validatedTags,
        confidence: {
          content: clampConfidence(item?.confidence_content),
        },
      })
      matchedCount++
    }
    console.log(`[TagSuggestion] Batch ${batchNumber} complete: ${matchedCount} matched (${inferredCount} with inferred index)`)
  }

  console.log(`[TagSuggestion] All batches complete. Total suggestions: ${mergedSuggestions.size}/${cards.length}`)

  const suggestedAt = new Date().toISOString()
  let fallbackCount = 0
  let successCount = 0

  const result = cards.map((card, index) => {
    const suggestion = mergedSuggestions.get(index)
    if (!suggestion) {
      const fallbackTags = fallbackContentTagsFromCard(card)
      console.log(`[TagSuggestion] Card ${index} - No AI suggestion, using fallback from card content → tags: ${JSON.stringify(fallbackTags)}`)
      fallbackCount++
      return {
        ...card,
        aiTagSuggestions: {
          status: 'pending',
          contentTags: fallbackTags,
          confidence: { content: 0.2 },
        },
        tagsLastSuggestedAt: suggestedAt,
      }
    }
    successCount++
    return {
      ...card,
      aiTagSuggestions: {
        status: 'pending',
        ...suggestion,
      },
      tagsLastSuggestedAt: suggestedAt,
    }
  })

  console.log(`[TagSuggestion] Final results: ${successCount} AI-tagged, ${fallbackCount} fallback`)
  return result
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      throw new Error('Invalid or expired token')
    }

    const { notes_tagged_text, lecture_title, module_abbreviation } = await req.json()
    if (!notes_tagged_text || !String(notes_tagged_text).trim()) {
      throw new Error('No tagged notes text provided')
    }
    const sourceMap = parseSourceMap(String(notes_tagged_text))

    const cardsPrompt = `${FLASHCARDS_PROMPT}\n\nLECTURE NOTES WITH SOURCE IDS:\n${String(notes_tagged_text).trim()}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: 'You are a strict, source-grounded medical flashcard generator. Output JSON only.',
        messages: [{ role: 'user', content: cardsPrompt }],
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || `Claude API error: ${response.status}`)
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    const jsonMatch = rawText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('No JSON array found in model response')
    }

    let parsed: any[] = []
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      const candidate = jsonMatch[0]
      const lastComplete = candidate.lastIndexOf('}')
      if (lastComplete < 0) throw new Error('Failed to parse flashcards JSON')
      parsed = JSON.parse(`${candidate.slice(0, lastComplete + 1)}]`)
    }

    let cards = parsed
      .map((card) => {
        const front = String(card?.front || card?.q || card?.question || '').trim()
        const back = String(card?.back || card?.a || card?.answer || '').trim()
        const sourceSectionIndex = Number(card?.source?.section_index)
        const sourcePointIndex = Number(card?.source?.point_index)

        const baseCard: any = {
          front,
          back,
          tags: '',
        }

        if (Number.isInteger(sourceSectionIndex) && Number.isInteger(sourcePointIndex)) {
          const sourceEntry = sourceMap.get(`${sourceSectionIndex}:${sourcePointIndex}`)
          baseCard.sourceSectionIndex = sourceSectionIndex
          baseCard.sourcePointIndex = sourcePointIndex
          baseCard.sectionTitle = sourceEntry?.sectionTitle || `Section ${sourceSectionIndex + 1}`
          baseCard.sourcePointText = sourceEntry?.pointText || ''
        }

        return baseCard
      })
      .filter((card) => card.front && card.back && Number.isInteger(card.sourcePointIndex))
      .slice(0, 50)

    try {
      cards = await suggestTagsForCards(cards, anthropicApiKey)
    } catch (tagError) {
      console.warn('Tag suggestion stage failed, returning cards without aiTagSuggestions:', tagError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        cards,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('generate-flashcards error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

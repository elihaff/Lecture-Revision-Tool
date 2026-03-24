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

interface TagInputCard {
  index: number
  front: string
  back: string
  section_title?: string
  source_point_text?: string
}

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

function buildPrompt(cards: TagInputCard[]) {
  const serialized = cards.map((card) => ({
    index: card.index,
    front: card.front,
    back: card.back,
    section_title: card.section_title || '',
    source_point_text: card.source_point_text || '',
  }))

  return `You are assigning CATEGORICAL STUDY TOPIC tags to medical flashcards.

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
- "confidence": number between 0 and 1

Example output for 3 cards:
[
  {"index": 0, "content_tags": ["heart", "embryology"], "confidence": 0.95},
  {"index": 1, "content_tags": ["heart", "anatomy", "circulation"], "confidence": 0.9},
  {"index": 2, "content_tags": ["kidneys", "physiology", "acid-base"], "confidence": 0.85}
]

IMPORTANT: You MUST include the "index" field for EVERY card, copying it from the input.

Input cards:
${JSON.stringify(serialized)}`
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

    const { cards } = await req.json()
    if (!Array.isArray(cards) || cards.length === 0) {
      throw new Error('cards array is required')
    }

    const inputCards: TagInputCard[] = cards
      .map((card: any, idx: number) => ({
        index: Number.isInteger(card?.index) ? card.index : idx,
        front: String(card?.front || '').trim(),
        back: String(card?.back || '').trim(),
        section_title: String(card?.section_title || '').trim(),
        source_point_text: String(card?.source_point_text || '').trim(),
      }))
      .filter((card) => card.front.length > 0 && card.back.length > 0)

    if (inputCards.length === 0) {
      throw new Error('No valid cards provided')
    }

    const prompt = buildPrompt(inputCards)

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
        system: 'You are a precise semantic tagger. Output strict JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData?.error?.message || `Claude API error: ${response.status}`)
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
      // Attempt to recover from truncated trailing output.
      const candidate = jsonMatch[0]
      const lastComplete = candidate.lastIndexOf('}')
      if (lastComplete < 0) throw new Error('Failed to parse tag suggestions JSON')
      parsed = JSON.parse(`${candidate.slice(0, lastComplete + 1)}]`)
    }

    const suggestions = parsed
      .map((item) => {
        const index = Number(item?.index)
        if (!Number.isInteger(index)) return null
        return {
          index,
          content_tags: validateContentTags(item?.content_tags),
          confidence: clampConfidence(item?.confidence),
        }
      })
      .filter(Boolean)

    return new Response(
      JSON.stringify({ success: true, suggestions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('suggest-flashcard-tags error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

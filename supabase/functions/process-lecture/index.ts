import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProcessRequest {
  lecture_id: string
  file_path: string
  user_learning_objectives?: string
}

interface LearningObjective {
  id: string
  text: string
  completed: boolean
}

interface NoteSection {
  section: string
  points: string[]
  pointLevels?: number[]
}

interface GeneratedNoteItem {
  text?: string
  children?: GeneratedNoteItem[]
}

interface GeneratedNoteSection {
  section?: string
  items?: GeneratedNoteItem[]
  points?: string[]
  pointLevels?: number[]
}

interface NotesResult {
  title: string
  learningObjectives: string[]
  notes: GeneratedNoteSection[]
}

function normalizePointLevels(rawLevels: unknown, pointsLength: number) {
  const input = Array.isArray(rawLevels) ? rawLevels : []
  const normalized = Array.from({ length: pointsLength }, (_, idx) => {
    const raw = Number(input[idx] ?? 0)
    if (!Number.isFinite(raw)) return 0
    return Math.max(0, Math.floor(raw))
  })

  for (let i = 1; i < normalized.length; i++) {
    normalized[i] = Math.min(normalized[i], normalized[i - 1] + 1)
  }
  return normalized
}

function inferPointLevels(points: string[]) {
  const levels = Array(points.length).fill(0)
  let activeParentIndex: number | null = null

  const isHeaderLike = (text: string) => {
    const clean = String(text || '').trim()
    if (!clean) return false
    if (clean.endsWith(':')) return true
    // Short conceptual lead-ins are often parent bullets.
    const words = clean.split(/\s+/).filter(Boolean)
    return words.length <= 5 && !/[.!?]$/.test(clean) && !clean.includes('→')
  }

  const startsNewParent = (text: string) => isHeaderLike(text)

  for (let i = 0; i < points.length; i++) {
    const current = String(points[i] || '').trim()
    if (!current) continue

    if (startsNewParent(current)) {
      levels[i] = 0
      activeParentIndex = i
      continue
    }

    if (activeParentIndex !== null) {
      const prev = String(points[i - 1] || '').trim()
      const prevWasHeader = i - 1 === activeParentIndex || isHeaderLike(prev)
      // Keep children grouped under current parent until next clear parent appears.
      if (prevWasHeader || levels[i - 1] > 0) {
        levels[i] = 1
        continue
      }
    }

    levels[i] = 0
    activeParentIndex = null
  }

  return levels
}

function flattenGeneratedItems(
  rawItems: unknown,
  level = 0,
  points: string[] = [],
  pointLevels: number[] = []
) {
  if (!Array.isArray(rawItems)) {
    return { points, pointLevels }
  }

  for (const rawItem of rawItems) {
    if (typeof rawItem === 'string') {
      const text = rawItem.trim()
      if (text) {
        points.push(text)
        pointLevels.push(level)
      }
      continue
    }

    if (!rawItem || typeof rawItem !== 'object') continue

    const text = String((rawItem as { text?: unknown }).text ?? '').trim()
    if (text) {
      points.push(text)
      pointLevels.push(level)
    }

    const children = (rawItem as { children?: unknown }).children
    if (Array.isArray(children) && level < 6) {
      flattenGeneratedItems(children, level + 1, points, pointLevels)
    }
  }

  return { points, pointLevels }
}

function normalizeGeneratedSections(rawSections: unknown): NoteSection[] {
  const sections = Array.isArray(rawSections) ? rawSections : []
  return sections.map((section: GeneratedNoteSection, sectionIndex: number) => {
    const fromItems = flattenGeneratedItems(section?.items)
    const hasStructuredItems = fromItems.points.length > 0
    const points = hasStructuredItems
      ? fromItems.points
      : (Array.isArray(section?.points)
          ? section.points.map((p: unknown) => String(p ?? '').trim()).filter((p: string) => p.length > 0)
          : [])
    const suppliedLevels = hasStructuredItems
      ? normalizePointLevels(fromItems.pointLevels, points.length)
      : normalizePointLevels(section?.pointLevels, points.length)
    const inferredLevels = inferPointLevels(points)
    const nonZeroSupplied = suppliedLevels.reduce((sum, lvl) => sum + (lvl > 0 ? 1 : 0), 0)
    const nonZeroInferred = inferredLevels.reduce((sum, lvl) => sum + (lvl > 0 ? 1 : 0), 0)
    const pointLevels = nonZeroSupplied >= nonZeroInferred ? suppliedLevels : inferredLevels

    return {
      section: String(section?.section || `${sectionIndex + 1}. Section`),
      points,
      pointLevels
    }
  })
}

function clampPointLevelJumps(levels: number[]) {
  const normalized = levels.slice()
  for (let i = 0; i < normalized.length; i++) {
    const raw = Number(normalized[i] ?? 0)
    normalized[i] = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
    if (i > 0) {
      normalized[i] = Math.min(normalized[i], normalized[i - 1] + 1)
    }
  }
  return normalized
}

function normalizeSectionHeading(text: string) {
  const clean = String(text || '')
    .replace(/^\s*\d+[\.\)]\s*/, '')
    .trim()
  if (!clean) return 'Detail:'
  return /[:.!?]$/.test(clean) ? clean : `${clean}:`
}

function sectionWordCount(section: string) {
  return String(section || '').trim().split(/\s+/).filter(Boolean).length
}

function isLikelyMicroSection(section: NoteSection) {
  const title = String(section?.section || '').trim()
  const pointsCount = Array.isArray(section?.points) ? section.points.length : 0
  if (!title) return true
  if (pointsCount >= 5) return false
  const words = sectionWordCount(title)
  if (title.endsWith(':')) return true
  if (words <= 7 && pointsCount <= 4) return true
  return false
}

function mergeSectionIntoPrevious(sections: NoteSection[], index: number) {
  if (index <= 0 || index >= sections.length) return false
  const parent = sections[index - 1]
  const child = sections[index]
  if (!parent || !child) return false

  const mergedPoints = Array.isArray(parent.points) ? parent.points.slice() : []
  const mergedLevels = clampPointLevelJumps(normalizePointLevels(parent.pointLevels, mergedPoints.length))

  mergedPoints.push(normalizeSectionHeading(child.section))
  mergedLevels.push(0)

  const childPoints = Array.isArray(child.points) ? child.points : []
  const childLevels = clampPointLevelJumps(normalizePointLevels(child.pointLevels, childPoints.length))
  for (let i = 0; i < childPoints.length; i++) {
    mergedPoints.push(childPoints[i])
    mergedLevels.push(Math.max(1, childLevels[i] + 1))
  }

  parent.points = mergedPoints
  parent.pointLevels = clampPointLevelJumps(mergedLevels)
  sections.splice(index, 1)
  return true
}

function consolidationScore(section: NoteSection) {
  const pointsCount = Array.isArray(section?.points) ? section.points.length : 0
  const words = sectionWordCount(section.section)
  const title = String(section?.section || '').trim()
  let score = pointsCount * 10 + Math.min(words, 10) * 2
  if (title.endsWith(':')) score -= 4
  if (pointsCount <= 2) score -= 5
  if (words <= 5) score -= 3
  return score
}

function consolidateSections(inputSections: NoteSection[], targetMaxSections = 15) {
  const sections = inputSections.map((section, idx) => {
    const points = Array.isArray(section?.points) ? section.points.filter(Boolean) : []
    const pointLevels = clampPointLevelJumps(normalizePointLevels(section?.pointLevels, points.length))
    return {
      section: String(section?.section || `${idx + 1}. Section`),
      points,
      pointLevels
    }
  })

  for (let i = 1; i < sections.length; ) {
    if (isLikelyMicroSection(sections[i])) {
      mergeSectionIntoPrevious(sections, i)
      continue
    }
    i++
  }

  while (sections.length > targetMaxSections) {
    let candidateIndex = -1
    let candidateScore = Number.POSITIVE_INFINITY
    for (let i = 1; i < sections.length; i++) {
      const score = consolidationScore(sections[i])
      if (score < candidateScore) {
        candidateScore = score
        candidateIndex = i
      }
    }
    if (candidateIndex < 1) break
    if (!mergeSectionIntoPrevious(sections, candidateIndex)) break
  }

  return sections
}

// Full notes generation prompt from the existing tool
const NOTES_PROMPT = `You are to summarise my medical school lecture slides into concise, high-density revision notes.

Follow all rules exactly.

⸻

CORE GOAL

Produce notes that are:
• Maximally information-dense
• Easy to visually process
• Complete (no important details from the slides may be omitted)
• Understandable even to someone not yet expert, while still exam-level

The notes should feel like an expert-compressed version of the lecture, not a paraphrase.

⸻

CONTENT RULES
• Include all examinable mechanisms, structures, definitions, pathways, thresholds, and distinctions from the slides
• Do not oversummarise at the expense of missing details
• Rewrite content concisely, but preserve every causal link and logical step
• Integrate related points together under the correct conceptual heading
• Exclude anecdotal commentary, filler text, and slide narration

⸻

VISUAL PROCESSING RULES (CRITICAL)
• Keep sentences short and direct
• Prefer compact phrases over prose
• Use directional arrows consistently:

Cause → Effect
↓ / ↑ for decrease or increase
⇄ for balance or reciprocity

Examples:
• ↓ insulin → ↑ lipolysis → ↑ ketogenesis → metabolic acidosis
• ↑ T3/T4 → ↑ β-adrenergic receptor expression → ↑ heart rate
• When describing regulation, always make directionality explicit
• Avoid vague wording like "affects", "influences", or "involved in"

⸻

DENSITY WITHOUT CONFUSION
• Notes should be as compressed as possible while remaining readable
• If a concept is complex, break it into stacked bullet points rather than long sentences
• Group related mechanisms together to minimise repetition
• Prefer cause-effect chains over narrative explanation

⸻

STRUCTURAL INTELLIGENCE
• CRITICAL: Preserve the overall flow and order of the lecture - this sequencing is pedagogically intentional
• Sections should appear in roughly the same order as the lecture presents topics
• Prefer approximately 10-15 major sections for a typical lecture, and represent subtopics as nested bullets using pointLevels instead of creating extra sections
• If the lecture covers Topic A then Topic B, do not reorganise to mix them or place Topic B content before Topic A
• Within each topic/section, you may group related points logically
• If content about a specific topic (e.g. future therapies for Disease X) appears in that topic's section in the lecture, keep it there - do not combine it with similar content from other topics
• Place mechanisms next to their consequences
• Place definitions immediately before usage
• Make contrasts explicit where exam-relevant
• When in doubt about ordering, follow the lecture's sequence

⸻

LANGUAGE RULES
• Use precise medical terminology
• No rhetorical questions
• No conversational tone
• No redundancy

⸻

FINAL RULE

Before finishing, internally verify that:
• Every learning objective is fully addressed
• No mechanism, value, structure, or regulatory step from the slides is missing
• The notes can be skimmed rapidly and read slowly with full comprehension

The final output should read like expert-level, visually optimised revision notes designed for high-stakes exams.

⸻

IMPORTANT: Return ONLY valid JSON in this exact format:
{"title": "Lecture Title", "learningObjectives": ["LO1", "LO2"], "notes": [{"section": "1. Section Title", "items": [{"text": "**Key term**: concise explanation", "children": [{"text": "Further detail linked to previous point"}]}, {"text": "↓ cause → ↑ effect"}]}]}

JSON FORMATTING RULES (CRITICAL):
• Escape ALL backslashes (\\) as double backslash (\\\\)
• Escape ALL double quotes (") inside content using backslash (\\")
• Do NOT include actual newlines - keep each point on one line
• Ensure every string is properly closed
• All arrays must be properly closed with ]
• The output must be valid, parseable JSON with double quotes only
• Only use valid JSON escape sequences: \\\\ \\" \\n \\t

Do NOT include bullet point characters (• or -) in item text - the UI adds those automatically.
Use items/children to encode nesting:
• notes[].items[] are main bullets
• item.children[] are sub-bullets
• children can nest recursively for deeper levels
Every parent bullet that introduces a themed list should include children.
Use **asterisks** for key terms. Use UK English spelling.`

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse request body
    const { lecture_id, file_path, user_learning_objectives }: ProcessRequest = await req.json()

    if (!lecture_id || !file_path) {
      throw new Error('Missing lecture_id or file_path')
    }

    // Parse user-provided learning objectives if present
    const userObjectives = user_learning_objectives
      ? user_learning_objectives
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
      : []

    // Download PDF from Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('lecture-pdfs')
      .download(file_path)

    if (downloadError) {
      throw new Error(`Failed to download PDF: ${downloadError.message}`)
    }

    // Convert to base64
    const arrayBuffer = await fileData.arrayBuffer()
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    )

    // Get Anthropic API key
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    // Build prompt with user learning objectives if provided
    let finalPrompt = NOTES_PROMPT
    if (userObjectives.length > 0) {
      const loSection = `\n\nIMPORTANT: The user has provided these learning objectives for this lecture. Use these EXACTLY as the learningObjectives in your response:\n${userObjectives.join('\n')}\n\nStructure your notes to address these learning objectives.`
      finalPrompt = NOTES_PROMPT + loSection
    }

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: finalPrompt,
            },
          ],
        }],
      }),
    })

    if (!claudeResponse.ok) {
      const errorData = await claudeResponse.json()
      throw new Error(`Claude API error: ${errorData.error?.message || 'Unknown error'}`)
    }

    const claudeData = await claudeResponse.json()
    const rawText = claudeData.content?.[0]?.text || ''

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No valid JSON found in Claude response')
    }

    let parsedResult: NotesResult
    try {
      parsedResult = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      throw new Error('Failed to parse Claude response as JSON')
    }

    // Transform learning objectives to our format with IDs
    const learningObjectives: LearningObjective[] = (parsedResult.learningObjectives || []).map((text) => ({
      id: crypto.randomUUID(),
      text,
      completed: false,
    }))

    // Store the notes structure
    const notesData = {
      title: parsedResult.title || 'Untitled Lecture',
      notes: consolidateSections(normalizeGeneratedSections(parsedResult.notes)),
    }

    // Update lecture in database
    const { error: updateError } = await supabase
      .from('lectures')
      .update({
        learning_objectives: learningObjectives,
        notes: notesData,
        notes_generated: true,
        processed_at: new Date().toISOString(),
        pdf_path: file_path,
        phase: 'learn', // Move to learn phase after processing
      })
      .eq('id', lecture_id)

    if (updateError) {
      throw new Error(`Failed to update lecture: ${updateError.message}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        title: notesData.title,
        learning_objectives: learningObjectives,
        notes: notesData.notes,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Process lecture error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

// Supabase Edge Function to generate notes from PDF using Claude API
// This keeps the API key secure on the server side

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const words = clean.split(/\s+/).filter(Boolean)
    return words.length <= 5 && !/[.!?]$/.test(clean) && !clean.includes('→')
  }

  for (let i = 0; i < points.length; i++) {
    const current = String(points[i] || '').trim()
    if (!current) continue

    if (isHeaderLike(current)) {
      levels[i] = 0
      activeParentIndex = i
      continue
    }

    if (activeParentIndex !== null) {
      const prev = String(points[i - 1] || '').trim()
      const prevWasHeader = i - 1 === activeParentIndex || isHeaderLike(prev)
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

function normalizeGeneratedSections(rawSections: unknown) {
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

function isLikelyMicroSection(section: { section: string; points: string[] }) {
  const title = String(section?.section || '').trim()
  const pointsCount = Array.isArray(section?.points) ? section.points.length : 0
  if (!title) return true
  if (pointsCount >= 5) return false
  const words = sectionWordCount(title)
  if (title.endsWith(':')) return true
  if (words <= 7 && pointsCount <= 4) return true
  return false
}

function mergeSectionIntoPrevious(
  sections: Array<{ section: string; points: string[]; pointLevels: number[] }>,
  index: number
) {
  if (index <= 0 || index >= sections.length) return false
  const parent = sections[index - 1]
  const child = sections[index]
  if (!parent || !child) return false

  const mergedPoints = parent.points.slice()
  const mergedLevels = clampPointLevelJumps(normalizePointLevels(parent.pointLevels, mergedPoints.length))

  mergedPoints.push(normalizeSectionHeading(child.section))
  mergedLevels.push(0)

  const childLevels = clampPointLevelJumps(normalizePointLevels(child.pointLevels, child.points.length))
  for (let i = 0; i < child.points.length; i++) {
    mergedPoints.push(child.points[i])
    mergedLevels.push(Math.max(1, childLevels[i] + 1))
  }

  parent.points = mergedPoints
  parent.pointLevels = clampPointLevelJumps(mergedLevels)
  sections.splice(index, 1)
  return true
}

function consolidationScore(section: { section: string; points: string[] }) {
  const pointsCount = Array.isArray(section?.points) ? section.points.length : 0
  const words = sectionWordCount(section.section)
  const title = String(section?.section || '').trim()
  let score = pointsCount * 10 + Math.min(words, 10) * 2
  if (title.endsWith(':')) score -= 4
  if (pointsCount <= 2) score -= 5
  if (words <= 5) score -= 3
  return score
}

function consolidateSections(
  inputSections: Array<{ section: string; points: string[]; pointLevels: number[] }>,
  targetMaxSections = 15
) {
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

// Full notes generation prompt
const NOTES_PROMPT = `You are to convert medical school lecture slides into concise revision notes.

Your goal is to create notes that are information-dense, easy to scan, and revision-friendly.

---

SECTION RULES

• Create 6–10 sections
• Prefer around 7–8 sections where possible
• Each section should represent a major concept cluster, major mechanism, major process, major theme, or major clinical/scientific category
• Each section should be approximately aligned with a lecture learning objective
• Section titles should represent the big concepts a student could place on a spider diagram to map the lecture
• Do not create sections for tiny details or isolated facts
• Preserve the lecture's pedagogical flow - sections should follow the order topics are presented

---

BULLET POINT RULES

• Use ONLY flat main bullet points - NO sub-bullets or nesting
• Every bullet point should be at the same level
• Each bullet should be a standalone, information-dense statement
• Group related details by placing bullets consecutively within the same section
• Keep bullets short and scannable

---

VISUAL PROCESSING RULES

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

---

CONTENT COMPLETENESS

• Include all examinable mechanisms, structures, definitions, pathways, thresholds, and distinctions from the slides
• Do not oversummarise at the expense of missing details
• Preserve every causal link and logical step
• Exclude anecdotal commentary, filler text, and slide narration

---

LANGUAGE RULES

• Use precise medical terminology
• No rhetorical questions
• No conversational tone
• No redundancy
• Use **asterisks** for key terms
• Use UK English spelling

---

FINAL VERIFICATION

Before finishing, verify that:
• Every learning objective is fully addressed
• No mechanism, value, structure, or regulatory step from the slides is missing
• Sections represent major concept clusters (6-10 sections)
• All bullet points are flat with no nesting
• Related bullets are grouped together within sections
• Each bullet is information-dense and scannable
• The notes can be skimmed rapidly and read slowly with full comprehension

The final output should make the lecture easy to map as a spider diagram at section level, and easy to revise at bullet level.

---

IMPORTANT: Return ONLY valid JSON in this exact format:
{"title": "Lecture Title", "learningObjectives": ["LO1", "LO2"], "notes": [{"section": "1. Section Title", "items": [{"text": "First bullet point"}, {"text": "Second bullet point"}, {"text": "Third bullet point"}]}]}

JSON FORMATTING RULES (CRITICAL):
• Escape ALL backslashes (\\) as double backslash (\\\\)
• Escape ALL double quotes (") inside content using backslash (\\")
• Do NOT include actual newlines - keep each point on one line
• Ensure every string is properly closed
• All arrays must be properly closed with ]
• The output must be valid, parseable JSON with double quotes only
• Only use valid JSON escape sequences: \\\\ \\" \\n \\t

STRUCTURE RULES:
• Do NOT include bullet point characters (• or -) in item text - the UI adds those automatically
• notes[].items[] contains all bullet points as a flat list
• Each bullet object has ONLY a "text" property
• Do NOT include "children" property
• All bullets are at the same level - no nesting

Example of correct structure:
{
  "section": "1. Diabetes Pathophysiology",
  "items": [
    {"text": "**Type 1 diabetes** → autoimmune β-cell destruction"},
    {"text": "Absolute insulin deficiency"},
    {"text": "Typically childhood/adolescent onset"},
    {"text": "**Type 2 diabetes** → insulin resistance + β-cell dysfunction"},
    {"text": "Relative insulin deficiency"},
    {"text": "Progressive β-cell failure over time"},
    {"text": "**Hyperglycaemia** results from ↓ glucose uptake + ↑ hepatic output"}
  ]
}`

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get API key from environment
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    // Get Supabase client for auth verification
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify user is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      throw new Error('Invalid or expired token')
    }

    // Parse request body
    const { pdf_base64, lecture_id, user_learning_objectives } = await req.json()

    if (!pdf_base64) {
      throw new Error('No PDF data provided')
    }

    // Build prompt with user learning objectives if provided
    let finalPrompt = NOTES_PROMPT
    if (user_learning_objectives?.trim()) {
      const userObjectives = user_learning_objectives
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0)

      if (userObjectives.length > 0) {
        finalPrompt += `\n\nIMPORTANT: The user has provided these learning objectives for this lecture. Use these EXACTLY as the learningObjectives in your response:\n${userObjectives.join('\n')}\n\nStructure your notes to address these learning objectives.`
      }
    }

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
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
                data: pdf_base64
              }
            },
            {
              type: 'text',
              text: finalPrompt
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || `Claude API error: ${response.status}`)
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('Raw response:', rawText)
      throw new Error('No valid JSON found in API response')
    }

    let parsedResult
    try {
      parsedResult = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      throw new Error('Failed to parse API response as JSON')
    }

    // Transform learning objectives to our format with IDs
    const learningObjectives = (parsedResult.learningObjectives || []).map((text: string) => ({
      id: crypto.randomUUID(),
      text,
      completed: false
    }))

    // Store the notes structure
    const notesData = {
      title: parsedResult.title || 'Untitled Lecture',
      notes: consolidateSections(normalizeGeneratedSections(parsedResult.notes))
    }

    // If lecture_id provided, save to database
    if (lecture_id) {
      const { error: updateError } = await supabase
        .from('lectures')
        .update({
          learning_objectives: learningObjectives,
          notes: notesData,
          notes_generated: true,
          processed_at: new Date().toISOString(),
          phase: 'learn'
        })
        .eq('id', lecture_id)

      if (updateError) {
        throw new Error(`Failed to save notes: ${updateError.message}`)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          title: notesData.title,
          learning_objectives: learningObjectives,
          notes: notesData
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})

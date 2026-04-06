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

function flattenGeneratedItems(
  rawItems: unknown,
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
        pointLevels.push(0)
      }
      continue
    }

    if (!rawItem || typeof rawItem !== 'object') continue

    const text = String((rawItem as { text?: unknown }).text ?? '').trim()
    if (text) {
      points.push(text)
      pointLevels.push(0)
    }

    const children = (rawItem as { children?: unknown }).children
    if (Array.isArray(children)) {
      // Preserve child content but force flat bullet levels for AI-generated notes.
      flattenGeneratedItems(children, points, pointLevels)
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
    const pointLevels = Array(points.length).fill(0)
    return {
      section: String(section?.section || `${sectionIndex + 1}. Section`),
      points,
      pointLevels
    }
  })
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
  const mergedLevels = Array(mergedPoints.length).fill(0)

  mergedPoints.push(normalizeSectionHeading(child.section))
  mergedLevels.push(0)

  for (let i = 0; i < child.points.length; i++) {
    mergedPoints.push(child.points[i])
    mergedLevels.push(0)
  }

  parent.points = mergedPoints
  parent.pointLevels = mergedLevels
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
    const pointLevels = Array(points.length).fill(0)
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
const NOTES_PROMPT = `You are generating exam-focused medical revision notes from lecture slides.

GOAL
Create concise, high-density notes that preserve all examinable content and the lecture's teaching order.

MANDATORY CONTENT RULES
1. Include all examinable definitions, mechanisms, pathways, structures, thresholds, contrasts, and clinically relevant distinctions present in the slides.
2. Do not invent facts. If uncertain, omit.
3. Remove filler, anecdotes, and presenter narration.
4. Preserve causal and regulatory logic explicitly (use arrows).

STRUCTURE RULES
1. Produce 8-14 major sections (concept clusters), in lecture order.
2. Section titles should be concept-level (spider-diagram friendly), not micro-facts.
3. Use flat bullets only (no nesting, no children arrays).
4. Each bullet must be one standalone high-yield fact/mechanism step.
5. Keep bullets short and scannable; split long ideas into multiple bullets.

STYLE RULES
1. UK English spelling.
2. Use precise medical terminology.
3. No conversational tone or rhetorical questions.
4. Use **asterisks** for key terms.
5. Prefer explicit directional/causal notation:
   - Cause -> Effect
   - Up/down directional markers
   - A vs B distinctions where exam-relevant

QUALITY CHECK (before final output)
1. Every learning objective is addressed.
2. No key mechanism step or threshold is missing.
3. Sections are major clusters, not fragmented trivia.
4. Output is dense but readable for rapid revision.

OUTPUT FORMAT (STRICT JSON ONLY)
{"title":"Lecture Title","learningObjectives":["LO1","LO2"],"notes":[{"section":"1. Section Title","items":[{"text":"Bullet one"},{"text":"Bullet two"}]}]}

JSON RULES
1. Return JSON only, no markdown.
2. Escape quotes and backslashes correctly.
3. Do not include bullet characters (-, bullet symbols) in item text.
4. notes[].items[] objects must contain only "text".`

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
      notes: normalizeGeneratedSections(parsedResult.notes),
      _ai_nesting_policy: 'flat',
      _notes_generated_by: 'ai',
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

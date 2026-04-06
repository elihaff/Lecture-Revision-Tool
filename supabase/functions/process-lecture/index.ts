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
  const mergedLevels = Array(mergedPoints.length).fill(0)

  mergedPoints.push(normalizeSectionHeading(child.section))
  mergedLevels.push(0)

  const childPoints = Array.isArray(child.points) ? child.points : []
  for (let i = 0; i < childPoints.length; i++) {
    mergedPoints.push(childPoints[i])
    mergedLevels.push(0)
  }

  parent.points = mergedPoints
  parent.pointLevels = mergedLevels
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

// Full notes generation prompt from the existing tool
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
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Explicit auth verification (required because verify_jwt is disabled for reliability)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      throw new Error('Missing bearer token')
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      throw new Error('Invalid or expired token')
    }

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
      notes: normalizeGeneratedSections(parsedResult.notes),
      _ai_nesting_policy: 'flat',
      _notes_generated_by: 'ai',
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

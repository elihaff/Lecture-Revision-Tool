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
}

interface NotesResult {
  title: string
  learningObjectives: string[]
  notes: NoteSection[]
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
{"title": "Lecture Title", "learningObjectives": ["LO1", "LO2"], "notes": [{"section": "1. Section Title", "points": ["**Key term**: concise explanation", "↓ cause → ↑ effect"]}]}

JSON FORMATTING RULES (CRITICAL):
• Escape ALL backslashes (\\) as double backslash (\\\\)
• Escape ALL double quotes (") inside content using backslash (\\")
• Do NOT include actual newlines - keep each point on one line
• Ensure every string is properly closed
• All arrays must be properly closed with ]
• The output must be valid, parseable JSON with double quotes only
• Only use valid JSON escape sequences: \\\\ \\" \\n \\t

Do NOT include bullet point characters (•) in the points - the UI adds those automatically.
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
      notes: parsedResult.notes || [],
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

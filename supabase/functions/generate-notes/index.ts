// Supabase Edge Function to generate notes from PDF using Claude API
// This keeps the API key secure on the server side

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Full notes generation prompt
const NOTES_PROMPT = `You are to summarise my medical school lecture slides into concise, high-density revision notes.

Follow all rules exactly.

---

CORE GOAL

Produce notes that are:
• Maximally information-dense
• Easy to visually process
• Complete (no important details from the slides may be omitted)
• Understandable even to someone not yet expert, while still exam-level

The notes should feel like an expert-compressed version of the lecture, not a paraphrase.

---

CONTENT RULES
• Include all examinable mechanisms, structures, definitions, pathways, thresholds, and distinctions from the slides
• Do not oversummarise at the expense of missing details
• Rewrite content concisely, but preserve every causal link and logical step
• Integrate related points together under the correct conceptual heading
• Exclude anecdotal commentary, filler text, and slide narration

---

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

---

DENSITY WITHOUT CONFUSION
• Notes should be as compressed as possible while remaining readable
• If a concept is complex, break it into stacked bullet points rather than long sentences
• Group related mechanisms together to minimise repetition
• Prefer cause-effect chains over narrative explanation

---

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

---

LANGUAGE RULES
• Use precise medical terminology
• No rhetorical questions
• No conversational tone
• No redundancy

---

FINAL RULE

Before finishing, internally verify that:
• Every learning objective is fully addressed
• No mechanism, value, structure, or regulatory step from the slides is missing
• The notes can be skimmed rapidly and read slowly with full comprehension

The final output should read like expert-level, visually optimised revision notes designed for high-stakes exams.

---

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
      notes: parsedResult.notes || []
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

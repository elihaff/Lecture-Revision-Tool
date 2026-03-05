import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CONVERT_PROMPT = `You are converting an existing set of lecture notes from a PDF into a structured JSON format.

The PDF contains medical lecture notes that were previously created. Your task is to:
1. Extract the title/topic of the notes
2. Identify any learning objectives mentioned
3. Parse the content into logical sections with bullet points

IMPORTANT RULES:
- Preserve ALL content from the original notes - do not summarise or remove anything
- Keep the exact wording and formatting where possible
- Maintain any symbols like arrows, special characters, etc.
- Keep bold text marked with **asterisks**
- Preserve the original structure and ordering of sections
- If there are numbered sections (1., 2., etc.), keep that numbering

Return ONLY valid JSON in this exact format:
{"title": "Title from the notes", "learningObjectives": ["LO1", "LO2"], "notes": [{"section": "1. Section Title", "points": ["First bullet point", "Second bullet point"]}]}

Do NOT include bullet point characters at the start of points - just the text content.
If no learning objectives are found, return an empty array for learningObjectives.`

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

    const { notes_path } = await req.json()

    if (!notes_path) {
      throw new Error('No notes path provided')
    }

    const { data: pdfData, error: downloadError } = await supabase.storage
      .from('lecture-pdfs')
      .download(notes_path)

    if (downloadError || !pdfData) {
      throw new Error('Failed to download PDF')
    }

    const arrayBuffer = await pdfData.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const pdf_base64 = btoa(binary)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
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
              text: CONVERT_PROMPT
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Claude API error')
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No valid JSON found in API response')
    }

    const parsedResult = JSON.parse(jsonMatch[0])

    const learningObjectives = (parsedResult.learningObjectives || []).map((text: string) => ({
      id: crypto.randomUUID(),
      text,
      completed: false
    }))

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          title: parsedResult.title || 'Converted Notes',
          learning_objectives: learningObjectives,
          notes: parsedResult.notes || []
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})

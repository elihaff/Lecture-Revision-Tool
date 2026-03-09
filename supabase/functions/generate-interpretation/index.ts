import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
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

    // Try multiple possible header names
    let authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      authHeader = req.headers.get('authorization')
    }
    if (!authHeader) {
      // Log all headers for debugging
      const allHeaders = {}
      req.headers.forEach((value, key) => {
        allHeaders[key] = value
      })
      console.log('All request headers:', allHeaders)
      throw new Error('Missing authorization header')
    }

    const token = authHeader.replace('Bearer ', '').replace('bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      throw new Error('Invalid or expired token')
    }

    const { image_base64, media_type } = await req.json()

    if (!image_base64) {
      throw new Error('image_base64 is required')
    }

    // Default to jpeg if not specified, but use provided media type
    const imageMediaType = media_type || 'image/jpeg'
    console.log('Using media type:', imageMediaType)

    // Call Anthropic API with vision
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMediaType,
                data: image_base64
              }
            },
            {
              type: 'text',
              text: `You are a medical education expert. Analyze this medical image and create an interpretation question and answer for flashcard study.

Generate:
1. A concise clinical question about what abnormality or finding is shown (e.g., "What abnormality is shown in this X-ray?")
2. A structured answer in HTML format with:
   - <b>Diagnosis/Finding</b> on the first line
   - <br><br> to separate from details
   - Key clinical features as bullet points or short paragraphs

Format your response EXACTLY as JSON:
{
  "question": "Your question here",
  "answer": "<b>Diagnosis</b><br><br>Key features and clinical details"
}

Keep the answer concise and focused on the most important clinical information. Use proper HTML tags (<b>, <br>, etc.) for formatting.`
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Anthropic API error:', error)
      throw new Error('Failed to generate interpretation')
    }

    const data = await response.json()
    const content = data.content[0].text

    // Parse the JSON response from Claude
    let result
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (e) {
      // If parsing fails, create a fallback response
      result = {
        question: 'What does this medical image show?',
        answer: content.replace(/\n/g, '<br>')
      }
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    )
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FLASHCARDS_PROMPT = `You are to generate high-quality Anki flashcards from my medical lecture notes using a strict recall-optimised technique.

Follow all rules exactly.

Each flashcard must have:

Front (Question)
• A single, precise question
• Tests one concept only
• Answerable in ≤10 seconds
• No vague verbs (describe, discuss, outline)
• No MCQs
• No case vignettes
• No multi-part questions

Back (Answer)
• Must contain only the answer
• Must NOT repeat or paraphrase the question
• No filler words
• Prefer short noun phrases over sentences

Example:
Front: How many brains does a human have?
Back: One

Answer formatting rules (mandatory):
1. Minimal phrasing
2. Lists: each item on new line, blank line between items using <br><br>
3. Mechanisms: each step on new line beginning with →
4. Use arrows (→), ↑, ↓ where relevant
5. Maximum 5 lines per answer (split into more cards if needed)

Question categories to use:
• Definition / Identity
• Location / Source / Cell type
• Mechanism
• Cause → Effect
• Regulation / Feedback
• Comparison (one axis)
• Thresholds / Diagnostic values
• Limited lists (3–5 items)
• Clinical associations (no vignettes)

If a flashcard repeats question in answer, is verbose, has multi-concepts, or cluttered, rewrite it.

IMPORTANT: Return ONLY a JSON array, nothing else:
[{"front":"Question?","back":"Answer"}]

DO NOT create flashcards for incidence/prevalence/percentage statistics.
PRIORITISE definitions, diagnostic values/thresholds, mechanisms/pathways, clinical associations, drug names/doses/side effects.
Use UK English spelling.`

function titleToTag(text: string) {
  const words = (text || 'Lecture')
    .split(/[\s_\-.]+/)
    .map((w) => w.trim())
    .filter(Boolean)
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
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

    const { notes_text, lecture_title, module_abbreviation } = await req.json()
    if (!notes_text || !String(notes_text).trim()) {
      throw new Error('No notes text provided')
    }

    const cardsPrompt = `${FLASHCARDS_PROMPT}\n\nLECTURE NOTES:\n${notes_text}`

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
        system: 'You are a flashcard generator. Generate 25-40 flashcards (hard limits: 20 min, 50 max). NEVER include incidence, prevalence, percentages, statistics, or "most common cause" questions.',
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

    const lectureTag = titleToTag(lecture_title || 'Lecture')
    const modulePart = module_abbreviation ? `${module_abbreviation}_` : ''
    const tags = `Day2 ${modulePart}${lectureTag}`.trim()

    const cards = parsed
      .map((card) => ({
        front: String(card?.front || card?.q || card?.question || '').trim(),
        back: String(card?.back || card?.a || card?.answer || '').trim(),
        tags,
      }))
      .filter((card) => card.front && card.back)
      .slice(0, 50)

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

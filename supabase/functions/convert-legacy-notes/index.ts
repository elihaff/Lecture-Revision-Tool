import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function normalizeGeneratedSections(rawSections: unknown) {
  const sections = Array.isArray(rawSections) ? rawSections : []
  return sections.map((section: any, sectionIndex: number) => {
    const points = Array.isArray(section?.points)
      ? section.points.map((p: unknown) => String(p ?? '').trim()).filter((p: string) => p.length > 0)
      : []
    const suppliedLevels = normalizePointLevels(section?.pointLevels, points.length)
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
{"title": "Title from the notes", "learningObjectives": ["LO1", "LO2"], "notes": [{"section": "1. Section Title", "points": ["First bullet point", "Second bullet point", "Detail of second point"], "pointLevels": [0, 0, 1]}]}

Do NOT include bullet point characters at the start of points - just the text content.
Use pointLevels to encode nesting (0=main bullet, 1=sub-bullet, 2=sub-sub-bullet).
pointLevels length MUST match points length.
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
          notes: normalizeGeneratedSections(parsedResult.notes)
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

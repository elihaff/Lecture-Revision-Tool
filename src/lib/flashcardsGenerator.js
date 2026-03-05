import { supabase } from './supabase'

function buildNotesText(notes) {
  const sections = notes?.notes || []
  return sections
    .map((section) => {
      const sectionTitle = section?.section || 'Untitled Section'
      const points = (section?.points || []).map((p) => `- ${String(p).replace(/<[^>]+>/g, ' ')}`).join('\n')
      return `## ${sectionTitle}\n${points}`
    })
    .join('\n\n')
}

export async function generateFlashcardsFromNotes({ notes, lectureTitle, moduleAbbreviation }) {
  if (!notes?.notes?.length) {
    throw new Error('Please generate notes first, then generate flashcards.')
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token
  if (!accessToken) {
    throw new Error('Please sign in to generate flashcards')
  }

  const payload = {
    lecture_title: lectureTitle || notes.title || 'Lecture',
    module_abbreviation: moduleAbbreviation || '',
    notes_text: buildNotesText(notes),
  }

  // Primary path: Supabase client invoke
  const { data: result, error } = await supabase.functions.invoke('generate-flashcards', {
    body: payload,
  })

  if (!error && result?.success) {
    return result.cards || []
  }

  // Fallback path: direct fetch (same pattern used by notes generation)
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    const functionUrl = `${supabaseUrl}/functions/v1/generate-flashcards`

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
    })

    const fallbackResult = await response.json().catch(() => ({}))
    if (!response.ok || !fallbackResult?.success) {
      const baseError =
        fallbackResult?.error ||
        error?.message ||
        `Edge Function request failed (${response.status})`
      throw new Error(baseError)
    }

    return fallbackResult.cards || []
  } catch (fallbackError) {
    const invokeErrorText = error?.message ? `invoke: ${error.message}` : 'invoke: unknown error'
    const fallbackErrorText = fallbackError?.message ? `fallback: ${fallbackError.message}` : 'fallback: unknown error'
    throw new Error(`Failed to generate flashcards (${invokeErrorText}; ${fallbackErrorText})`)
  }
}

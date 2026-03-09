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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  const words = normalizeText(value).split(' ').filter(Boolean)
  return words.filter((w) => w.length >= 4 && !/^\d+$/.test(w))
}

function buildSectionIndex(notes) {
  const sections = notes?.notes || []
  return sections.map((section, index) => ({
    index,
    key: `section-${index}`,
    title: String(section?.section || `Section ${index + 1}`),
    corpus: normalizeText([
      section?.section || '',
      ...(section?.points || []).map((p) => String(p || ''))
    ].join(' ')),
  }))
}

function inferCardSection(card, sectionIndex) {
  const cardTerms = tokenize(`${card.front} ${card.back}`)
  if (!cardTerms.length || !sectionIndex.length) return null

  let best = null
  sectionIndex.forEach((section) => {
    let score = 0
    cardTerms.forEach((term) => {
      if (section.corpus.includes(term)) score += 1
    })
    if (!best || score > best.score) {
      best = { section, score }
    }
  })

  if (!best || best.score <= 0) return null
  return best.section
}

function attachSectionMetadata(cards, notes) {
  const sectionIndex = buildSectionIndex(notes)
  return cards.map((card) => {
    if (card.sectionIndex !== undefined && card.sectionKey) return card
    const inferred = inferCardSection(card, sectionIndex)
    if (!inferred) return card
    return {
      ...card,
      sectionIndex: inferred.index,
      sectionKey: inferred.key,
      sectionTitle: inferred.title
    }
  })
}

export async function generateFlashcardsFromNotes({ notes, lectureTitle, moduleAbbreviation }) {
  if (!notes?.notes?.length) {
    throw new Error('Please generate notes first, then generate flashcards.')
  }

  // Refresh session to ensure valid token
  await supabase.auth.refreshSession()

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
    return attachSectionMetadata(result.cards || [], notes)
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

    return attachSectionMetadata(fallbackResult.cards || [], notes)
  } catch (fallbackError) {
    const invokeErrorText = error?.message ? `invoke: ${error.message}` : 'invoke: unknown error'
    const fallbackErrorText = fallbackError?.message ? `fallback: ${fallbackError.message}` : 'fallback: unknown error'
    throw new Error(`Failed to generate flashcards (${invokeErrorText}; ${fallbackErrorText})`)
  }
}

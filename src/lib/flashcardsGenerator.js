import { supabase } from './supabase'

function buildNotesPayload(notes, options = {}) {
  const maxPointChars = Number.isFinite(options.maxPointChars) ? options.maxPointChars : 700
  const maxPointsPerSection = Number.isFinite(options.maxPointsPerSection) ? options.maxPointsPerSection : null
  const sections = notes?.notes || []
  return sections.map((section, sectionIndex) => ({
    section_index: sectionIndex,
    section_title: String(section?.section || `Section ${sectionIndex + 1}`),
    points: (section?.points || [])
      .slice(0, maxPointsPerSection || undefined)
      .map((point, pointIndex) => ({
        point_index: pointIndex,
        text: String(point || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxPointChars),
      })),
  }))
}

function buildTaggedNotesText(notesPayload, options = {}) {
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : 120000
  const joined = notesPayload
    .map((section) => {
      const header = `Section [S${section.section_index}] ${section.section_title}`
      const points = (section.points || [])
        .map((point) => `- [S${section.section_index}P${point.point_index}] ${point.text}`)
        .join('\n')
      return `${header}\n${points}`
    })
    .join('\n\n')
  return joined.slice(0, maxChars)
}

function attachSourceMetadata(cards, notes) {
  const sections = notes?.notes || []
  return cards.map((card) => {
    const sourceSectionIndex = Number(card.sourceSectionIndex)
    const sourcePointIndex = Number(card.sourcePointIndex)
    if (!Number.isInteger(sourceSectionIndex) || !Number.isInteger(sourcePointIndex)) {
      return card
    }

    const section = sections[sourceSectionIndex]
    const points = Array.isArray(section?.points) ? section.points : []
    const pointTextRaw = points[sourcePointIndex]

    return {
      ...card,
      sectionIndex: sourceSectionIndex,
      sectionKey: `section-${sourceSectionIndex}`,
      sectionTitle: String(section?.section || `Section ${sourceSectionIndex + 1}`),
      sourcePointIndex: sourcePointIndex,
      sourcePointText: String(pointTextRaw || card.sourcePointText || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 700),
    }
  })
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isCreditBalanceError(message) {
  const text = String(message || '').toLowerCase()
  return (
    text.includes('credit balance is too low') ||
    text.includes('insufficient credit') ||
    text.includes('insufficient credits') ||
    text.includes('billing') ||
    text.includes('payment required')
  )
}

function formatGenerateError(error) {
  const base = String(error?.message || 'Unknown flashcard generation error')
  if (!isCreditBalanceError(base)) return base
  return `${base}. If you just topped up credits, wait ~30-60 seconds and retry (provider billing can take a moment to propagate).`
}

function extractHttpErrorMessage(status, fallbackResult, fallbackRawText, invokeErrorContext) {
  const structuredMessage =
    fallbackResult?.error ||
    fallbackResult?.message ||
    fallbackResult?.msg ||
    (typeof fallbackResult?.code === 'string' ? fallbackResult.code : null)

  const rawSnippet = String(fallbackRawText || '').trim().slice(0, 240)

  if (status === 401 || status === 403) {
    const base = structuredMessage || rawSnippet || `HTTP ${status}`
    return `Authentication failed (${base}). Please sign out and sign in again, then retry.`
  }

  return (
    structuredMessage ||
    rawSnippet ||
    invokeErrorContext?.message ||
    `Edge Function request failed (HTTP ${status})`
  )
}

function shouldRetryWithSmallerPayload(error) {
  const text = String(error?.message || '').toLowerCase()
  return (
    text.includes('non-2xx') ||
    text.includes('413') ||
    text.includes('payload') ||
    text.includes('request entity too large') ||
    text.includes('too long') ||
    text.includes('timeout')
  )
}

async function generateFlashcardsAttempt(payload, notes, accessToken, invokeErrorContext = null) {
  // Primary path: Supabase client invoke
  const { data: result, error } = await supabase.functions.invoke('generate-flashcards', {
    body: payload,
  })

  if (!error && result?.success) {
    const cardsWithSource = attachSourceMetadata(result.cards || [], notes)
    return attachSectionMetadata(cardsWithSource, notes)
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

    let fallbackRawText = ''
    const fallbackResult = await response.json().catch(async () => {
      fallbackRawText = await response.text().catch(() => '')
      return {}
    })
    if (!response.ok || !fallbackResult?.success) {
      const baseError = extractHttpErrorMessage(
        response.status,
        fallbackResult,
        fallbackRawText,
        invokeErrorContext || error
      )
      throw new Error(baseError)
    }

    const cardsWithSource = attachSourceMetadata(fallbackResult.cards || [], notes)
    return attachSectionMetadata(cardsWithSource, notes)
  } catch (fallbackError) {
    const invokeErrorText = error?.message
      ? `invoke: ${error.message}`
      : invokeErrorContext?.message
        ? `invoke: ${invokeErrorContext.message}`
        : 'invoke: unknown error'
    const fallbackErrorText = fallbackError?.message
      ? `fallback: ${fallbackError.message}`
      : 'fallback: unknown error'
    throw new Error(`Failed to generate flashcards (${invokeErrorText}; ${fallbackErrorText})`)
  }
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

  const payloadVariants = [
    { maxPointChars: 700, maxPointsPerSection: null, maxChars: 120000 },
    { maxPointChars: 320, maxPointsPerSection: null, maxChars: 90000 },
    { maxPointChars: 180, maxPointsPerSection: 25, maxChars: 65000 },
    { maxPointChars: 120, maxPointsPerSection: 15, maxChars: 45000 },
  ]

  let lastError = null
  for (let i = 0; i < payloadVariants.length; i++) {
    const variant = payloadVariants[i]
    const notesPayload = buildNotesPayload(notes, variant)
    const notesTaggedText = buildTaggedNotesText(notesPayload, { maxChars: variant.maxChars })
    const payload = {
      lecture_title: lectureTitle || notes.title || 'Lecture',
      module_abbreviation: moduleAbbreviation || '',
      notes_tagged_text: notesTaggedText,
    }

    try {
      return await generateFlashcardsAttempt(payload, notes, accessToken)
    } catch (error) {
      lastError = error
      if (isCreditBalanceError(error?.message)) {
        await sleep(30000)
        await supabase.auth.refreshSession()
        const { data: retrySessionData } = await supabase.auth.getSession()
        const retryAccessToken = retrySessionData?.session?.access_token || accessToken
        try {
          return await generateFlashcardsAttempt(payload, notes, retryAccessToken, error)
        } catch (retryError) {
          lastError = retryError
          break
        }
      }

      const canRetrySmaller = i < payloadVariants.length - 1 && shouldRetryWithSmallerPayload(error)
      if (!canRetrySmaller) {
        break
      }
    }
  }

  throw new Error(formatGenerateError(lastError))
}

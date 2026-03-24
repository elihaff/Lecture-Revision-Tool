/**
 * Flashcard Service
 * Handles all database operations for the flashcards table
 */

import { supabase } from './supabase'
import { calculateNextReview, getReviewQueue, STATE, CONFIG } from './srsAlgorithmV2'
import { recomputeLectureProgress } from './lectureService'

function normalizeTagList(value) {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(normalized)]
}

function normalizeCardText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildCardSignature(card) {
  return `${normalizeCardText(card?.front)}||${normalizeCardText(card?.back)}`
}

function legacyTagsToList(tagsValue) {
  if (Array.isArray(tagsValue)) return normalizeTagList(tagsValue)
  if (!tagsValue || typeof tagsValue !== 'string') return []
  const raw = tagsValue.trim()
  if (!raw) return []
  // Legacy strings often used commas; if none, keep as one label to avoid destructive splitting.
  const parts = raw.includes(',') ? raw.split(',') : [raw]
  return normalizeTagList(parts)
}

function getSuggestedTagsList(aiTagSuggestions) {
  let parsed = aiTagSuggestions
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = null
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const camel = Array.isArray(parsed.contentTags) ? parsed.contentTags : []
  const snake = Array.isArray(parsed.content_tags) ? parsed.content_tags : []
  return normalizeTagList([...camel, ...snake])
}

function getCardFilterTags(card) {
  const legacyTags = legacyTagsToList(card?.tags)
  const contentTags = normalizeTagList(card?.content_tags || card?.contentTags)
  const customUserTags = normalizeTagList(card?.custom_user_tags || card?.customUserTags)
  const suggestedTags = getSuggestedTagsList(card?.ai_tag_suggestions || card?.aiTagSuggestions)
  return [...new Set([...legacyTags, ...contentTags, ...customUserTags, ...suggestedTags])]
}

function getCardTypeTag(card) {
  if (card?.interpretationData || card?.interpretation_data) return 'interpretation'
  if (card?.occlusionData || card?.occlusion_data) return 'image occlusion'
  const allTags = getCardFilterTags(card)
  if (allTags.includes('interpretation')) return 'interpretation'
  if (allTags.includes('image occlusion')) return 'image occlusion'
  return 'text'
}

function getLegacyCardTypeTag(card) {
  if (card?.interpretationData || card?.interpretation_data) return 'interpretation'
  if (card?.occlusionData || card?.occlusion_data) return 'image occlusion'
  return 'text'
}

export function getCardDisplayTags(card, limit = null) {
  const baseTags = getCardFilterTags(card)
  const typeTag = getCardTypeTag(card)
  const tags = [typeTag, ...baseTags.filter((tag) => tag !== typeTag)]
  if (!Number.isFinite(limit) || limit <= 0) {
    return tags
  }
  return tags.slice(0, limit)
}

export function getDifficultyBucket(card) {
  const state = String(card?.state || '').toLowerCase()
  const ease = Number(card?.ease_factor)
  const lapseCount = Number(card?.lapse_count || 0)

  if (state === STATE.NEW) return 'unrated'
  if (state === STATE.RELEARNING) return 'very-hard'

  const safeEase = Number.isFinite(ease) ? ease : CONFIG.STARTING_EASE
  if (lapseCount >= 3 || safeEase < 1.7) return 'very-hard'
  if (lapseCount >= 1 || safeEase < 2.0) return 'hard'
  if (safeEase < 2.35) return 'medium'
  return 'easy'
}

function tagsPayloadFromLegacyCard(card) {
  const tags = card?.tags || null
  const contentTags = normalizeTagList(card?.contentTags || card?.content_tags)
  const customUserTagsSource = normalizeTagList(card?.customUserTags || card?.custom_user_tags)
  const inferredType = getLegacyCardTypeTag(card)
  const withInferredType = inferredType === 'text'
    ? customUserTagsSource
    : [...customUserTagsSource, inferredType]
  const customUserTags = customUserTagsSource.length > 0 ? customUserTagsSource : legacyTagsToList(tags)
  const normalizedCustomTags = normalizeTagList(withInferredType.length > 0 ? withInferredType : customUserTags)
  const aiTagSuggestions = card?.aiTagSuggestions || card?.ai_tag_suggestions || null
  const tagsLastSuggestedAt = card?.tagsLastSuggestedAt || card?.tags_last_suggested_at || null

  return {
    tags,
    content_tags: contentTags,
    custom_user_tags: normalizedCustomTags,
    ai_tag_suggestions: aiTagSuggestions,
    tags_last_suggested_at: tagsLastSuggestedAt,
  }
}

function normalizeNullableText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

function normalizeIntegerOrNull(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeImageArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object')
}

function normalizeJsonObjectOrNull(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function mapCardToMutableFields(card = {}) {
  const tagsPayload = tagsPayloadFromLegacyCard(card)
  const sectionIndex = normalizeIntegerOrNull(card.sectionIndex ?? card.section_index)
  const sourcePointIndex = normalizeIntegerOrNull(card.sourcePointIndex ?? card.source_point_index)
  const sourceParentPointIndex = normalizeIntegerOrNull(card.sourceParentPointIndex ?? card.source_parent_point_index)

  return {
    front: String(card.front || ''),
    back: String(card.back || ''),
    ...tagsPayload,
    section_index: sectionIndex,
    section_key: normalizeNullableText(card.sectionKey ?? card.section_key),
    section_title: normalizeNullableText(card.sectionTitle ?? card.section_title),
    source_point_index: sourcePointIndex,
    source_point_text: normalizeNullableText(card.sourcePointText ?? card.source_point_text),
    source_parent_point_index: sourceParentPointIndex,
    source_parent_point_text: normalizeNullableText(card.sourceParentPointText ?? card.source_parent_point_text),
    front_images: normalizeImageArray(card.frontImages ?? card.front_images),
    back_images: normalizeImageArray(card.backImages ?? card.back_images ?? card.answerImages),
    occlusion_data: normalizeJsonObjectOrNull(card.occlusionData ?? card.occlusion_data),
    interpretation_data: normalizeJsonObjectOrNull(card.interpretationData ?? card.interpretation_data),
  }
}

function buildMutableFieldsSignature(fields = {}) {
  return JSON.stringify({
    front: String(fields.front || ''),
    back: String(fields.back || ''),
    tags: fields.tags || null,
    content_tags: normalizeTagList(fields.content_tags),
    custom_user_tags: normalizeTagList(fields.custom_user_tags),
    ai_tag_suggestions: fields.ai_tag_suggestions || null,
    tags_last_suggested_at: fields.tags_last_suggested_at || null,
    section_index: normalizeIntegerOrNull(fields.section_index),
    section_key: normalizeNullableText(fields.section_key),
    section_title: normalizeNullableText(fields.section_title),
    source_point_index: normalizeIntegerOrNull(fields.source_point_index),
    source_point_text: normalizeNullableText(fields.source_point_text),
    source_parent_point_index: normalizeIntegerOrNull(fields.source_parent_point_index),
    source_parent_point_text: normalizeNullableText(fields.source_parent_point_text),
    front_images: normalizeImageArray(fields.front_images),
    back_images: normalizeImageArray(fields.back_images),
    occlusion_data: normalizeJsonObjectOrNull(fields.occlusion_data),
    interpretation_data: normalizeJsonObjectOrNull(fields.interpretation_data),
  })
}

// ============================================================
// FLASHCARD CRUD OPERATIONS
// ============================================================

/**
 * Create a new flashcard
 * @param {Object} flashcardData - Flashcard data
 * @returns {Promise<{data, error}>}
 */
export async function createFlashcard(flashcardData) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: null, error: new Error('Not authenticated') }
  }

  const { data, error } = await supabase
    .from('flashcards')
    .insert([{
      user_id: user.id,
      lecture_id: flashcardData.lecture_id,
      front: flashcardData.front,
      back: flashcardData.back,
      tags: flashcardData.tags || null,
      content_tags: normalizeTagList(flashcardData.content_tags),
      custom_user_tags: normalizeTagList(flashcardData.custom_user_tags),
      ai_tag_suggestions: flashcardData.ai_tag_suggestions || null,
      tags_last_suggested_at: flashcardData.tags_last_suggested_at || null,
      section_index: flashcardData.section_index,
      section_key: flashcardData.section_key,
      section_title: flashcardData.section_title,
      source_point_index: flashcardData.source_point_index ?? flashcardData.sourcePointIndex ?? null,
      source_point_text: flashcardData.source_point_text ?? flashcardData.sourcePointText ?? null,
      source_parent_point_index: flashcardData.source_parent_point_index ?? flashcardData.sourceParentPointIndex ?? null,
      source_parent_point_text: flashcardData.source_parent_point_text ?? flashcardData.sourceParentPointText ?? null,
      front_images: flashcardData.front_images || [],
      back_images: flashcardData.back_images || [],
      occlusion_data: normalizeJsonObjectOrNull(flashcardData.occlusion_data ?? flashcardData.occlusionData),
      interpretation_data: normalizeJsonObjectOrNull(flashcardData.interpretation_data ?? flashcardData.interpretationData),
      // SRS fields use defaults from schema
    }])
    .select()
    .single()

  if (!error && data?.lecture_id) {
    await recomputeLectureProgress(data.lecture_id)
  }

  return { data, error }
}

/**
 * Update a flashcard
 * @param {string} flashcardId - Flashcard UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<{data, error}>}
 */
export async function updateFlashcard(flashcardId, updates) {
  const normalizedUpdates = { ...(updates || {}) }
  if (!('content_tags' in normalizedUpdates) && Array.isArray(normalizedUpdates.contentTags)) {
    normalizedUpdates.content_tags = normalizeTagList(normalizedUpdates.contentTags)
  }
  if (!('custom_user_tags' in normalizedUpdates) && Array.isArray(normalizedUpdates.customUserTags)) {
    normalizedUpdates.custom_user_tags = normalizeTagList(normalizedUpdates.customUserTags)
  }
  if (!('occlusion_data' in normalizedUpdates) && normalizedUpdates.occlusionData !== undefined) {
    normalizedUpdates.occlusion_data = normalizeJsonObjectOrNull(normalizedUpdates.occlusionData)
  }
  if (!('interpretation_data' in normalizedUpdates) && normalizedUpdates.interpretationData !== undefined) {
    normalizedUpdates.interpretation_data = normalizeJsonObjectOrNull(normalizedUpdates.interpretationData)
  }
  if (!('front_images' in normalizedUpdates) && Array.isArray(normalizedUpdates.frontImages)) {
    normalizedUpdates.front_images = normalizeImageArray(normalizedUpdates.frontImages)
  }
  if (!('back_images' in normalizedUpdates) && Array.isArray(normalizedUpdates.backImages)) {
    normalizedUpdates.back_images = normalizeImageArray(normalizedUpdates.backImages)
  }

  const { data, error } = await supabase
    .from('flashcards')
    .update(normalizedUpdates)
    .eq('id', flashcardId)
    .select()
    .single()

  return { data, error }
}

/**
 * Delete a flashcard
 * @param {string} flashcardId - Flashcard UUID
 * @returns {Promise<{error}>}
 */
export async function deleteFlashcard(flashcardId) {
  const { data: existingCard } = await supabase
    .from('flashcards')
    .select('lecture_id')
    .eq('id', flashcardId)
    .single()

  const { error } = await supabase
    .from('flashcards')
    .delete()
    .eq('id', flashcardId)

  if (!error && existingCard?.lecture_id) {
    await recomputeLectureProgress(existingCard.lecture_id)
  }

  return { error }
}

/**
 * Get all flashcards for a lecture
 * @param {string} lectureId - Lecture UUID
 * @returns {Promise<{data, error}>}
 */
export async function getFlashcardsByLecture(lectureId) {
  const { data, error } = await supabase
    .from('flashcards')
    .select('*')
    .eq('lecture_id', lectureId)
    .order('created_at', { ascending: true })

  return { data: data || [], error }
}

/**
 * Synchronize the full flashcard set for a lecture to the flashcards table.
 * Preserves SRS fields for matched cards and only updates card content/meta fields.
 * @param {string} lectureId - Lecture UUID
 * @param {Array} cards - Full list of lecture flashcards in UI shape
 * @returns {Promise<{data: {inserted:number, updated:number, deleted:number}, error}>}
 */
export async function syncLectureFlashcards(lectureId, cards = []) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: null, error: new Error('Not authenticated') }
  }

  const incomingCards = Array.isArray(cards) ? cards : []
  const { data: existingCards, error: fetchError } = await supabase
    .from('flashcards')
    .select('id, lecture_id, front, back, tags, content_tags, custom_user_tags, ai_tag_suggestions, tags_last_suggested_at, section_index, section_key, section_title, source_point_index, source_point_text, source_parent_point_index, source_parent_point_text, front_images, back_images, occlusion_data, interpretation_data')
    .eq('user_id', user.id)
    .eq('lecture_id', lectureId)
    .order('created_at', { ascending: true })

  if (fetchError) {
    return { data: null, error: fetchError }
  }

  const existingRows = existingCards || []
  const existingById = new Map(existingRows.map((row) => [row.id, row]))
  const existingBySignature = new Map()
  existingRows.forEach((row) => {
    const signature = buildCardSignature(row)
    if (!existingBySignature.has(signature)) {
      existingBySignature.set(signature, [])
    }
    existingBySignature.get(signature).push(row)
  })

  const usedExistingIds = new Set()
  const updates = []
  const inserts = []

  const findUnmatchedBySignature = (signature) => {
    const candidates = existingBySignature.get(signature) || []
    return candidates.find((row) => !usedExistingIds.has(row.id)) || null
  }

  for (const card of incomingCards) {
    const mutableFields = mapCardToMutableFields(card)
    const candidateById = card?.id ? existingById.get(card.id) : null
    let matched = candidateById && !usedExistingIds.has(candidateById.id) ? candidateById : null

    if (!matched) {
      matched = findUnmatchedBySignature(buildCardSignature(card))
    }

    if (matched) {
      usedExistingIds.add(matched.id)
      const currentSignature = buildMutableFieldsSignature(matched)
      const nextSignature = buildMutableFieldsSignature(mutableFields)
      if (currentSignature !== nextSignature) {
        updates.push({ id: matched.id, fields: mutableFields })
      }
      continue
    }

    inserts.push({
      user_id: user.id,
      lecture_id: lectureId,
      ...mutableFields,
    })
  }

  const deleteIds = existingRows
    .map((row) => row.id)
    .filter((id) => !usedExistingIds.has(id))

  for (const updateItem of updates) {
    const { error: updateError } = await supabase
      .from('flashcards')
      .update(updateItem.fields)
      .eq('id', updateItem.id)
      .eq('user_id', user.id)

    if (updateError) {
      return { data: null, error: updateError }
    }
  }

  if (inserts.length > 0) {
    const batchSize = 100
    for (let i = 0; i < inserts.length; i += batchSize) {
      const batch = inserts.slice(i, i + batchSize)
      const { error: insertError } = await supabase
        .from('flashcards')
        .insert(batch)
      if (insertError) {
        return { data: null, error: insertError }
      }
    }
  }

  if (deleteIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('flashcards')
      .delete()
      .eq('user_id', user.id)
      .in('id', deleteIds)

    if (deleteError) {
      return { data: null, error: deleteError }
    }
  }

  await recomputeLectureProgress(lectureId)

  return {
    data: {
      inserted: inserts.length,
      updated: updates.length,
      deleted: deleteIds.length,
    },
    error: null,
  }
}

/**
 * Backfill structured card payload (occlusion/interpretation) from legacy lecture notes cards
 * without overwriting card text/SRS progress.
 */
export async function backfillStructuredCardPayload(lectureId, legacyCards = []) {
  if (!lectureId || !Array.isArray(legacyCards) || legacyCards.length === 0) {
    return { data: { updated: 0 }, error: null }
  }

  const { data: rows, error: fetchError } = await supabase
    .from('flashcards')
    .select('id, lecture_id, front, back, occlusion_data, interpretation_data')
    .eq('lecture_id', lectureId)
    .order('created_at', { ascending: true })

  if (fetchError) {
    return { data: null, error: fetchError }
  }

  const legacyById = new Map()
  const legacyBySignature = new Map()
  for (const legacyCard of legacyCards) {
    if (legacyCard?.id) legacyById.set(legacyCard.id, legacyCard)
    const signature = buildCardSignature(legacyCard)
    if (!legacyBySignature.has(signature)) {
      legacyBySignature.set(signature, [])
    }
    legacyBySignature.get(signature).push(legacyCard)
  }

  const usedLegacySignatures = new Map()
  const updates = []

  for (const row of rows || []) {
    if (row.occlusion_data || row.interpretation_data) continue

    let match = row.id ? legacyById.get(row.id) : null
    if (!match) {
      const signature = buildCardSignature(row)
      const candidates = legacyBySignature.get(signature) || []
      const used = usedLegacySignatures.get(signature) || 0
      match = candidates[used] || null
      usedLegacySignatures.set(signature, used + (match ? 1 : 0))
    }

    if (!match) continue

    const occlusionData = normalizeJsonObjectOrNull(match.occlusionData ?? match.occlusion_data)
    const interpretationData = normalizeJsonObjectOrNull(match.interpretationData ?? match.interpretation_data)
    if (!occlusionData && !interpretationData) continue

    updates.push({
      id: row.id,
      occlusion_data: occlusionData,
      interpretation_data: interpretationData,
    })
  }

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from('flashcards')
      .update({
        occlusion_data: update.occlusion_data,
        interpretation_data: update.interpretation_data,
      })
      .eq('id', update.id)
      .eq('lecture_id', lectureId)
    if (updateError) {
      return { data: null, error: updateError }
    }
  }

  return { data: { updated: updates.length }, error: null }
}

/**
 * Get all flashcards for a user
 * @param {string} userId - User UUID (optional, uses current user if not provided)
 * @returns {Promise<{data, error}>}
 */
export async function getAllFlashcards(userId = null) {
  let query = supabase.from('flashcards').select('*')

  if (userId) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query.order('created_at', { ascending: true })

  return { data: data || [], error }
}

/**
 * Get flashcards for custom study session
 * @param {Object} options - Filter options
 * @param {string[]} options.lectureIds - Filter by lecture IDs (OR logic)
 * @param {string[]} options.tags - Filter by content_tags (OR logic - card has ANY of these tags)
 * @param {string[]} options.cardTypes - Filter by card types ('text' | 'image occlusion' | 'interpretation')
 * @param {string[]} options.difficultyBuckets - Filter by difficulty bucket IDs (OR logic)
 * @param {'new'|'review'} options.mode - 'new' for unlearned cards, 'review' for cards with progress
 * @param {boolean} options.shuffle - Shuffle results (default true)
 * @returns {Promise<{data, error}>}
 */
export async function getCustomStudyCards(options = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: [], error: new Error('Not authenticated') }
  }

  const { lectureIds, tags, cardTypes, difficultyBuckets, mode, shuffle = true } = options

  const normalizedCardTypes = normalizeTagList(cardTypes)
  const selectedCardTypes = new Set(normalizedCardTypes)

  let query = supabase
    .from('flashcards')
    .select('*')
    .eq('user_id', user.id)
    .eq('suspended', false)
    .or('buried.eq.false,buried.is.null')

  // Filter by lectures if specified
  if (Array.isArray(lectureIds) && lectureIds.length > 0) {
    query = query.in('lecture_id', lectureIds)
  }

  // Filter by mode
  if (mode === 'new') {
    query = query.eq('state', STATE.NEW)
  } else if (mode === 'review') {
    // Review mode should only include cards that have graduated
    // (STATE.REVIEW) or cards temporarily lapsed from review (STATE.RELEARNING).
    query = query.in('state', [STATE.REVIEW, STATE.RELEARNING])
  }

  // Narrow card types server-side when exact type predicates are unambiguous.
  if (selectedCardTypes.size === 1) {
    if (selectedCardTypes.has('interpretation')) {
      query = query.not('interpretation_data', 'is', null)
    } else if (selectedCardTypes.has('image occlusion')) {
      query = query.not('occlusion_data', 'is', null)
    } else if (selectedCardTypes.has('text')) {
      query = query.is('interpretation_data', null).is('occlusion_data', null)
    }
  }

  const { data, error } = await query

  if (error) {
    return { data: [], error }
  }

  let cards = data || []

  // Filter by tags if specified (OR logic across accepted tags + AI suggestions)
  if (Array.isArray(tags) && tags.length > 0) {
    const selected = new Set(normalizeTagList(tags))
    cards = cards.filter((card) => {
      const cardTags = getCardFilterTags(card)
      return cardTags.some((tag) => selected.has(tag))
    })
  }

  // Filter by card type if specified
  if (Array.isArray(cardTypes) && cardTypes.length > 0) {
    const selectedTypes = selectedCardTypes
    cards = cards.filter((card) => selectedTypes.has(getCardTypeTag(card)))
  }

  // Filter by difficulty buckets if specified
  if (Array.isArray(difficultyBuckets) && difficultyBuckets.length > 0) {
    const selected = new Set(difficultyBuckets)
    cards = cards.filter((card) => selected.has(getDifficultyBucket(card)))
  }

  // Shuffle if requested
  if (shuffle && cards.length > 0) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[cards[i], cards[j]] = [cards[j], cards[i]]
    }
  }

  return { data: cards, error: null }
}

/**
 * Get unique content tags with counts for filter UI
 * @param {Object} options - Filter options
 * @param {string[]} options.lectureIds - Optional lecture IDs to filter by
 * @returns {Promise<{data: {tag: string, count: number}[], error}>}
 */
export async function getUniqueTagsWithCounts(options = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: [], error: new Error('Not authenticated') }
  }

  const { lectureIds } = options

  // Build query to get all flashcards with tag-bearing fields
  let query = supabase
    .from('flashcards')
    .select('tags, content_tags, custom_user_tags, ai_tag_suggestions')
    .eq('user_id', user.id)
    .eq('suspended', false)
    .or('buried.eq.false,buried.is.null')

  if (Array.isArray(lectureIds) && lectureIds.length > 0) {
    query = query.in('lecture_id', lectureIds)
  }

  const { data, error } = await query

  if (error) {
    return { data: [], error }
  }

  // Count tags client-side (includes accepted tags and AI-suggested tags)
  const tagCounts = {}
  for (const card of (data || [])) {
    const cardTags = getCardFilterTags(card)
    for (const tag of cardTags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1
    }
  }

  // Convert to array and sort by count descending
  const result = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)

  return { data: result, error: null }
}

// ============================================================
// REVIEW OPERATIONS
// ============================================================

/**
 * Record a review and update card state
 * @param {string} flashcardId - Flashcard UUID
 * @param {number} rating - User rating (1-4)
 * @param {Object} options - Optional settings
 * @param {number} options.reviewTimeMs - Time taken in milliseconds
 * @param {string} options.examDate - ISO date string for exam (affects max interval)
 * @returns {Promise<{data, error}>}
 */
export async function recordReview(flashcardId, rating, options = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: null, error: new Error('Not authenticated') }
  }

  // Get current card state
  const { data: card, error: fetchError } = await supabase
    .from('flashcards')
    .select('*')
    .eq('id', flashcardId)
    .single()

  if (fetchError || !card) {
    return { data: null, error: fetchError || new Error('Card not found') }
  }

  // Calculate next review using SM-2 algorithm
  const { updatedCard, reviewLog } = calculateNextReview(card, rating, {
    reviewTimeMs: options.reviewTimeMs,
    examDate: options.examDate
  })

  // Update flashcard
  const { data: updatedData, error: updateError } = await supabase
    .from('flashcards')
    .update(updatedCard)
    .eq('id', flashcardId)
    .select()
    .single()

  if (updateError) {
    return { data: null, error: updateError }
  }

  // Insert review log
  const { error: logError } = await supabase
    .from('review_logs')
    .insert([{
      user_id: user.id,
      flashcard_id: flashcardId,
      ...reviewLog,
    }])

  // Review log save failure is non-critical - don't fail the review

  if (updatedData?.lecture_id) {
    await recomputeLectureProgress(updatedData.lecture_id)
  }

  return { data: updatedData, error: null }
}

/**
 * Get cards due for review today
 * @param {string} userId - User UUID (optional)
 * @param {number} newCardLimit - Max new cards to include
 * @returns {Promise<{dueCards, newCards, total, error}>}
 */
export async function getTodaysReviewQueue(userId = null, newCardLimit = CONFIG.NEW_CARDS_PER_DAY) {
  const { data: { user } } = await supabase.auth.getUser()
  const targetUserId = userId || user?.id

  if (!targetUserId) {
    return { dueCards: [], newCards: [], total: 0, error: new Error('Not authenticated') }
  }

  // Get all cards for user
  const { data: allCards, error } = await supabase
    .from('flashcards')
    .select('*')
    .eq('user_id', targetUserId)

  if (error) {
    return { dueCards: [], newCards: [], total: 0, error }
  }

  // Use SRS algorithm to get review queue
  const queue = getReviewQueue(allCards || [], newCardLimit)

  return {
    ...queue,
    error: null,
  }
}

/**
 * Get cards due for a specific lecture
 * @param {string} lectureId - Lecture UUID
 * @param {number} newCardLimit - Max new cards to include
 * @returns {Promise<{dueCards, newCards, total, error}>}
 */
export async function getLectureReviewQueue(lectureId, newCardLimit = CONFIG.NEW_CARDS_PER_DAY) {
  const { data: allCards, error } = await supabase
    .from('flashcards')
    .select('*')
    .eq('lecture_id', lectureId)

  if (error) {
    return { dueCards: [], newCards: [], total: 0, error }
  }

  // Use SRS algorithm to get review queue
  const queue = getReviewQueue(allCards || [], newCardLimit)

  return {
    ...queue,
    error: null,
  }
}

/**
 * Get cards due for review from the database
 * This is the primary function for fetching cards that need to be reviewed.
 *
 * Returns cards where:
 * - due_date <= now (overdue or due now)
 * - state is LEARNING, RELEARNING, or REVIEW (optionally NEW)
 * - not suspended or buried
 *
 * @param {Object} options - Query options
 * @param {string} options.lectureId - Filter by lecture (optional, null = all lectures)
 * @param {boolean} options.includeNew - Include NEW cards in results (default: false)
 * @param {number} options.limit - Maximum cards to return (default: 100)
 * @param {string|null} options.dueBefore - ISO timestamp cutoff (default: now)
 * @returns {Promise<{data: Array, count: Object, error}>}
 */
export async function getDueReviewCards({ lectureId = null, includeNew = false, limit = 100, dueBefore = null } = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: [], count: { due: 0, new: 0 }, error: new Error('Not authenticated') }
  }

  const cutoffIso = dueBefore || new Date().toISOString()

  // Build query for due cards (LEARNING, RELEARNING, REVIEW states)
  let query = supabase
    .from('flashcards')
    .select('*')
    .eq('user_id', user.id)
    .lte('due_date', cutoffIso)
    .eq('suspended', false)
    .or('buried.eq.false,buried.is.null')

  // Filter by lecture if specified
  if (lectureId) {
    query = query.eq('lecture_id', lectureId)
  }

  // Filter by state - include due cards from RELEARNING and REVIEW only.
  // LEARNING cards belong to learning/new flows, not review sessions.
  // NEW cards are handled separately since they don't have meaningful due dates.
  if (!includeNew) {
    query = query.in('state', [STATE.RELEARNING, STATE.REVIEW])
  }

  // Order by due date (most overdue first) then by state priority
  query = query
    .order('due_date', { ascending: true })
    .limit(limit)

  const { data: dueCards, error: dueError } = await query

  if (dueError) {
    return { data: [], count: { due: 0, new: 0 }, error: dueError }
  }

  // Get count of new cards available (for UI display)
  let newCardCount = 0
  if (!includeNew) {
    let countQuery = supabase
      .from('flashcards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('state', STATE.NEW)
      .eq('suspended', false)
      .or('buried.eq.false,buried.is.null')

    if (lectureId) {
      countQuery = countQuery.eq('lecture_id', lectureId)
    }

    const { count } = await countQuery
    newCardCount = count || 0
  }

  return {
    data: dueCards || [],
    count: {
      due: dueCards?.length || 0,
      new: newCardCount,
    },
    error: null,
  }
}

// ============================================================
// CARD STATE MANAGEMENT
// ============================================================

/**
 * Suspend a flashcard (won't appear in reviews)
 * @param {string} flashcardId - Flashcard UUID
 * @param {boolean} suspended - Suspended state
 * @returns {Promise<{data, error}>}
 */
export async function suspendFlashcard(flashcardId, suspended = true) {
  const { data, error } = await supabase
    .from('flashcards')
    .update({ suspended })
    .eq('id', flashcardId)
    .select()
    .single()

  return { data, error }
}

/**
 * Bury a flashcard until tomorrow
 * @param {string} flashcardId - Flashcard UUID
 * @returns {Promise<{data, error}>}
 */
export async function buryFlashcard(flashcardId) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('flashcards')
    .update({
      buried: true,
      buried_until: tomorrow.toISOString(),
    })
    .eq('id', flashcardId)
    .select()
    .single()

  return { data, error }
}

/**
 * Unbury all buried cards (run this daily)
 * @returns {Promise<{count, error}>}
 */
export async function unburyCards() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { count: 0, error: new Error('Not authenticated') }
  }

  const now = new Date()

  const { data, error } = await supabase
    .from('flashcards')
    .update({ buried: false, buried_until: null })
    .eq('user_id', user.id)
    .eq('buried', true)
    .lte('buried_until', now.toISOString())
    .select()

  return { count: data?.length || 0, error }
}

/**
 * Reset a flashcard to new state
 * @param {string} flashcardId - Flashcard UUID
 * @returns {Promise<{data, error}>}
 */
export async function resetFlashcard(flashcardId) {
  const { data, error } = await supabase
    .from('flashcards')
    .update({
      ease_factor: CONFIG.STARTING_EASE,
      interval_days: 0,
      repetitions: 0,
      due_date: new Date().toISOString(),
      state: STATE.NEW,
      learning_step: 0,
      last_reviewed_at: null,
      review_count: 0,
      lapse_count: 0,
    })
    .eq('id', flashcardId)
    .select()
    .single()

  if (!error && data?.lecture_id) {
    await recomputeLectureProgress(data.lecture_id)
  }

  return { data, error }
}

function normalizeScope(scope) {
  const value = String(scope || '').trim().toLowerCase()
  if (value === 'modules' || value === 'lectures' || value === 'all') return value
  return 'all'
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))]
}

async function resolveScopeLectureIds(userId, { scope = 'all', moduleIds = [], lectureIds = [] } = {}) {
  const normalizedScope = normalizeScope(scope)
  const normalizedModuleIds = normalizeIdList(moduleIds)
  const normalizedLectureIds = normalizeIdList(lectureIds)

  if (normalizedScope === 'all') {
    const { data, error } = await supabase
      .from('lectures')
      .select('id')
      .eq('user_id', userId)

    if (error) return { lectureIds: null, effectiveLectureIds: [], error }
    const effectiveLectureIds = (data || []).map((row) => row.id).filter(Boolean)
    return { lectureIds: null, effectiveLectureIds, error: null }
  }

  if (normalizedScope === 'modules') {
    if (normalizedModuleIds.length === 0) {
      return { lectureIds: [], effectiveLectureIds: [], error: null }
    }

    const { data, error } = await supabase
      .from('lectures')
      .select('id')
      .eq('user_id', userId)
      .in('module_id', normalizedModuleIds)

    if (error) return { lectureIds: [], effectiveLectureIds: [], error }
    const resolvedLectureIds = (data || []).map((row) => row.id).filter(Boolean)
    return { lectureIds: resolvedLectureIds, effectiveLectureIds: resolvedLectureIds, error: null }
  }

  if (normalizedLectureIds.length === 0) {
    return { lectureIds: [], effectiveLectureIds: [], error: null }
  }

  const { data, error } = await supabase
    .from('lectures')
    .select('id')
    .eq('user_id', userId)
    .in('id', normalizedLectureIds)

  if (error) return { lectureIds: [], effectiveLectureIds: [], error }
  const allowedLectureIds = (data || []).map((row) => row.id).filter(Boolean)
  return { lectureIds: allowedLectureIds, effectiveLectureIds: allowedLectureIds, error: null }
}

/**
 * Preview number of flashcards that would be reset.
 * @param {Object} options
 * @param {'all'|'modules'|'lectures'} options.scope
 * @param {string[]} options.moduleIds
 * @param {string[]} options.lectureIds
 * @returns {Promise<{count: number, lectureIds: string[], error: Error|null}>}
 */
export async function previewResetCount({ scope = 'all', moduleIds = [], lectureIds = [] } = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { count: 0, lectureIds: [], error: new Error('Not authenticated') }
  }

  const { lectureIds: scopedLectureIds, effectiveLectureIds, error: scopeError } = await resolveScopeLectureIds(user.id, {
    scope,
    moduleIds,
    lectureIds,
  })

  if (scopeError) {
    return { count: 0, lectureIds: [], error: scopeError }
  }

  if (Array.isArray(scopedLectureIds) && scopedLectureIds.length === 0) {
    return { count: 0, lectureIds: [], error: null }
  }

  let query = supabase
    .from('flashcards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if (Array.isArray(scopedLectureIds)) {
    query = query.in('lecture_id', scopedLectureIds)
  }

  const { count, error } = await query

  return {
    count: Number(count || 0),
    lectureIds: effectiveLectureIds,
    error: error || null,
  }
}

/**
 * Reset SRS progress for a scoped set of flashcards.
 * @param {Object} options
 * @param {'all'|'modules'|'lectures'} options.scope
 * @param {string[]} options.moduleIds
 * @param {string[]} options.lectureIds
 * @returns {Promise<{resetCount: number, lectureIds: string[], error: Error|null}>}
 */
export async function resetFlashcardProgress({ scope = 'all', moduleIds = [], lectureIds = [] } = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { resetCount: 0, lectureIds: [], error: new Error('Not authenticated') }
  }

  const { lectureIds: scopedLectureIds, effectiveLectureIds, error: scopeError } = await resolveScopeLectureIds(user.id, {
    scope,
    moduleIds,
    lectureIds,
  })

  if (scopeError) {
    return { resetCount: 0, lectureIds: [], error: scopeError }
  }

  if (Array.isArray(scopedLectureIds) && scopedLectureIds.length === 0) {
    return { resetCount: 0, lectureIds: [], error: null }
  }

  const { count: previewCount, error: previewError } = await previewResetCount({ scope, moduleIds, lectureIds })
  if (previewError) {
    return { resetCount: 0, lectureIds: [], error: previewError }
  }

  if (!previewCount) {
    return { resetCount: 0, lectureIds: effectiveLectureIds, error: null }
  }

  const patch = {
    ease_factor: CONFIG.STARTING_EASE,
    interval_days: 0,
    repetitions: 0,
    due_date: new Date().toISOString(),
    state: STATE.NEW,
    learning_step: 0,
    last_reviewed_at: null,
    review_count: 0,
    lapse_count: 0,
    suspended: false,
    buried: false,
    buried_until: null,
  }

  let query = supabase
    .from('flashcards')
    .update(patch)
    .eq('user_id', user.id)

  if (Array.isArray(scopedLectureIds)) {
    query = query.in('lecture_id', scopedLectureIds)
  }

  const { error } = await query

  if (!error) {
    // Delete review logs for the affected flashcards to reset stats
    let deleteLogsQuery = supabase
      .from('review_logs')
      .delete()
      .eq('user_id', user.id)

    if (Array.isArray(scopedLectureIds)) {
      // Get flashcard IDs for the scoped lectures
      const { data: flashcardIds } = await supabase
        .from('flashcards')
        .select('id')
        .eq('user_id', user.id)
        .in('lecture_id', scopedLectureIds)

      if (flashcardIds && flashcardIds.length > 0) {
        await supabase
          .from('review_logs')
          .delete()
          .eq('user_id', user.id)
          .in('flashcard_id', flashcardIds.map(f => f.id))
      }
    } else {
      // Reset all - delete all review logs for user
      await deleteLogsQuery
    }

    for (const lectureId of effectiveLectureIds) {
      await recomputeLectureProgress(lectureId)
    }
  }

  return {
    resetCount: error ? 0 : previewCount,
    lectureIds: effectiveLectureIds,
    error: error || null,
  }
}

// ============================================================
// STATISTICS & ANALYTICS
// ============================================================

/**
 * Get review statistics for a user
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<{stats, error}>}
 */
export async function getReviewStats(days = 30) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { stats: null, error: new Error('Not authenticated') }
  }

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  // Get review logs
  const { data: reviewLogs, error: logsError } = await supabase
    .from('review_logs')
    .select('*')
    .eq('user_id', user.id)
    .gte('reviewed_at', startDate.toISOString())
    .order('reviewed_at', { ascending: false })

  if (logsError) {
    return { stats: null, error: logsError }
  }

  // Get all cards
  const { data: allCards, error: cardsError } = await supabase
    .from('flashcards')
    .select('*')
    .eq('user_id', user.id)

  if (cardsError) {
    return { stats: null, error: cardsError }
  }

  // Calculate statistics
  const totalCards = allCards.length
  const newCards = allCards.filter(c => c.state === STATE.NEW).length
  const learningCards = allCards.filter(c => c.state === STATE.LEARNING).length
  const reviewCards = allCards.filter(c => c.state === STATE.REVIEW).length
  const suspendedCards = allCards.filter(c => c.suspended).length

  const totalReviews = reviewLogs.length
  const passedReviews = reviewLogs.filter(log => log.rating >= 3).length
  const retention = totalReviews > 0 ? Math.round((passedReviews / totalReviews) * 100) : 100

  // Cards by maturity
  const youngCards = allCards.filter(c => c.state === STATE.REVIEW && c.interval_days < 21).length
  const matureCards = allCards.filter(c => c.state === STATE.REVIEW && c.interval_days >= 21).length

  // Average ease
  const matureCardsWithEase = allCards.filter(c => c.state === STATE.REVIEW && c.interval_days >= 21)
  const averageEase = matureCardsWithEase.length > 0
    ? Math.round(matureCardsWithEase.reduce((sum, c) => sum + c.ease_factor, 0) / matureCardsWithEase.length * 100) / 100
    : CONFIG.STARTING_EASE

  // Reviews per day (last 7 days)
  const reviewsByDay = {}
  for (let i = 0; i < 7; i++) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateKey = date.toISOString().split('T')[0]
    reviewsByDay[dateKey] = 0
  }
  reviewLogs.forEach(log => {
    const dateKey = log.reviewed_at.split('T')[0]
    if (reviewsByDay.hasOwnProperty(dateKey)) {
      reviewsByDay[dateKey]++
    }
  })

  return {
    stats: {
      totalCards,
      newCards,
      learningCards,
      reviewCards,
      suspendedCards,
      youngCards,
      matureCards,
      totalReviews,
      retention,
      averageEase,
      reviewsByDay,
    },
    error: null,
  }
}

/**
 * Get today's review count
 * @returns {Promise<{count, error}>}
 */
export async function getTodaysReviewCount() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { count: 0, error: new Error('Not authenticated') }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { count, error } = await supabase
    .from('review_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('reviewed_at', today.toISOString())

  return { count: count || 0, error }
}

// ============================================================
// MIGRATION UTILITIES
// ============================================================

/**
 * Check if a lecture has flashcards in JSONB that need migration
 * @param {Object} lecture - Lecture object with notes field
 * @returns {boolean}
 */
export function hasUnmigratedFlashcards(lecture) {
  return Array.isArray(lecture?.notes?._flashcards) && lecture.notes._flashcards.length > 0
}

/**
 * Migrate flashcards from lecture.notes._flashcards to flashcards table
 * @param {string} lectureId - Lecture UUID
 * @param {Object} lecture - Lecture object with notes field
 * @returns {Promise<{migratedCount, error}>}
 */
export async function migrateFlashcardsFromLecture(lectureId, lecture) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { migratedCount: 0, error: new Error('Not authenticated') }
  }

  const flashcards = lecture?.notes?._flashcards
  if (!Array.isArray(flashcards) || flashcards.length === 0) {
    return { migratedCount: 0, error: null }
  }

  // Check if already migrated (flashcards exist in table for this lecture)
  const { data: existingCards } = await supabase
    .from('flashcards')
    .select('id, front, back, tags, content_tags, custom_user_tags, ai_tag_suggestions, tags_last_suggested_at')
    .eq('lecture_id', lectureId)
    .order('created_at', { ascending: true })

  if (existingCards && existingCards.length > 0) {
    // Keep existing SRS rows, sync tag fields by best-effort signature/index matching,
    // then insert any legacy cards that are still unmatched.
    const matchedExistingIds = new Set()
    const matchedLegacyIndices = new Set()
    let syncedCount = 0

    const existingBySignature = new Map()
    existingCards.forEach((row, idx) => {
      const signature = buildCardSignature(row)
      if (!existingBySignature.has(signature)) {
        existingBySignature.set(signature, [])
      }
      existingBySignature.get(signature).push({ row, idx })
    })

    const findMatchForLegacyCard = (legacyCard, legacyIndex) => {
      const signature = buildCardSignature(legacyCard)
      const candidates = existingBySignature.get(signature) || []
      const unusedBySignature = candidates.find(({ row }) => !matchedExistingIds.has(row.id))
      if (unusedBySignature) return unusedBySignature.row

      // Fallback to index position when signatures differ (editing/reformatting).
      const indexRow = existingCards[legacyIndex]
      if (indexRow && !matchedExistingIds.has(indexRow.id)) return indexRow

      // Final fallback: first unmatched existing row.
      return existingCards.find((row) => !matchedExistingIds.has(row.id)) || null
    }

    for (let i = 0; i < flashcards.length; i++) {
      const legacyCard = flashcards[i] || {}
      const current = findMatchForLegacyCard(legacyCard, i)
      if (!current) continue

      matchedLegacyIndices.add(i)
      matchedExistingIds.add(current.id)
      const sourceTags = tagsPayloadFromLegacyCard(legacyCard)
      const currentSignature = JSON.stringify({
        tags: current?.tags || null,
        content_tags: normalizeTagList(current?.content_tags),
        custom_user_tags: normalizeTagList(current?.custom_user_tags),
        ai_tag_suggestions: current?.ai_tag_suggestions || null,
        tags_last_suggested_at: current?.tags_last_suggested_at || null,
      })
      const nextSignature = JSON.stringify(sourceTags)

      if (currentSignature === nextSignature) continue

      const { error: updateError } = await supabase
        .from('flashcards')
        .update(sourceTags)
        .eq('id', current.id)

      if (updateError) {
        // Tag sync failed - non-critical
        continue
      }

      syncedCount++
    }

    // Tags synced successfully on existing flashcards

    // Insert any new cards that exist in notes JSON but are missing in flashcards table.
    const missingCards = flashcards.filter((_, index) => !matchedLegacyIndices.has(index))
    if (missingCards.length > 0) {
      const missingRows = missingCards.map((card) => ({
        user_id: user.id,
        lecture_id: lectureId,
        front: card.front || '',
        back: card.back || '',
        ...tagsPayloadFromLegacyCard(card),
        section_index: card.sectionIndex,
        section_key: card.sectionKey,
        section_title: card.sectionTitle,
        source_point_index: card.sourcePointIndex ?? null,
        source_point_text: card.sourcePointText ?? null,
        source_parent_point_index: card.sourceParentPointIndex ?? null,
        source_parent_point_text: card.sourceParentPointText ?? null,
        front_images: card.frontImages || [],
        back_images: card.backImages || card.answerImages || [],
      }))

      const { data: insertedRows, error: insertError } = await supabase
        .from('flashcards')
        .insert(missingRows)
        .select('id')

      if (insertError) {
        return { migratedCount: 0, error: insertError }
      }

      const insertedCount = insertedRows?.length || missingRows.length
      return { migratedCount: insertedCount, error: null }
    }

    return { migratedCount: 0, error: null }
  }

  // Prepare flashcards for insertion
  const flashcardsToInsert = flashcards.map(card => ({
    user_id: user.id,
    lecture_id: lectureId,
    front: card.front || '',
    back: card.back || '',
    ...tagsPayloadFromLegacyCard(card),
    section_index: card.sectionIndex,
    section_key: card.sectionKey,
    section_title: card.sectionTitle,
    source_point_index: card.sourcePointIndex ?? null,
    source_point_text: card.sourcePointText ?? null,
    source_parent_point_index: card.sourceParentPointIndex ?? null,
    source_parent_point_text: card.sourceParentPointText ?? null,
    front_images: card.frontImages || [],
    back_images: card.backImages || card.answerImages || [],
    // All cards start as new with default SRS values
  }))

  // Insert in batches of 100 to avoid hitting limits
  const batchSize = 100
  let migratedCount = 0

  for (let i = 0; i < flashcardsToInsert.length; i += batchSize) {
    const batch = flashcardsToInsert.slice(i, i + batchSize)
    const { data, error } = await supabase
      .from('flashcards')
      .insert(batch)
      .select()

    if (error) {
      return { migratedCount, error }
    }

    migratedCount += data.length
  }

  // Note: We keep the old _flashcards in JSONB as backup (as per user preference)

  return { migratedCount, error: null }
}

/**
 * Migrate all flashcards for all lectures for current user
 * @returns {Promise<{totalMigrated, lecturesMigrated, error}>}
 */
export async function migrateAllFlashcards() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { totalMigrated: 0, lecturesMigrated: 0, error: new Error('Not authenticated') }
  }

  // Get all lectures with notes that might have flashcards
  const { data: lectures, error: fetchError } = await supabase
    .from('lectures')
    .select('id, notes')
    .eq('user_id', user.id)
    .not('notes', 'is', null)

  if (fetchError) {
    return { totalMigrated: 0, lecturesMigrated: 0, error: fetchError }
  }

  let totalMigrated = 0
  let lecturesMigrated = 0

  for (const lecture of lectures || []) {
    if (hasUnmigratedFlashcards(lecture)) {
      const { migratedCount, error } = await migrateFlashcardsFromLecture(lecture.id, lecture)

      if (error) {
        // Migration failed for this lecture - continue with others
        continue
      }

      if (migratedCount > 0) {
        totalMigrated += migratedCount
        lecturesMigrated++
      }
    }
  }

  return { totalMigrated, lecturesMigrated, error: null }
}

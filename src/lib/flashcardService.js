/**
 * Flashcard Service
 * Handles all database operations for the flashcards table
 */

import { supabase } from './supabase'
import { calculateNextReview, getReviewQueue, STATE, CONFIG } from './srsAlgorithm'

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
      section_index: flashcardData.section_index,
      section_key: flashcardData.section_key,
      section_title: flashcardData.section_title,
      front_images: flashcardData.front_images || [],
      back_images: flashcardData.back_images || [],
      // SRS fields use defaults from schema
    }])
    .select()
    .single()

  return { data, error }
}

/**
 * Update a flashcard
 * @param {string} flashcardId - Flashcard UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<{data, error}>}
 */
export async function updateFlashcard(flashcardId, updates) {
  const { data, error } = await supabase
    .from('flashcards')
    .update(updates)
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
  const { error } = await supabase
    .from('flashcards')
    .delete()
    .eq('id', flashcardId)

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

// ============================================================
// REVIEW OPERATIONS
// ============================================================

/**
 * Record a review and update card state
 * @param {string} flashcardId - Flashcard UUID
 * @param {number} rating - User rating (1-4)
 * @param {number} reviewTimeMs - Time taken in milliseconds
 * @returns {Promise<{data, error}>}
 */
export async function recordReview(flashcardId, rating, reviewTimeMs = null) {
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
  const { updatedCard, reviewLog } = calculateNextReview(card, rating, reviewTimeMs)

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

  if (logError) {
    console.error('Failed to save review log:', logError)
    // Don't fail the review if logging fails
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
      last_reviewed_at: null,
      review_count: 0,
      lapse_count: 0,
    })
    .eq('id', flashcardId)
    .select()
    .single()

  return { data, error }
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
    .select('id')
    .eq('lecture_id', lectureId)
    .limit(1)

  if (existingCards && existingCards.length > 0) {
    console.log(`Lecture ${lectureId} already has migrated flashcards, skipping`)
    return { migratedCount: 0, error: null }
  }

  // Prepare flashcards for insertion
  const flashcardsToInsert = flashcards.map(card => ({
    user_id: user.id,
    lecture_id: lectureId,
    front: card.front || '',
    back: card.back || '',
    tags: card.tags || null,
    section_index: card.sectionIndex,
    section_key: card.sectionKey,
    section_title: card.sectionTitle,
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
      console.error('Error migrating flashcards:', error)
      return { migratedCount, error }
    }

    migratedCount += data.length
  }

  console.log(`Migrated ${migratedCount} flashcards for lecture ${lectureId}`)

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
        console.error(`Failed to migrate lecture ${lecture.id}:`, error)
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

/**
 * SM-2 Spaced Repetition Algorithm
 * Based on SuperMemo 2 (1988) - the same algorithm used by Anki
 *
 * References:
 * - https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 * - https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html
 */

// ============================================================
// CONSTANTS
// ============================================================

export const RATING = {
  AGAIN: 1, // Complete blackout, incorrect response
  HARD: 2,  // Correct response, but with serious difficulty
  GOOD: 3,  // Correct response with some effort
  EASY: 4,  // Perfect response, immediate recall
}

export const STATE = {
  NEW: 'new',           // Never reviewed
  LEARNING: 'learning', // First exposure, short intervals
  REVIEW: 'review',     // Graduated, using full SM-2 intervals
  RELEARNING: 'relearning', // Was forgotten, being relearned
}

// Configuration (can be made user-adjustable later)
export const CONFIG = {
  // Graduating intervals (when new card transitions to review)
  GRADUATING_INTERVAL_GOOD: 1,  // days (when rated Good)
  GRADUATING_INTERVAL_EASY: 4,  // days (when rated Easy)

  // Relearning intervals (when forgotten card transitions back to review)
  RELEARNING_INTERVAL: 1, // days

  // Learning steps for new cards (in minutes)
  // Cards must pass through all steps before graduating
  LEARNING_STEPS: [1, 10], // 1 minute (in-session), 10 minutes (in-session)

  // Ease factor bounds
  STARTING_EASE: 2.5,
  MINIMUM_EASE: 1.3,

  // Interval bounds
  MINIMUM_INTERVAL: 1,    // days
  MAXIMUM_INTERVAL: 365,  // days (1 year max)

  // Interval modifiers per rating
  HARD_INTERVAL_MULTIPLIER: 1.2,   // Hard = current interval * 1.2
  EASY_BONUS_MULTIPLIER: 1.3,      // Easy = normal interval * 1.3

  // Ease factor adjustments per rating
  HARD_EASE_PENALTY: -0.15,
  EASY_EASE_BONUS: 0.15,
  AGAIN_EASE_PENALTY: -0.2,

  // Fuzz factor (randomness to prevent cards always being due together)
  FUZZ_FACTOR: 0.05, // ±5% random variation

  // New cards per day limit
  NEW_CARDS_PER_DAY: 20,
}

// ============================================================
// SM-2 ALGORITHM CORE
// ============================================================

/**
 * Calculate next review schedule using SM-2 algorithm
 * @param {Object} card - Current card state
 * @param {number} rating - User rating (1-4)
 * @param {number} reviewTimeMs - Time taken to review in milliseconds
 * @returns {Object} Updated card state and review log
 */
export function calculateNextReview(card, rating, reviewTimeMs = null) {
  // Validate rating
  if (rating < RATING.AGAIN || rating > RATING.EASY) {
    throw new Error(`Invalid rating: ${rating}. Must be between 1 and 4.`)
  }

  // Extract current state
  const {
    ease_factor = CONFIG.STARTING_EASE,
    interval_days = 0,
    repetitions = 0,
    state = STATE.NEW,
    lapse_count = 0,
    review_count = 0,
  } = card

  // Store state before review (for undo functionality)
  const stateBefore = {
    ease_factor_before: ease_factor,
    interval_before: interval_days,
    repetitions_before: repetitions,
    state_before: state,
  }

  // Calculate new state
  let newEaseFactor = ease_factor
  let newInterval = interval_days
  let newRepetitions = repetitions
  let newState = state
  let newLapseCount = lapse_count

  // ============================================================
  // RATING: AGAIN (Failed recall)
  // ============================================================
  if (rating === RATING.AGAIN) {
    newRepetitions = 0
    newLapseCount += 1
    newEaseFactor = Math.max(
      CONFIG.MINIMUM_EASE,
      ease_factor + CONFIG.AGAIN_EASE_PENALTY
    )

    // Reset to learning/relearning
    if (state === STATE.NEW) {
      newState = STATE.LEARNING
      newInterval = 0 // Review in 10 minutes (handled by learning steps)
    } else {
      newState = STATE.RELEARNING
      newInterval = 0 // Review in 10 minutes
    }
  }

  // ============================================================
  // RATING: HARD (Difficult but correct)
  // ============================================================
  else if (rating === RATING.HARD) {
    if (state === STATE.NEW || state === STATE.LEARNING || state === STATE.RELEARNING) {
      // Still in learning phase - increase interval slightly
      newInterval = Math.min(
        interval_days * 1.5,
        CONFIG.GRADUATING_INTERVAL_GOOD * 0.8
      )
      if (newInterval >= CONFIG.GRADUATING_INTERVAL_GOOD) {
        newState = STATE.REVIEW
        newRepetitions = 1
      }
    } else {
      // In review phase
      newInterval = Math.min(
        interval_days * CONFIG.HARD_INTERVAL_MULTIPLIER,
        CONFIG.MAXIMUM_INTERVAL
      )
      newEaseFactor = Math.max(
        CONFIG.MINIMUM_EASE,
        ease_factor + CONFIG.HARD_EASE_PENALTY
      )
      newRepetitions += 1
    }
  }

  // ============================================================
  // RATING: GOOD (Correct with effort)
  // ============================================================
  else if (rating === RATING.GOOD) {
    if (state === STATE.NEW || state === STATE.LEARNING) {
      // Graduate from learning to review
      newInterval = CONFIG.GRADUATING_INTERVAL_GOOD
      newState = STATE.REVIEW
      newRepetitions = 1
    } else if (state === STATE.RELEARNING) {
      // Graduate from relearning to review
      newInterval = CONFIG.RELEARNING_INTERVAL
      newState = STATE.REVIEW
      newRepetitions = 1
    } else {
      // Normal SM-2 progression
      if (repetitions === 0) {
        newInterval = CONFIG.MINIMUM_INTERVAL
      } else if (repetitions === 1) {
        newInterval = 6
      } else {
        newInterval = Math.min(
          interval_days * ease_factor,
          CONFIG.MAXIMUM_INTERVAL
        )
      }
      newRepetitions += 1
      // Ease factor stays the same for GOOD rating
    }
  }

  // ============================================================
  // RATING: EASY (Perfect recall)
  // ============================================================
  else if (rating === RATING.EASY) {
    if (state === STATE.NEW || state === STATE.LEARNING) {
      // Graduate with bonus interval
      newInterval = CONFIG.GRADUATING_INTERVAL_EASY
      newState = STATE.REVIEW
      newRepetitions = 1
      newEaseFactor = ease_factor + CONFIG.EASY_EASE_BONUS
    } else if (state === STATE.RELEARNING) {
      // Graduate from relearning with bonus
      newInterval = CONFIG.RELEARNING_INTERVAL * 2
      newState = STATE.REVIEW
      newRepetitions = 1
      newEaseFactor = ease_factor + CONFIG.EASY_EASE_BONUS
    } else {
      // Normal SM-2 with bonuses
      if (repetitions === 0) {
        newInterval = CONFIG.GRADUATING_INTERVAL_EASY
      } else if (repetitions === 1) {
        newInterval = 6 * CONFIG.EASY_BONUS_MULTIPLIER
      } else {
        newInterval = Math.min(
          interval_days * ease_factor * CONFIG.EASY_BONUS_MULTIPLIER,
          CONFIG.MAXIMUM_INTERVAL
        )
      }
      newRepetitions += 1
      newEaseFactor = ease_factor + CONFIG.EASY_EASE_BONUS
    }
  }

  // ============================================================
  // CALCULATE DUE DATE
  // ============================================================

  // Apply fuzz to prevent cards being due at exactly the same time
  const fuzzRange = newInterval * CONFIG.FUZZ_FACTOR
  const fuzzAmount = (Math.random() - 0.5) * 2 * fuzzRange
  const fuzzedInterval = Math.max(0, newInterval + fuzzAmount)

  // Calculate due date
  const now = new Date()
  const dueDate = new Date(now.getTime() + fuzzedInterval * 24 * 60 * 60 * 1000)

  // ============================================================
  // RETURN UPDATED STATE
  // ============================================================

  const updatedCard = {
    ease_factor: newEaseFactor,
    interval_days: newInterval,
    repetitions: newRepetitions,
    due_date: dueDate.toISOString(),
    state: newState,
    lapse_count: newLapseCount,
    last_reviewed_at: now.toISOString(),
    review_count: review_count + 1,
  }

  const reviewLog = {
    rating,
    time_taken_ms: reviewTimeMs,
    ...stateBefore,
    ease_factor_after: newEaseFactor,
    interval_after: newInterval,
    repetitions_after: newRepetitions,
    state_after: newState,
    reviewed_at: now.toISOString(),
  }

  return {
    updatedCard,
    reviewLog,
  }
}

// ============================================================
// CARD FILTERING & SELECTION
// ============================================================

/**
 * Get cards that are due for review
 * @param {Array} cards - All flashcards
 * @param {Date} now - Current date/time (for testing)
 * @returns {Array} Cards due for review
 */
export function getDueCards(cards, now = new Date()) {
  return cards.filter(card => {
    // Skip suspended or buried cards
    if (card.suspended) return false
    if (card.buried && card.buried_until && new Date(card.buried_until) > now) {
      return false
    }

    // Skip new cards (handled separately)
    if (card.state === STATE.NEW) return false

    // Check if due
    return new Date(card.due_date) <= now
  })
}

/**
 * Get new cards (never reviewed)
 * @param {Array} cards - All flashcards
 * @param {number} limit - Maximum new cards to return
 * @returns {Array} New cards to introduce
 */
export function getNewCards(cards, limit = CONFIG.NEW_CARDS_PER_DAY) {
  return cards
    .filter(card => card.state === STATE.NEW && !card.suspended)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, limit)
}

/**
 * Get all cards for today's review session
 * @param {Array} cards - All flashcards
 * @param {number} newCardLimit - Max new cards to introduce
 * @returns {Object} { dueCards, newCards, total }
 */
export function getReviewQueue(cards, newCardLimit = CONFIG.NEW_CARDS_PER_DAY) {
  const dueCards = getDueCards(cards)
  const newCards = getNewCards(cards, newCardLimit)

  return {
    dueCards,
    newCards,
    total: dueCards.length + newCards.length,
  }
}

/**
 * Shuffle array (Fisher-Yates algorithm)
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
export function shuffle(array) {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// ============================================================
// STATISTICS & ANALYTICS
// ============================================================

/**
 * Calculate retention rate from review logs
 * @param {Array} reviewLogs - Historical review data
 * @returns {number} Percentage (0-100)
 */
export function calculateRetention(reviewLogs) {
  if (reviewLogs.length === 0) return 100

  const passed = reviewLogs.filter(log => log.rating >= RATING.GOOD).length
  return Math.round((passed / reviewLogs.length) * 100)
}

/**
 * Get forecast of cards due in upcoming days
 * @param {Array} cards - All flashcards
 * @param {number} days - Number of days to forecast
 * @returns {Array} Array of {date, count} objects
 */
export function getForecast(cards, days = 7) {
  const forecast = []
  const now = new Date()
  now.setHours(0, 0, 0, 0) // Start of today

  for (let i = 0; i < days; i++) {
    const date = new Date(now)
    date.setDate(date.getDate() + i)
    const nextDay = new Date(date)
    nextDay.setDate(nextDay.getDate() + 1)

    const count = cards.filter(card => {
      if (card.suspended || card.buried) return false
      const dueDate = new Date(card.due_date)
      return dueDate >= date && dueDate < nextDay
    }).length

    forecast.push({
      date: date.toISOString().split('T')[0],
      count,
    })
  }

  return forecast
}

/**
 * Calculate average ease factor for mature cards
 * @param {Array} cards - All flashcards
 * @returns {number} Average ease factor
 */
export function getAverageEase(cards) {
  const matureCards = cards.filter(card =>
    card.state === STATE.REVIEW && card.interval_days >= 21
  )

  if (matureCards.length === 0) return CONFIG.STARTING_EASE

  const sum = matureCards.reduce((acc, card) => acc + card.ease_factor, 0)
  return Math.round((sum / matureCards.length) * 100) / 100
}

/**
 * Get card maturity level
 * @param {Object} card - Flashcard
 * @returns {string} 'new' | 'young' | 'mature'
 */
export function getCardMaturity(card) {
  if (card.state === STATE.NEW) return 'new'
  if (card.interval_days < 21) return 'young'
  return 'mature'
}

// ============================================================
// FORMATTING UTILITIES
// ============================================================

/**
 * Format interval for display
 * @param {number} days - Interval in days
 * @returns {string} Formatted interval (e.g., "10m", "1d", "2w", "3mo")
 */
export function formatInterval(days) {
  if (days < 1) {
    const minutes = Math.round(days * 24 * 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.round(minutes / 60)
    return `${hours}h`
  }
  if (days < 30) {
    return `${Math.round(days)}d`
  }
  if (days < 365) {
    const months = Math.round(days / 30)
    return `${months}mo`
  }
  const years = Math.round(days / 365 * 10) / 10
  return `${years}y`
}

/**
 * Get next intervals for all rating options (for button preview)
 * @param {Object} card - Current card state
 * @returns {Object} { again, hard, good, easy } intervals in formatted strings
 */
export function getNextIntervals(card) {
  const intervals = {}

  for (const [key, rating] of Object.entries(RATING)) {
    try {
      const { updatedCard } = calculateNextReview(card, rating)
      intervals[key.toLowerCase()] = formatInterval(updatedCard.interval_days)
    } catch (error) {
      intervals[key.toLowerCase()] = '?'
    }
  }

  return intervals
}

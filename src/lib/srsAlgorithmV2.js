/**
 * SM-2 Spaced Repetition Algorithm with Anki-style Learning Steps
 *
 * Learning Flow:
 * 1. New cards start at learning_step 0
 * 2. Must pass through all learning steps (in same session) before graduating
 * 3. Only after completing learning steps do they get scheduled for next day+
 */

// ============================================================
// CONSTANTS
// ============================================================

export const RATING = {
  AGAIN: 1, // Forgot - reset to step 0
  HARD: 2,  // Difficult - repeat current step or go back
  GOOD: 3,  // Normal - advance to next step or graduate
  EASY: 4,  // Easy - skip remaining steps and graduate
}

export const STATE = {
  NEW: 'new',               // Never reviewed
  LEARNING: 'learning',     // In learning steps (same session)
  REVIEW: 'review',         // Graduated, using SM-2 intervals
  RELEARNING: 'relearning', // Forgotten, back in learning steps
}

// Configuration
export const CONFIG = {
  // Learning steps (in minutes) - cards cycle through these WITHIN the same session
  // Only after completing do they graduate to next-day+ scheduling
  LEARNING_STEPS: [0.3, 10], // Step 0: <1 min (first cycle), Step 1: 10 min (second cycle), then graduate

  // Hard interval for first cycle (step 0)
  HARD_FIRST_CYCLE_INTERVAL: 6, // minutes (between Again <1m and Good 10m)

  // Graduating intervals (when completing final learning step)
  GRADUATING_INTERVAL_GOOD: 1,  // days (when rated Good on final step)
  GRADUATING_INTERVAL_EASY_FIRST: 1,  // days (when rated Easy at step 0 - skip to review)
  GRADUATING_INTERVAL_EASY_LATER: 4,  // days (when rated Easy at step 1+ - bonus interval)

  // Relearning steps (when card forgotten from review)
  RELEARNING_STEPS: [10],  // Single step before returning to review

  // Ease factor bounds
  STARTING_EASE: 2.5,
  MINIMUM_EASE: 1.3,

  // Interval bounds
  MINIMUM_INTERVAL: 1,
  MAXIMUM_INTERVAL: 365,

  // Interval modifiers
  HARD_INTERVAL_MULTIPLIER: 1.2,
  EASY_BONUS_MULTIPLIER: 1.3,

  // Ease adjustments
  HARD_EASE_PENALTY: -0.10,
  EASY_EASE_BONUS: 0.15,
  AGAIN_EASE_PENALTY: -0.2,

  // Fuzz factor
  FUZZ_FACTOR: 0.05,

  // New cards per day
  NEW_CARDS_PER_DAY: 20,

  // ============================================================
  // EXAM MODE SETTINGS
  // ============================================================
  // examDate is now passed dynamically, not hardcoded
  EXAM_INTERVAL_CAP_MULTIPLIER: 0.3,    // maxInterval = daysUntilExam × this (0.3 = ~3-4 reviews, sustainable for large decks)
  EARLY_REVIEW_EASE_CAP: 2.2,           // Cap ease for early reviews
  EARLY_REVIEW_THRESHOLD: 3,            // Apply cap until this many repetitions
  FIRST_REVIEW_INTERVAL: 4,             // Days for first review after graduation (was 6)
}

// ============================================================
// SM-2 WITH LEARNING STEPS
// ============================================================

/**
 * Calculate next review using SM-2 with learning steps
 * @param {Object} card - Current card state
 * @param {number} rating - User rating (1-4)
 * @param {Object} options - Optional settings
 * @param {number} options.reviewTimeMs - Time taken in milliseconds
 * @param {string} options.examDate - ISO date string for exam (affects max interval)
 * @returns {Object} { updatedCard, reviewLog }
 */
export function calculateNextReview(card, rating, options = {}) {
  const { reviewTimeMs = null, examDate = null } = options

  if (rating < RATING.AGAIN || rating > RATING.EASY) {
    throw new Error(`Invalid rating: ${rating}`)
  }

  // Calculate effective max interval based on exam date
  const maxInterval = getEffectiveMaxInterval(examDate)

  const {
    ease_factor = CONFIG.STARTING_EASE,
    interval_days = 0,
    repetitions = 0,
    state = STATE.NEW,
    lapse_count = 0,
    review_count = 0,
    learning_step = 0, // Which learning step (0-indexed)
  } = card

  // Safety check: ensure learning_step is valid
  const currentStep = typeof learning_step === 'number' && learning_step >= 0 ? learning_step : 0

  // Save state before review
  const stateBefore = {
    ease_factor_before: ease_factor,
    interval_before: interval_days,
    repetitions_before: repetitions,
    state_before: state,
    learning_step_before: learning_step,
  }

  let newEaseFactor = ease_factor
  let newInterval = interval_days
  let newRepetitions = repetitions
  let newState = state
  let newLapseCount = lapse_count
  let newLearningStep = currentStep

  // ============================================================
  // NEW / LEARNING CARDS (in learning phase)
  // ============================================================
  if (state === STATE.NEW || state === STATE.LEARNING) {
    if (rating === RATING.AGAIN) {
      // Failed - reset to beginning of learning
      newState = STATE.LEARNING
      newLearningStep = 0
      newInterval = minutesToDays(CONFIG.LEARNING_STEPS[0])
      newLapseCount += 1
      newRepetitions = 0
      newEaseFactor = Math.max(CONFIG.MINIMUM_EASE, ease_factor + CONFIG.AGAIN_EASE_PENALTY)
    }
    else if (rating === RATING.HARD) {
      // Repeat current step (don't advance)
      newState = STATE.LEARNING
      newLearningStep = currentStep // Stay at current step

      // Special interval for first cycle (step 0)
      if (currentStep === 0) {
        newInterval = minutesToDays(CONFIG.HARD_FIRST_CYCLE_INTERVAL)
      } else {
        newInterval = minutesToDays(CONFIG.LEARNING_STEPS[newLearningStep])
      }
    }
    else if (rating === RATING.GOOD) {
      // Advance to next step or graduate
      newState = STATE.LEARNING
      newLearningStep = currentStep + 1

      if (newLearningStep >= CONFIG.LEARNING_STEPS.length) {
        // Completed all learning steps - GRADUATE!
        newState = STATE.REVIEW
        newInterval = CONFIG.GRADUATING_INTERVAL_GOOD
        newRepetitions = 1
        newLearningStep = 0 // Reset for if it comes back to learning
      } else {
        // Move to next learning step
        newInterval = minutesToDays(CONFIG.LEARNING_STEPS[newLearningStep])
      }
    }
    else if (rating === RATING.EASY) {
      // Skip all remaining steps - graduate immediately
      newState = STATE.REVIEW
      // Different intervals based on which step Easy was pressed
      if (currentStep === 0) {
        // First cycle: 1 day (same as Good in second cycle)
        newInterval = CONFIG.GRADUATING_INTERVAL_EASY_FIRST
      } else {
        // Second cycle or later: 4 days (bonus for being easy after review)
        newInterval = CONFIG.GRADUATING_INTERVAL_EASY_LATER
      }
      newRepetitions = 1
      newLearningStep = 0
      newEaseFactor = ease_factor + CONFIG.EASY_EASE_BONUS
    }
  }

  // ============================================================
  // RELEARNING CARDS (forgotten from review, back in learning)
  // ============================================================
  else if (state === STATE.RELEARNING) {
    if (rating === RATING.AGAIN) {
      // Failed relearning - reset
      newState = STATE.RELEARNING
      newLearningStep = 0
      newInterval = minutesToDays(CONFIG.RELEARNING_STEPS[0])
      newLapseCount += 1
      newEaseFactor = Math.max(CONFIG.MINIMUM_EASE, ease_factor + CONFIG.AGAIN_EASE_PENALTY)
    }
    else if (rating === RATING.HARD) {
      // Repeat relearning step
      newState = STATE.RELEARNING
      newInterval = minutesToDays(CONFIG.RELEARNING_STEPS[currentStep] || CONFIG.RELEARNING_STEPS[0])
    }
    else if (rating === RATING.GOOD || rating === RATING.EASY) {
      // Graduate back to review
      newState = STATE.REVIEW
      newInterval = rating === RATING.EASY ?
        CONFIG.GRADUATING_INTERVAL_EASY_LATER :
        CONFIG.GRADUATING_INTERVAL_GOOD
      newLearningStep = 0
      if (rating === RATING.EASY) {
        newEaseFactor = ease_factor + CONFIG.EASY_EASE_BONUS
      }
    }
  }

  // ============================================================
  // REVIEW CARDS (graduated, using full SM-2)
  // ============================================================
  else if (state === STATE.REVIEW) {
    if (rating === RATING.AGAIN) {
      // Failed - back to relearning
      newState = STATE.RELEARNING
      newLearningStep = 0
      newInterval = minutesToDays(CONFIG.RELEARNING_STEPS[0])
      newLapseCount += 1
      newRepetitions = 0
      newEaseFactor = Math.max(CONFIG.MINIMUM_EASE, ease_factor + CONFIG.AGAIN_EASE_PENALTY)
    }
    else if (rating === RATING.HARD) {
      // Hard - stay in review with small interval increase
      newInterval = Math.min(
        interval_days * CONFIG.HARD_INTERVAL_MULTIPLIER,
        maxInterval
      )
      newEaseFactor = Math.max(CONFIG.MINIMUM_EASE, ease_factor + CONFIG.HARD_EASE_PENALTY)
      newRepetitions += 1
    }
    else if (rating === RATING.GOOD) {
      // Normal SM-2 progression (with exam mode adjustments)
      if (repetitions === 0) {
        newInterval = CONFIG.MINIMUM_INTERVAL
      } else if (repetitions === 1) {
        newInterval = CONFIG.FIRST_REVIEW_INTERVAL
      } else {
        // Apply early review ease cap ONLY when in exam mode
        const inExamMode = examDate && calculateDaysUntilExam(examDate) > 0
        const effectiveEase = (inExamMode && repetitions <= CONFIG.EARLY_REVIEW_THRESHOLD)
          ? Math.min(ease_factor, CONFIG.EARLY_REVIEW_EASE_CAP)
          : ease_factor
        newInterval = Math.min(
          interval_days * effectiveEase,
          maxInterval
        )
      }
      newRepetitions += 1
    }
    else if (rating === RATING.EASY) {
      // Easy - bonus interval (with exam mode adjustments)
      if (repetitions === 0) {
        newInterval = CONFIG.GRADUATING_INTERVAL_EASY_LATER
      } else if (repetitions === 1) {
        newInterval = CONFIG.FIRST_REVIEW_INTERVAL * CONFIG.EASY_BONUS_MULTIPLIER
      } else {
        // Apply early review ease cap ONLY when in exam mode
        const inExamMode = examDate && calculateDaysUntilExam(examDate) > 0
        const effectiveEase = (inExamMode && repetitions <= CONFIG.EARLY_REVIEW_THRESHOLD)
          ? Math.min(ease_factor, CONFIG.EARLY_REVIEW_EASE_CAP)
          : ease_factor
        newInterval = Math.min(
          interval_days * effectiveEase * CONFIG.EASY_BONUS_MULTIPLIER,
          maxInterval
        )
      }
      newRepetitions += 1
      newEaseFactor = ease_factor + CONFIG.EASY_EASE_BONUS
    }
  }

  // ============================================================
  // CALCULATE DUE DATE
  // ============================================================

  const now = new Date()
  let dueDate

  // For learning/relearning cards with interval < 1 day, use actual minutes
  if ((newState === STATE.LEARNING || newState === STATE.RELEARNING) && newInterval < 1) {
    const intervalMinutes = newInterval * 24 * 60
    dueDate = new Date(now.getTime() + intervalMinutes * 60 * 1000)
  } else {
    // For review cards, use days with fuzz
    const fuzzRange = newInterval * CONFIG.FUZZ_FACTOR
    const fuzzAmount = (Math.random() - 0.5) * 2 * fuzzRange
    const fuzzedInterval = Math.max(0, newInterval + fuzzAmount)
    dueDate = new Date(now.getTime() + fuzzedInterval * 24 * 60 * 60 * 1000)
  }

  // ============================================================
  // RETURN RESULTS
  // ============================================================

  const updatedCard = {
    ease_factor: newEaseFactor,
    interval_days: newInterval,
    repetitions: newRepetitions,
    due_date: dueDate.toISOString(),
    state: newState,
    lapse_count: newLapseCount,
    learning_step: newLearningStep,
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
    learning_step_after: newLearningStep,
    reviewed_at: now.toISOString(),
  }

  return { updatedCard, reviewLog }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Convert minutes to days (for interval storage)
 */
function minutesToDays(minutes) {
  return minutes / (24 * 60)
}

/**
 * Convert days to minutes
 */
function daysToMinutes(days) {
  return days * 24 * 60
}

/**
 * Calculate days until exam date
 * @param {string|null} examDate - ISO date string or null
 * @returns {number|null} Days until exam, or null if no valid future date
 */
function calculateDaysUntilExam(examDate) {
  if (!examDate) return null

  const exam = new Date(examDate)
  const now = new Date()

  // Normalize to start of day
  now.setHours(0, 0, 0, 0)
  exam.setHours(0, 0, 0, 0)

  const diffMs = exam - now
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  return diffDays > 0 ? diffDays : null
}

/**
 * Get effective max interval based on exam date
 * @param {string|null} examDate - ISO date string or null
 * @returns {number} Maximum interval in days
 */
function getEffectiveMaxInterval(examDate) {
  if (examDate) {
    const daysUntil = calculateDaysUntilExam(examDate)
    if (daysUntil && daysUntil > 0) {
      return Math.min(CONFIG.MAXIMUM_INTERVAL, daysUntil * CONFIG.EXAM_INTERVAL_CAP_MULTIPLIER)
    }
  }
  return CONFIG.MAXIMUM_INTERVAL
}

/**
 * Format interval for display
 */
export function formatInterval(days) {
  if (days < 1) {
    const minutes = Math.round(days * 24 * 60)
    if (minutes < 1) return '<1m'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.round(minutes / 60)
    return `${hours}h`
  }
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365 * 10) / 10}y`
}

/**
 * Get next intervals for button preview
 */
export function getNextIntervals(card) {
  const intervals = {}

  for (const [key, rating] of Object.entries(RATING)) {
    try {
      const { updatedCard } = calculateNextReview(card, rating)

      // Always show formatted interval (not "session")
      intervals[key.toLowerCase()] = formatInterval(updatedCard.interval_days)
    } catch (error) {
      intervals[key.toLowerCase()] = '?'
    }
  }

  return intervals
}

// Export other functions from original file...
export { shuffle, getDueCards, getNewCards, getReviewQueue, getForecast, calculateRetention, getAverageEase, getCardMaturity } from './srsAlgorithm.js'

import { supabase } from './supabase'

const PROGRESS_MATURE_INTERVAL_DAYS = 21

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Recompute lecture phase/progress from actual learning + flashcard SRS state.
 *
 * Phase rules:
 * - not_started: notes not generated
 * - learn: notes generated, Learn Mode not completed
 * - memorise: at least one NEW flashcard remains
 * - maintain: NEW flashcards are fully graduated
 *
 * Progress rules:
 * - 100% only when all lecture flashcards are in REVIEW with mature intervals (>=21d)
 * - Otherwise, progress reflects graduation + long-term maturity trajectory.
 */
export async function recomputeLectureProgress(lectureId, options = {}) {
  const { markLearnCompleted = false } = options

  try {
    const { data: lecture, error: lectureError } = await supabase
      .from('lectures')
      .select('id, notes_generated, phase')
      .eq('id', lectureId)
      .single()

    if (lectureError || !lecture) {
      throw new Error(lectureError?.message || 'Lecture not found')
    }

    const notesGenerated = lecture.notes_generated === true

    const { data: cards, error: cardsError } = await supabase
      .from('flashcards')
      .select('state, interval_days')
      .eq('lecture_id', lectureId)

    if (cardsError) {
      throw new Error(cardsError.message)
    }

    const totalCards = cards?.length || 0
    const newCards = (cards || []).filter((card) => card.state === 'new').length
    const reviewCards = (cards || []).filter((card) => card.state === 'review').length
    const relearningCards = (cards || []).filter((card) => card.state === 'relearning').length
    const matureReviewCards = (cards || []).filter((card) =>
      card.state === 'review' && Number(card.interval_days || 0) >= PROGRESS_MATURE_INTERVAL_DAYS
    ).length

    const legacyLearnComplete =
      lecture.phase === 'memorise' ||
      lecture.phase === 'maintain' ||
      lecture.phase === 'complete'
    const learnCompleted = markLearnCompleted || legacyLearnComplete

    let phase = 'not_started'
    if (notesGenerated) {
      if (totalCards > 0 && newCards === 0) {
        phase = 'maintain'
      } else if (totalCards > 0) {
        phase = 'memorise'
      } else {
        phase = learnCompleted ? 'memorise' : 'learn'
      }
    }

    let progress = 0
    if (!notesGenerated) {
      progress = 0
    } else {
      const graduatedRatio = totalCards > 0 ? (totalCards - newCards) / totalCards : 0
      const matureRatio = totalCards > 0 ? matureReviewCards / totalCards : 0
      const relearningRatio = totalCards > 0 ? relearningCards / totalCards : 0

      const longTermComplete =
        totalCards > 0 &&
        reviewCards === totalCards &&
        relearningCards === 0 &&
        matureReviewCards === totalCards

      if (longTermComplete) {
        progress = 100
      } else if (!learnCompleted) {
        // Keep progress early while user is still in Learn phase.
        progress = clamp(Math.round(5 + 20 * graduatedRatio), 5, 35)
      } else {
        // Main long-term trajectory: graduation + maturity, with relearning penalty.
        const weighted = 20 + 50 * graduatedRatio + 30 * matureRatio - 10 * relearningRatio
        progress = clamp(Math.round(weighted), 20, 99)
      }
    }

    const { error: updateError } = await supabase
      .from('lectures')
      .update({
        phase,
        progress,
      })
      .eq('id', lectureId)

    if (updateError) {
      throw new Error(updateError.message)
    }

    return {
      success: true,
      data: {
        lecture_id: lectureId,
        phase,
        progress,
        total_cards: totalCards,
        new_cards: newCards,
        review_cards: reviewCards,
        relearning_cards: relearningCards,
        mature_review_cards: matureReviewCards,
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * Upload a PDF file and process it with AI to extract learning objectives
 * @param {File} file - The PDF file to upload
 * @param {string} lectureId - The lecture ID to associate with
 * @param {string} userId - The current user's ID
 * @param {function} onProgress - Optional callback for upload progress
 * @param {string} userLearningObjectives - Optional user-provided learning objectives (one per line)
 * @returns {Promise<{success: boolean, error?: string, learning_objectives?: Array}>}
 */
export async function uploadAndProcessLecture(file, lectureId, userId, onProgress, userLearningObjectives = '') {
  try {
    // Validate file
    if (!file) {
      throw new Error('No file provided')
    }

    if (file.type !== 'application/pdf') {
      throw new Error('Only PDF files are supported')
    }

    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      throw new Error('File size must be less than 10MB')
    }

    // Generate file path: userId/lectureId/filename
    const timestamp = Date.now()
    const sanitisedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const filePath = `${userId}/${lectureId}/${timestamp}_${sanitisedName}`

    // Upload to Supabase Storage
    if (onProgress) onProgress({ stage: 'uploading', progress: 0 })

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('lecture-pdfs')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`)
    }

    if (onProgress) onProgress({ stage: 'uploading', progress: 100 })

    // Call the Edge Function to process the PDF
    if (onProgress) onProgress({ stage: 'processing', progress: 0 })

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token

    if (!accessToken) {
      throw new Error('Not authenticated')
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const functionUrl = `${supabaseUrl}/functions/v1/process-lecture`

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        lecture_id: lectureId,
        file_path: filePath,
        user_learning_objectives: userLearningObjectives,
      }),
    })

    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Processing failed')
    }

    if (onProgress) onProgress({ stage: 'complete', progress: 100 })

    return {
      success: true,
      learning_objectives: result.learning_objectives,
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * Update a learning objective's completion status
 * @param {string} lectureId - The lecture ID
 * @param {string} objectiveId - The objective ID to update
 * @param {boolean} completed - The new completion status
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateObjectiveCompletion(lectureId, objectiveId, completed) {
  try {
    // First fetch current objectives
    const { data: lecture, error: fetchError } = await supabase
      .from('lectures')
      .select('learning_objectives')
      .eq('id', lectureId)
      .single()

    if (fetchError) {
      throw new Error(`Failed to fetch lecture: ${fetchError.message}`)
    }

    const objectives = lecture.learning_objectives || []
    const updatedObjectives = objectives.map((obj) =>
      obj.id === objectiveId ? { ...obj, completed } : obj
    )

    // Update the lecture objective payload only.
    const { error: updateError } = await supabase
      .from('lectures')
      .update({
        learning_objectives: updatedObjectives,
      })
      .eq('id', lectureId)

    if (updateError) {
      throw new Error(`Failed to update: ${updateError.message}`)
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * Reset a lecture's notes and learning objectives
 * @param {string} lectureId - The lecture ID to reset
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function resetLectureNotes(lectureId) {
  try {
    const { error: updateError } = await supabase
      .from('lectures')
      .update({
        learning_objectives: null,
        notes: null,
        notes_generated: false,
        processed_at: null,
        progress: 0,
        phase: null,
        pdf_path: null,
      })
      .eq('id', lectureId)

    if (updateError) {
      throw new Error(`Failed to reset lecture: ${updateError.message}`)
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    }
  }
}

import { supabase } from './supabase'

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
    console.error('Upload and process error:', error)
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

    // Calculate progress percentage
    const completedCount = updatedObjectives.filter((obj) => obj.completed).length
    const progress = objectives.length > 0
      ? Math.round((completedCount / objectives.length) * 100)
      : 0

    // Determine phase based on progress
    let phase = 'learn'
    if (progress === 100) {
      phase = 'memorise'
    }

    // Update the lecture
    const { error: updateError } = await supabase
      .from('lectures')
      .update({
        learning_objectives: updatedObjectives,
        progress,
        phase,
      })
      .eq('id', lectureId)

    if (updateError) {
      throw new Error(`Failed to update: ${updateError.message}`)
    }

    return { success: true }
  } catch (error) {
    console.error('Update objective error:', error)
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
    console.error('Reset lecture error:', error)
    return {
      success: false,
      error: error.message,
    }
  }
}

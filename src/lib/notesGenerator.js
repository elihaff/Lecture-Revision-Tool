import { supabase } from './supabase'

/**
 * Convert a File to base64 string
 */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function callNotesFunction({
  supabaseUrl,
  accessToken,
  anonKey,
  body
}) {
  const endpoint = 'generate-notes'

  const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': anonKey,
    },
    body: JSON.stringify(body),
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = result?.error || `HTTP ${response.status}`
    throw new Error(`Notes generation failed: ${message}`)
  }

  if (!result.success) {
    throw new Error(`Notes generation failed: ${result.error || 'Unknown error'}`)
  }

  return result
}

/**
 * Generate notes from a PDF file using the Edge Function (no API key needed)
 * @param {File} pdfFile - The PDF file to process
 * @param {string} userLearningObjectives - Optional user-provided learning objectives
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function generateNotesFromPdf(pdfFile, userLearningObjectives = '', onProgress) {
  try {
    if (!pdfFile) {
      throw new Error('No PDF file provided')
    }

    // Convert PDF to base64
    if (onProgress) onProgress({ stage: 'reading', message: 'Reading PDF file...' })
    const base64Data = await fileToBase64(pdfFile)

    // Get user session for auth
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token

    if (!accessToken) {
      throw new Error('Please sign in to generate notes')
    }

    // Call Edge Function
    if (onProgress) onProgress({ stage: 'processing', message: 'AI is generating notes...' })

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    const result = await callNotesFunction({
      supabaseUrl,
      accessToken,
      anonKey,
      body: {
        pdf_base64: base64Data,
        user_learning_objectives: userLearningObjectives,
      }
    })

    if (onProgress) onProgress({ stage: 'complete', message: 'Notes generated!' })

    return {
      success: true,
      data: result.data
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Generate notes and save to Supabase
 * @param {File} pdfFile - The PDF file to process
 * @param {string} lectureId - The lecture ID to update
 * @param {string} userLearningObjectives - Optional user-provided learning objectives
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function generateAndSaveNotes(pdfFile, lectureId, userLearningObjectives = '', onProgress) {
  try {
    if (!pdfFile) {
      throw new Error('No PDF file provided')
    }

    // Convert PDF to base64
    if (onProgress) onProgress({ stage: 'reading', message: 'Reading PDF file...' })
    const base64Data = await fileToBase64(pdfFile)

    // Get user session for auth
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token

    if (!accessToken) {
      throw new Error('Please sign in to generate notes')
    }

    // Call Edge Function with lecture_id to save directly
    if (onProgress) onProgress({ stage: 'processing', message: 'AI is generating notes...' })

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    await callNotesFunction({
      supabaseUrl,
      accessToken,
      anonKey,
      body: {
        pdf_base64: base64Data,
        lecture_id: lectureId,
        user_learning_objectives: userLearningObjectives,
      }
    })

    if (onProgress) onProgress({ stage: 'complete', message: 'Notes saved!' })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}

// Legacy exports for backwards compatibility (no longer used)
export function getApiKey() {
  return '' // No longer needed
}

export function saveApiKey() {
  // No longer needed
}

/**
 * User Settings Service
 * Handles user preferences including exam date for adaptive scheduling
 */

import { supabase } from './supabase'

/**
 * Get user settings from database
 * @returns {Promise<{data: Object, error: Error}>}
 */
export async function getUserSettings() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: null, error: new Error('Not authenticated') }
  }

  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .single()

  // If no settings exist yet, return defaults
  if (error?.code === 'PGRST116') {
    return { data: { exam_date: null }, error: null }
  }

  return { data, error }
}

/**
 * Set the user's exam date
 * @param {string|null} examDate - ISO date string (YYYY-MM-DD) or null to clear
 * @returns {Promise<{data: Object, error: Error}>}
 */
export async function setExamDate(examDate) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: null, error: new Error('Not authenticated') }
  }

  const { data, error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: user.id,
      exam_date: examDate,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single()

  return { data, error }
}

/**
 * Calculate days until exam date
 * @param {string|null} examDate - ISO date string or null
 * @returns {number|null} Days until exam, or null if no valid future date
 */
export function calculateDaysUntilExam(examDate) {
  if (!examDate) return null

  const exam = new Date(examDate)
  const now = new Date()

  // Normalize to start of day for accurate day calculation
  now.setHours(0, 0, 0, 0)
  exam.setHours(0, 0, 0, 0)

  const diffMs = exam - now
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  // Return null if exam is today or in the past
  return diffDays > 0 ? diffDays : null
}

/**
 * Format exam date for display
 * @param {string|null} examDate - ISO date string or null
 * @returns {string} Formatted date or "Not set"
 */
export function formatExamDate(examDate) {
  if (!examDate) return 'Not set'

  const date = new Date(examDate)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

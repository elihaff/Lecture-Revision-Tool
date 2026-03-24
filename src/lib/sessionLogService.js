import { supabase } from './supabase'

function toStats(values = {}) {
  const again = Number(values.again ?? values.again_count ?? 0) || 0
  const hard = Number(values.hard ?? values.hard_count ?? 0) || 0
  const good = Number(values.good ?? values.good_count ?? 0) || 0
  const easy = Number(values.easy ?? values.easy_count ?? 0) || 0
  const cardsCovered = Number(values.cardsCovered ?? values.cards_covered_count ?? again + hard + good + easy) || 0
  const denominator = again + hard + good + easy
  const accuracy = denominator > 0 ? (good + easy) / denominator : 0

  return {
    again_count: again,
    hard_count: hard,
    good_count: good,
    easy_count: easy,
    cards_covered_count: cardsCovered,
    accuracy,
  }
}

export async function startStudySessionLog({
  sourceType,
  sessionMode,
  lectureId = null,
  filters = null,
  startedAt = new Date().toISOString(),
} = {}) {
  const { data: authData } = await supabase.auth.getUser()
  const userId = authData?.user?.id
  if (!userId) return { data: null, error: new Error('Not authenticated') }

  const payload = {
    user_id: userId,
    source_type: sourceType,
    session_mode: sessionMode,
    lecture_id: lectureId,
    filters_json: filters,
    started_at: startedAt,
    status: 'active',
    ...toStats(),
  }

  const { data, error } = await supabase
    .from('study_sessions')
    .insert([payload])
    .select('*')
    .single()

  return { data, error }
}

export async function updateStudySessionLog(sessionId, stats = {}) {
  if (!sessionId) return { data: null, error: null }

  const { data, error } = await supabase
    .from('study_sessions')
    .update({
      ...toStats(stats),
    })
    .eq('id', sessionId)
    .select('*')
    .single()

  return { data, error }
}

export async function closeStudySessionLog(sessionId, { status = 'completed', stats = {}, endedAt = new Date().toISOString() } = {}) {
  if (!sessionId) return { data: null, error: null }

  const { data, error } = await supabase
    .from('study_sessions')
    .update({
      ...toStats(stats),
      status,
      ended_at: endedAt,
    })
    .eq('id', sessionId)
    .select('*')
    .single()

  if (!error || status !== 'paused') {
    return { data, error }
  }

  const fallback = await supabase
    .from('study_sessions')
    .update({
      ...toStats(stats),
      status: 'abandoned',
      ended_at: endedAt,
    })
    .eq('id', sessionId)
    .select('*')
    .single()

  return { data: fallback.data, error: fallback.error }
}

export async function listStudySessions({ limit = 100 } = {}) {
  const { data: authData } = await supabase.auth.getUser()
  const userId = authData?.user?.id
  if (!userId) return { data: [], error: new Error('Not authenticated') }

  const { data, error } = await supabase
    .from('study_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit)

  return { data: data || [], error }
}

export async function deleteStudySession(sessionId) {
  if (!sessionId) return { error: new Error('Missing session id') }
  const { data: authData } = await supabase.auth.getUser()
  const userId = authData?.user?.id
  if (!userId) return { error: new Error('Not authenticated') }

  const { error } = await supabase
    .from('study_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId)

  return { error }
}

export async function clearStudySessions() {
  const { data: authData } = await supabase.auth.getUser()
  const userId = authData?.user?.id
  if (!userId) return { error: new Error('Not authenticated') }

  const { error } = await supabase
    .from('study_sessions')
    .delete()
    .eq('user_id', userId)

  return { error }
}

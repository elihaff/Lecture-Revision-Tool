import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STATE } from '../lib/srsAlgorithmV2'

function normalizeTagList(value) {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(normalized)]
}

function legacyTagsToList(tagsValue) {
  if (Array.isArray(tagsValue)) return normalizeTagList(tagsValue)
  if (!tagsValue || typeof tagsValue !== 'string') return []
  const raw = tagsValue.trim()
  if (!raw) return []
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

function getCardTags(card) {
  const legacyTags = legacyTagsToList(card?.tags)
  const contentTags = normalizeTagList(card?.content_tags || card?.contentTags)
  const customUserTags = normalizeTagList(card?.custom_user_tags || card?.customUserTags)
  const suggestedTags = getSuggestedTagsList(card?.ai_tag_suggestions || card?.aiTagSuggestions)
  return [...new Set([...legacyTags, ...contentTags, ...customUserTags, ...suggestedTags])]
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function dayKey(date) {
  return startOfDay(date).toISOString().slice(0, 10)
}

function fmtPct(numerator, denominator) {
  if (!denominator) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = Math.floor(sec / 60)
  const rem = Math.round(sec % 60)
  return `${min}m ${rem}s`
}

function fmtMinutes(totalMinutes) {
  const minutes = Math.round(totalMinutes || 0)
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

function SparkBars({ data = [], valueKey = 'value' }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey] || 0))
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const value = d[valueKey] || 0
        const width = Math.max(2, Math.round((value / max) * 100))
        return (
          <div key={d.label} className="flex items-center gap-2">
            <div className="w-14 text-xs text-secondary">{d.label}</div>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full" style={{ width: `${width}%` }} />
            </div>
            <div className="w-10 text-right text-xs text-primary">{value}</div>
          </div>
        )
      })}
    </div>
  )
}

export function StatsView({ user, onBack }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flashcards, setFlashcards] = useState([])
  const [reviewLogs30d, setReviewLogs30d] = useState([])
  const [reviewActivityDays365d, setReviewActivityDays365d] = useState([])
  const [modulesMap, setModulesMap] = useState({})
  const [lecturesMap, setLecturesMap] = useState({})

  useEffect(() => {
    loadStatsData()
  }, [])

  const loadStatsData = async () => {
    setLoading(true)
    setError('')
    try {
      const now = new Date()
      const d30 = addDays(startOfDay(now), -30).toISOString()
      const d365 = addDays(startOfDay(now), -365).toISOString()

      const [
        modulesRes,
        lecturesRes,
        flashcardsRes,
        logs30Res,
      ] = await Promise.all([
        supabase
          .from('modules')
          .select('id, name')
          .eq('user_id', user.id),
        supabase
          .from('lectures')
          .select('id, title, module_id')
          .eq('user_id', user.id),
        supabase
          .from('flashcards')
          .select('id, lecture_id, tags, content_tags, custom_user_tags, ai_tag_suggestions, state, due_date, interval_days, suspended, buried')
          .eq('user_id', user.id),
        supabase
          .from('review_logs')
          .select('flashcard_id, rating, time_taken_ms, state_before, state_after, reviewed_at')
          .eq('user_id', user.id)
          .gte('reviewed_at', d30)
          .order('reviewed_at', { ascending: true })
          .limit(10000),
      ])

      if (modulesRes.error) throw modulesRes.error
      if (lecturesRes.error) throw lecturesRes.error
      if (flashcardsRes.error) throw flashcardsRes.error
      if (logs30Res.error) throw logs30Res.error

      const activityDaysRes = await supabase
        .rpc('get_review_activity_days', { p_since: d365 })

      let activityDays = []
      if (activityDaysRes.error) {
        // Backward-compatible fallback if RPC is not deployed yet.
        const fallbackLogs365Res = await supabase
          .from('review_logs')
          .select('reviewed_at')
          .eq('user_id', user.id)
          .gte('reviewed_at', d365)
          .order('reviewed_at', { ascending: false })
          .limit(20000)
        if (fallbackLogs365Res.error) throw fallbackLogs365Res.error
        activityDays = [...new Set((fallbackLogs365Res.data || []).map((l) => String(l.reviewed_at).slice(0, 10)))]
      } else {
        activityDays = [...new Set((activityDaysRes.data || []).map((d) => String(d.activity_day).slice(0, 10)))]
      }

      const nextModulesMap = {}
      for (const mod of modulesRes.data || []) {
        nextModulesMap[mod.id] = mod
      }

      const nextLecturesMap = {}
      for (const lec of lecturesRes.data || []) {
        nextLecturesMap[lec.id] = lec
      }

      setModulesMap(nextModulesMap)
      setLecturesMap(nextLecturesMap)
      setFlashcards(flashcardsRes.data || [])
      setReviewLogs30d(logs30Res.data || [])
      setReviewActivityDays365d(activityDays)
    } catch (e) {
      setError(e?.message || 'Failed to load statistics')
    } finally {
      setLoading(false)
    }
  }

  const metrics = useMemo(() => {
    const now = new Date()
    const todayStart = startOfDay(now)
    const todayEnd = endOfDay(now)
    const tomorrowStart = addDays(todayStart, 1)
    const tomorrowEnd = endOfDay(tomorrowStart)

    const activeCards = flashcards.filter((c) => c?.suspended !== true && c?.buried !== true)
    const cardMap = {}
    for (const c of activeCards) cardMap[c.id] = c

    const logsToday = reviewLogs30d.filter((l) => {
      const t = new Date(l.reviewed_at)
      return t >= todayStart && t <= todayEnd
    })

    const reviewedToday = logsToday.length
    const newLearnedToday = logsToday.filter(
      (l) => (l.state_before === STATE.NEW || l.state_before === STATE.LEARNING) && l.state_after === STATE.REVIEW
    ).length
    const passToday = logsToday.filter((l) => l.rating >= 3).length
    const accuracyToday = fmtPct(passToday, reviewedToday)
    const totalTimeMsToday = logsToday.reduce((sum, l) => sum + (Number(l.time_taken_ms) || 0), 0)

    const activeDayKeys = new Set(reviewActivityDays365d)
    let streakDays = 0
    let cursor = startOfDay(now)
    while (activeDayKeys.has(dayKey(cursor))) {
      streakDays += 1
      cursor = addDays(cursor, -1)
    }

    const isReviewLike = (s) => s === STATE.REVIEW || s === STATE.RELEARNING
    const forecast = []
    const forecastCountsByDay = {}
    for (let i = 0; i < 7; i++) {
      const d = addDays(todayStart, i)
      const key = dayKey(d)
      forecastCountsByDay[key] = 0
      forecast.push({
        label: i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }),
        key,
        count: 0,
      })
    }

    let dueToday = 0
    let overdue = 0
    let dueTomorrow = 0
    let queueMixNew = 0
    let queueMixReviewDue = 0
    for (const card of activeCards) {
      if (card.state === STATE.NEW) queueMixNew += 1
      if (!isReviewLike(card.state) || !card.due_date) continue

      const due = new Date(card.due_date)
      if (Number.isNaN(due.getTime())) continue
      if (due <= todayEnd) {
        dueToday += 1
        queueMixReviewDue += 1
      }
      if (due < todayStart) overdue += 1
      if (due >= tomorrowStart && due <= tomorrowEnd) dueTomorrow += 1
      const key = dayKey(due)
      if (Object.prototype.hasOwnProperty.call(forecastCountsByDay, key)) {
        forecastCountsByDay[key] += 1
      }
    }
    for (const item of forecast) {
      item.count = forecastCountsByDay[item.key] || 0
    }

    const ratingCounts = { again: 0, hard: 0, good: 0, easy: 0 }
    let totalTimeMs30 = 0
    let reviewStateLogCount = 0
    let lapses = 0
    for (const log of reviewLogs30d) {
      const rating = Number(log.rating) || 0
      if (rating === 1) ratingCounts.again += 1
      else if (rating === 2) ratingCounts.hard += 1
      else if (rating === 3) ratingCounts.good += 1
      else if (rating === 4) ratingCounts.easy += 1
      totalTimeMs30 += Number(log.time_taken_ms) || 0
      if (log.state_before === STATE.REVIEW) {
        reviewStateLogCount += 1
        if (log.state_after === STATE.RELEARNING) lapses += 1
      }
    }
    const total30 = reviewLogs30d.length
    const pass30 = ratingCounts.good + ratingCounts.easy
    const retention30 = fmtPct(pass30, total30)
    const avgTimeMs30 = total30 > 0 ? totalTimeMs30 / total30 : 0
    const lapseRate30 = fmtPct(lapses, reviewStateLogCount)

    const stateCounts = {
      new: activeCards.filter((c) => c.state === STATE.NEW).length,
      review: activeCards.filter((c) => c.state === STATE.REVIEW).length,
      relearning: activeCards.filter((c) => c.state === STATE.RELEARNING).length,
      learning: activeCards.filter((c) => c.state === STATE.LEARNING).length,
    }

    const graduatedByDay = {}
    for (const l of reviewLogs30d) {
      if (l.state_after === STATE.REVIEW && l.state_before !== STATE.REVIEW) {
        const k = String(l.reviewed_at).slice(0, 10)
        graduatedByDay[k] = (graduatedByDay[k] || 0) + 1
      }
    }
    const graduationSeries = []
    let cumulative = 0
    for (let i = 6; i >= 0; i--) {
      const d = addDays(todayStart, -i)
      const k = dayKey(d)
      cumulative += graduatedByDay[k] || 0
      graduationSeries.push({
        label: d.toLocaleDateString([], { weekday: 'short' }),
        value: cumulative,
      })
    }

    const masteryBuckets = {
      '<3d': 0,
      '3-7d': 0,
      '8-30d': 0,
      '30d+': 0,
    }
    for (const c of activeCards) {
      if (c.state !== STATE.REVIEW) continue
      const interval = Number(c.interval_days) || 0
      if (interval < 3) masteryBuckets['<3d']++
      else if (interval <= 7) masteryBuckets['3-7d']++
      else if (interval <= 30) masteryBuckets['8-30d']++
      else masteryBuckets['30d+']++
    }

    const moduleAgg = {}
    const tagAgg = {}
    for (const log of reviewLogs30d) {
      const card = cardMap[log.flashcard_id]
      if (!card) continue
      const lecture = lecturesMap[card.lecture_id]
      const moduleId = lecture?.module_id || 'unknown'
      const moduleName = moduleId === 'unknown'
        ? 'Unknown'
        : (modulesMap[moduleId]?.name || 'Unknown')

      if (!moduleAgg[moduleName]) moduleAgg[moduleName] = { total: 0, again: 0 }
      moduleAgg[moduleName].total += 1
      if (log.rating === 1) moduleAgg[moduleName].again += 1

      const tags = getCardTags(card)
      for (const tag of tags) {
        if (!tagAgg[tag]) tagAgg[tag] = { total: 0, again: 0 }
        tagAgg[tag].total += 1
        if (log.rating === 1) tagAgg[tag].again += 1
      }
    }

    const weakestModules = Object.entries(moduleAgg)
      .filter(([, v]) => v.total >= 5)
      .map(([name, v]) => ({ name, total: v.total, againRate: Math.round((v.again / v.total) * 100) }))
      .sort((a, b) => b.againRate - a.againRate || b.total - a.total)
      .slice(0, 5)

    const weakestTags = Object.entries(tagAgg)
      .filter(([, v]) => v.total >= 5)
      .map(([name, v]) => ({ name, total: v.total, againRate: Math.round((v.again / v.total) * 100) }))
      .sort((a, b) => b.againRate - a.againRate || b.total - a.total)
      .slice(0, 8)

    return {
      today: {
        reviewedToday,
        newLearnedToday,
        accuracyToday,
        studyTimeToday: fmtMinutes(totalTimeMsToday / 60000),
        streakDays,
      },
      workload: {
        dueToday,
        overdue,
        dueTomorrow,
        forecast,
        queueMixNew,
        queueMixReviewDue,
      },
      performance: {
        total30,
        ratingCounts,
        retention30,
        avgTime30: fmtMs(avgTimeMs30),
        lapseRate30,
      },
      progress: {
        stateCounts,
        graduationSeries,
        masteryBuckets,
      },
      content: {
        weakestModules,
        weakestTags,
      },
    }
  }, [flashcards, lecturesMap, modulesMap, reviewLogs30d, reviewActivityDays365d])

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Stats</h1>
          <p className="text-secondary mt-1">Today snapshot, workload, performance, and weak spots</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-secondary py-8">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading statistics...</span>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          Failed to load stats: {error}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-surface rounded-xl border border-divider p-5">
            <h2 className="text-lg font-semibold text-primary mb-4">Today Snapshot</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <StatCard label="Reviewed Today" value={metrics.today.reviewedToday} />
              <StatCard label="New Learned Today" value={metrics.today.newLearnedToday} />
              <StatCard label="Accuracy Today" value={metrics.today.accuracyToday} />
              <StatCard label="Study Time Today" value={metrics.today.studyTimeToday} />
              <StatCard label="Streak" value={`${metrics.today.streakDays}d`} />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-surface rounded-xl border border-divider p-5">
              <h2 className="text-lg font-semibold text-primary mb-4">Workload</h2>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <StatCard label="Due Today" value={metrics.workload.dueToday} compact />
                <StatCard label="Overdue" value={metrics.workload.overdue} compact />
                <StatCard label="Due Tomorrow" value={metrics.workload.dueTomorrow} compact />
              </div>
              <p className="text-sm font-medium text-primary mb-2">7-Day Due Forecast</p>
              <SparkBars data={metrics.workload.forecast.map((d) => ({ label: d.label, value: d.count }))} />
              <div className="mt-4 text-sm text-secondary">
                Queue mix: {metrics.workload.queueMixNew} new cards, {metrics.workload.queueMixReviewDue} due review cards
              </div>
            </div>

            <div className="bg-surface rounded-xl border border-divider p-5">
              <h2 className="text-lg font-semibold text-primary mb-4">Performance (Last 30 Days)</h2>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <StatCard label="Retention Proxy" value={metrics.performance.retention30} compact />
                <StatCard label="Avg Response Time" value={metrics.performance.avgTime30} compact />
                <StatCard label="Lapse Rate" value={metrics.performance.lapseRate30} compact />
                <StatCard label="Total Reviews" value={metrics.performance.total30} compact />
              </div>

              <div className="space-y-2">
                <RatingRow label="Again" value={metrics.performance.ratingCounts.again} color="bg-red-500" />
                <RatingRow label="Hard" value={metrics.performance.ratingCounts.hard} color="bg-orange-500" />
                <RatingRow label="Good" value={metrics.performance.ratingCounts.good} color="bg-green-500" />
                <RatingRow label="Easy" value={metrics.performance.ratingCounts.easy} color="bg-blue-500" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-surface rounded-xl border border-divider p-5">
              <h2 className="text-lg font-semibold text-primary mb-4">Progress</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <StatCard label="New" value={metrics.progress.stateCounts.new} compact />
                <StatCard label="Review" value={metrics.progress.stateCounts.review} compact />
                <StatCard label="Relearning" value={metrics.progress.stateCounts.relearning} compact />
                <StatCard label="Learning" value={metrics.progress.stateCounts.learning} compact />
              </div>
              <p className="text-sm font-medium text-primary mb-2">Graduations (Last 7 Days, cumulative)</p>
              <SparkBars data={metrics.progress.graduationSeries} />
              <p className="text-sm font-medium text-primary mt-5 mb-2">Mastery Buckets (Review cards)</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(metrics.progress.masteryBuckets).map(([bucket, value]) => (
                  <StatCard key={bucket} label={bucket} value={value} compact />
                ))}
              </div>
            </div>

            <div className="bg-surface rounded-xl border border-divider p-5">
              <h2 className="text-lg font-semibold text-primary mb-4">Weak Spots (Last 30 Days)</h2>
              <div className="mb-5">
                <p className="text-sm font-medium text-primary mb-2">Modules by Again rate</p>
                {metrics.content.weakestModules.length === 0 ? (
                  <p className="text-sm text-secondary">Not enough review volume yet (need at least 5 reviews per module).</p>
                ) : (
                  <div className="space-y-2">
                    {metrics.content.weakestModules.map((m) => (
                      <div key={m.name} className="flex items-center justify-between text-sm">
                        <span className="text-primary">{m.name}</span>
                        <span className="text-secondary">{m.againRate}% again ({m.total})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-primary mb-2">Topic tags by Again rate</p>
                {metrics.content.weakestTags.length === 0 ? (
                  <p className="text-sm text-secondary">Not enough review volume yet (need at least 5 reviews per tag).</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {metrics.content.weakestTags.map((t) => (
                      <div key={t.name} className="flex items-center justify-between text-sm">
                        <span className="text-primary">{t.name}</span>
                        <span className="text-secondary">{t.againRate}% again ({t.total})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="text-xs text-secondary flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Data window: performance and weak spots use the last 30 days of reviews.
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, compact = false }) {
  return (
    <div className={`rounded-lg border border-divider bg-white ${compact ? 'p-3' : 'p-4'}`}>
      <div className={`${compact ? 'text-lg' : 'text-2xl'} font-bold text-primary`}>{value}</div>
      <div className="text-xs text-secondary mt-1">{label}</div>
    </div>
  )
}

function RatingRow({ label, value, color }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <div className="text-sm text-primary w-14">{label}</div>
      <div className="flex-1 h-2 bg-gray-100 rounded-full" />
      <div className="text-sm text-secondary w-12 text-right">{value}</div>
    </div>
  )
}

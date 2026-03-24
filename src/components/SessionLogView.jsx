import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, History, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { clearStudySessions, deleteStudySession, listStudySessions } from '../lib/sessionLogService'
import { loadPersistedSession } from '../lib/studySessionPersistence'
import { useToast } from './Toast'

const CARD_TYPE_LABELS = {
  text: 'Text',
  'image occlusion': 'Image Occlusion',
  interpretation: 'Interpretation',
}
const CARD_TYPE_IDS = Object.keys(CARD_TYPE_LABELS)
const DIFFICULTY_LABELS = {
  'very-hard': 'Very Hard',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
}
const DIFFICULTY_IDS = Object.keys(DIFFICULTY_LABELS)

function fmtStartClosestMinute(value) {
  if (!value) return 'Unknown'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Unknown'

  if (d.getSeconds() >= 30) {
    d.setMinutes(d.getMinutes() + 1)
  }
  d.setSeconds(0, 0)

  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtPct(value) {
  const pct = Math.max(0, Number(value || 0) * 100)
  return `${pct.toFixed(1)}%`
}

function sourceLabel(row, lecturesById) {
  if (row.source_type === 'lecture') {
    const title = lecturesById[row.lecture_id]?.title
    return title || 'Lecture'
  }
  if (row.source_type === 'custom') return 'Custom Study'
  return 'Global'
}

function modeLabel(mode) {
  return mode === 'new' ? 'New' : 'Review'
}

function statusLabel(status) {
  if (status === 'paused') return 'Paused'
  if (status === 'completed') return 'Completed'
  if (status === 'abandoned') return 'Paused'
  return 'Active'
}

function statusClasses(status) {
  if (status === 'paused' || status === 'abandoned') return 'bg-amber-100 text-amber-700'
  if (status === 'completed') return 'bg-green-100 text-green-700'
  return 'bg-blue-100 text-blue-700'
}

export function SessionLogView({ user, onBack }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [lecturesById, setLecturesById] = useState({})
  const [modulesById, setModulesById] = useState({})
  const [submodulesById, setSubmodulesById] = useState({})
  const [deletingIds, setDeletingIds] = useState({})
  const [clearingAll, setClearingAll] = useState(false)

  useEffect(() => {
    loadData()
  }, [user?.id])

  const loadData = async () => {
    setLoading(true)
    setError('')

    try {
      const [sessionsRes, lecturesRes, modulesRes, submodulesRes] = await Promise.all([
        listStudySessions({ limit: 50 }),
        supabase
          .from('lectures')
          .select('id, title, module_id, submodule_id')
          .eq('user_id', user.id),
        supabase
          .from('modules')
          .select('id, name, abbreviation')
          .eq('user_id', user.id),
        supabase
          .from('submodules')
          .select('id, name, module_id'),
      ])

      if (sessionsRes.error) throw sessionsRes.error
      if (lecturesRes.error) throw lecturesRes.error
      if (modulesRes.error) throw modulesRes.error
      if (submodulesRes.error) throw submodulesRes.error

      const map = {}
      ;(lecturesRes.data || []).forEach((lecture) => {
        map[lecture.id] = lecture
      })
      const moduleMap = {}
      ;(modulesRes?.data || []).forEach((module) => {
        moduleMap[module.id] = module
      })
      const submoduleMap = {}
      ;(submodulesRes?.data || []).forEach((submodule) => {
        submoduleMap[submodule.id] = submodule
      })

      setLecturesById(map)
      setModulesById(moduleMap)
      setSubmodulesById(submoduleMap)
      setRows(sessionsRes.data || [])
    } catch (e) {
      setError(e?.message || 'Failed to load session log')
    } finally {
      setLoading(false)
    }
  }

  const savedSessionsByResumeKey = useMemo(() => {
    if (!user?.id) return {}
    const keys = [
      { mode: 'review-global', scope: 'global' },
      { mode: 'custom-study', scope: 'custom-study' },
      ...rows
        .filter((row) => row.source_type === 'lecture' && row.lecture_id)
        .map((row) => ({ mode: 'learn-lecture', scope: `lecture:${row.lecture_id}` })),
    ]
    const unique = new Map()
    for (const entry of keys) {
      unique.set(`${entry.mode}|${entry.scope}`, entry)
    }

    const cache = {}
    for (const entry of unique.values()) {
      cache[`${entry.mode}|${entry.scope}`] = loadPersistedSession({
        userId: user.id,
        mode: entry.mode,
        scope: entry.scope,
      })
    }
    return cache
  }, [user?.id, rows])

  const lectureIdsByModule = useMemo(() => {
    const map = {}
    for (const lecture of Object.values(lecturesById)) {
      const moduleId = lecture?.module_id
      if (!moduleId) continue
      if (!map[moduleId]) map[moduleId] = new Set()
      map[moduleId].add(lecture.id)
    }
    return map
  }, [lecturesById])

  const lectureIdsBySubmodule = useMemo(() => {
    const map = {}
    for (const lecture of Object.values(lecturesById)) {
      const submoduleId = lecture?.submodule_id
      if (!submoduleId) continue
      if (!map[submoduleId]) map[submoduleId] = new Set()
      map[submoduleId].add(lecture.id)
    }
    return map
  }, [lecturesById])

  const normalized = useMemo(() => {
    return rows.map((row) => {
      const denominator = Number(row.again_count || 0) + Number(row.hard_count || 0) + Number(row.good_count || 0) + Number(row.easy_count || 0)
      const accuracy = denominator > 0
        ? (Number(row.good_count || 0) + Number(row.easy_count || 0)) / denominator
        : Number(row.accuracy || 0)

      let resumeMeta = null
      if (user?.id) {
        if (row.source_type === 'global') {
          resumeMeta = { mode: 'review-global', scope: 'global' }
        } else if (row.source_type === 'custom') {
          resumeMeta = { mode: 'custom-study', scope: 'custom-study' }
        } else if (row.source_type === 'lecture' && row.lecture_id) {
          resumeMeta = { mode: 'learn-lecture', scope: `lecture:${row.lecture_id}` }
        }
      }
      const saved = resumeMeta
        ? savedSessionsByResumeKey[`${resumeMeta.mode}|${resumeMeta.scope}`]
        : null
      const matchesSavedLog = !saved?.sessionLogId || saved.sessionLogId === row.id
      const canResume = Boolean(
        saved &&
        !saved.sessionComplete &&
        matchesSavedLog
      )
      const displayStatus = canResume ? 'paused' : row.status

      const customFiltersLines = (() => {
        if (row.source_type !== 'custom') return []
        const filters = row?.filters_json && typeof row.filters_json === 'object' ? row.filters_json : {}
        const selectedLectures = Array.isArray(filters.selectedLectures) ? filters.selectedLectures : []
        const selectedModuleFilters = Array.isArray(filters.selectedModuleFilters) ? filters.selectedModuleFilters : []
        const selectedSubmoduleFilters = Array.isArray(filters.selectedSubmoduleFilters) ? filters.selectedSubmoduleFilters : []
        const selectedTags = Array.isArray(filters.selectedTags) ? filters.selectedTags : []
        const selectedCardTypes = Array.isArray(filters.selectedCardTypes) ? filters.selectedCardTypes : []
        const selectedDifficulties = Array.isArray(filters.selectedDifficulties) ? filters.selectedDifficulties : []
        const hasPrimaryFilters = selectedLectures.length > 0 || selectedTags.length > 0
        if (!hasPrimaryFilters) return ['No filters']

        const lines = []
        const firstLineParts = []
        const moduleLabels = selectedModuleFilters
          .map((id) => modulesById[id])
          .filter(Boolean)
          .map((module) => module.abbreviation || module.name)
        if (moduleLabels.length > 0) {
          firstLineParts.push(`${moduleLabels.length === 1 ? 'Module' : 'Modules'}: ${moduleLabels.join(', ')}`)
        }
        const submoduleLabels = selectedSubmoduleFilters
          .map((id) => submodulesById[id])
          .filter(Boolean)
          .map((submodule) => submodule.name)
        if (submoduleLabels.length > 0) {
          firstLineParts.push(`${submoduleLabels.length === 1 ? 'Submodule' : 'Submodules'}: ${submoduleLabels.join(', ')}`)
        }
        const coveredLectureIds = new Set()
        for (const moduleId of selectedModuleFilters) {
          const ids = lectureIdsByModule[moduleId]
          if (!ids) continue
          ids.forEach((id) => coveredLectureIds.add(id))
        }
        for (const submoduleId of selectedSubmoduleFilters) {
          const ids = lectureIdsBySubmodule[submoduleId]
          if (!ids) continue
          ids.forEach((id) => coveredLectureIds.add(id))
        }
        const individualLectureDetails = selectedLectures
          .map((id) => lecturesById[id])
          .filter((lecture) => lecture && !coveredLectureIds.has(lecture.id))
        if (individualLectureDetails.length > 0) {
          const lectureText = individualLectureDetails.length <= 3
            ? individualLectureDetails.map((lecture) => lecture.title).join(', ')
            : `${individualLectureDetails.length} lectures selected`
          firstLineParts.push(`${individualLectureDetails.length === 1 ? 'Lecture' : 'Lectures'}: ${lectureText}`)
        }
        if (firstLineParts.length > 0) {
          lines.push(firstLineParts.join(' • '))
        }
        if (selectedTags.length > 0) {
          lines.push(`${selectedTags.length === 1 ? 'Tag' : 'Tags'}: ${selectedTags.join(', ')}`)
        }
        const allCardTypesSelected = CARD_TYPE_IDS.every((id) => selectedCardTypes.includes(id))
        if (!allCardTypesSelected && selectedCardTypes.length > 0) {
          lines.push(`${selectedCardTypes.length === 1 ? 'Card Type' : 'Card Types'}: ${selectedCardTypes.map((id) => CARD_TYPE_LABELS[id] || id).join(', ')}`)
        }
        const allDifficultiesSelected = DIFFICULTY_IDS.every((id) => selectedDifficulties.includes(id))
        if (row.session_mode === 'review' && !allDifficultiesSelected && selectedDifficulties.length > 0) {
          lines.push(`Difficulty: ${selectedDifficulties.map((id) => DIFFICULTY_LABELS[id] || id).join(', ')}`)
        }
        return lines.length > 0 ? lines : ['No filters']
      })()

      return {
        ...row,
        computed_accuracy: accuracy,
        can_resume: canResume,
        display_status: displayStatus,
        custom_filters_lines: customFiltersLines,
      }
    })
  }, [rows, user?.id, lecturesById, modulesById, submodulesById, savedSessionsByResumeKey, lectureIdsByModule, lectureIdsBySubmodule])

  const handleDeleteSession = async (sessionId) => {
    if (!sessionId) return
    const confirmed = window.confirm('Delete this session log entry?')
    if (!confirmed) return

    setDeletingIds((prev) => ({ ...prev, [sessionId]: true }))
    const { error: deleteError } = await deleteStudySession(sessionId)
    if (deleteError) {
      toast.error('Failed to delete session. Please try again.')
      setDeletingIds((prev) => ({ ...prev, [sessionId]: false }))
      return
    }
    setRows((prev) => prev.filter((row) => row.id !== sessionId))
    setDeletingIds((prev) => ({ ...prev, [sessionId]: false }))
  }

  const handleClearSessionLog = async () => {
    const confirmed = window.confirm('Clear the entire session log? This cannot be undone.')
    if (!confirmed) return

    setClearingAll(true)
    const { error: clearError } = await clearStudySessions()
    if (clearError) {
      toast.error('Failed to clear session log. Please try again.')
      setClearingAll(false)
      return
    }
    setRows([])
    setDeletingIds({})
    setClearingAll(false)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Session Log</h1>
          <p className="text-secondary mt-1">Your last 50 study sessions and performance</p>
        </div>
      </div>

      {loading ? (
        <div className="min-h-[240px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      ) : normalized.length === 0 ? (
        <div className="bg-surface rounded-xl border border-divider p-10 text-center">
          <History className="w-10 h-10 text-secondary mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-primary mb-1">No sessions logged yet</h2>
          <p className="text-secondary text-sm">Complete a study session to populate this log.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {normalized.map((row) => (
            <div key={row.id} className="bg-surface rounded-xl border border-divider p-5">
              <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-primary">{fmtStartClosestMinute(row.started_at)}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-secondary">{sourceLabel(row, lecturesById)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusClasses(row.display_status)}`}>{statusLabel(row.display_status)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.can_resume && (
                        <button
                          onClick={() => onBack({ action: 'resume', row })}
                          className="px-3 py-1.5 bg-accent hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteSession(row.id)}
                        disabled={Boolean(deletingIds[row.id]) || clearingAll}
                        className="p-1.5 rounded-md text-secondary hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        aria-label="Delete session"
                      >
                        {deletingIds[row.id] ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  {row.source_type === 'custom' && Array.isArray(row.custom_filters_lines) && row.custom_filters_lines.length > 0 && (
                    <div className="text-xs text-secondary space-y-0.5">
                      {row.custom_filters_lines.map((line, idx) => (
                        <p key={`${row.id}-filter-line-${idx}`}>{line}</p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-secondary text-xs mb-1">Mode</div>
                    <div className="text-primary font-semibold">{modeLabel(row.session_mode)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-secondary text-xs mb-1">Cards Covered</div>
                    <div className="text-primary font-semibold">{row.cards_covered_count || 0}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-secondary text-xs mb-1">Accuracy</div>
                    <div className="text-primary font-semibold">{fmtPct(row.computed_accuracy)}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="pt-2 flex justify-end">
            <button
              onClick={handleClearSessionLog}
              disabled={clearingAll || normalized.length === 0}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {clearingAll ? 'Clearing...' : 'Clear Session Log'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Loader2, ChevronDown, ChevronRight, Play, Check, BookOpen, Tag, Gauge, Edit2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getCustomStudyCards, getUniqueTagsWithCounts, recordReview, getDifficultyBucket, getCardDisplayTags, updateFlashcard } from '../lib/flashcardService'
import { getUserSettings } from '../lib/userSettingsService'
import { RATING, getNextIntervals, STATE } from '../lib/srsAlgorithmV2'
import { sanitizeHtml } from '../lib/htmlSanitizer'
import { clearPersistedSession, formatSavedTime, loadPersistedSession, persistSession } from '../lib/studySessionPersistence'
import { closeStudySessionLog, startStudySessionLog, updateStudySessionLog } from '../lib/sessionLogService'
import { useToast } from './Toast'

// Tag categories for grouping in UI
const TAG_CATEGORIES = {
  organ: ['heart', 'lungs', 'kidneys', 'liver', 'brain', 'spinal cord', 'nerves', 'blood', 'vessels', 'gastrointestinal', 'muscle', 'bone', 'skin', 'eye', 'ear'],
  system: ['cardiovascular', 'respiratory', 'renal', 'neurology', 'endocrine', 'reproductive', 'haematology'],
  region: ['head & neck', 'thorax', 'abdomen', 'pelvis', 'upper limb', 'lower limb'],
  discipline: ['anatomy', 'physiology', 'pathology', 'pharmacology', 'histology', 'embryology', 'biochemistry', 'genetics', 'microbiology', 'immunology'],
  process: ['innervation', 'blood supply', 'conduction', 'circulation', 'ventilation', 'metabolism', 'hormones', 'acid-base', 'electrolytes', 'fluid balance', 'inflammation', 'nutrition'],
  clinical: ['diagnostics', 'treatment'],
}

const CATEGORY_LABELS = {
  organ: 'Organ',
  system: 'System',
  region: 'Region',
  discipline: 'Discipline',
  process: 'Process',
  clinical: 'Clinical',
  other: 'Other',
}

const REVIEW_DIFFICULTY_OPTIONS = [
  { id: 'very-hard', label: 'Very Hard' },
  { id: 'hard', label: 'Hard' },
  { id: 'medium', label: 'Medium' },
  { id: 'easy', label: 'Easy' },
]

const CARD_TYPE_OPTIONS = [
  { id: 'text', label: 'Text' },
  { id: 'image occlusion', label: 'Image Occlusion' },
  { id: 'interpretation', label: 'Interpretation' },
]
const CARD_TYPE_LABELS = Object.fromEntries(CARD_TYPE_OPTIONS.map((option) => [option.id, option.label]))
const DIFFICULTY_LABELS = Object.fromEntries(REVIEW_DIFFICULTY_OPTIONS.map((option) => [option.id, option.label]))

const BATCH_SIZE = 20
const ESSENTIAL_SYMBOLS = ['α', 'β', 'Δ', 'μ', '→', '←', '↑', '↓']

function formatCardStateLabel(state) {
  if (!state) return ''
  const value = String(state).trim()
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function stripHtmlTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeInterpretationQuestion(value) {
  return String(value || '')
    .replace(/&lt;br\s*\/?&gt;/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function formatQuestionForFrontHtml(question) {
  const normalized = String(question || '').trim()
  if (!normalized) return ''
  return escapeHtml(normalized).replace(/\n/g, '<br>')
}

function getOcclusionData(card) {
  return card?.occlusion_data || card?.occlusionData || null
}

function getInterpretationData(card) {
  return card?.interpretation_data || card?.interpretationData || null
}

function extractImageAndQuestionFromFront(frontHtml) {
  const front = String(frontHtml || '')
  const srcMatch = front.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)
  const imageDataUrl = srcMatch?.[1] || ''
  const withoutImage = front.replace(/<img[^>]*>/gi, '')
  const questionText = normalizeInterpretationQuestion(withoutImage)
  return { imageDataUrl, questionText }
}

function inferCardKind(card) {
  if (getOcclusionData(card)) return 'occlusion'
  if (getInterpretationData(card)) return 'interpretation'
  const tags = getCardDisplayTags(card).map((tag) => String(tag || '').toLowerCase())
  if (tags.includes('image occlusion')) return 'occlusion'
  if (tags.includes('interpretation')) return 'interpretation'
  return 'text'
}

function createMaskedImage(imageDataUrl, labelToMask) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to create drawing context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      const x = (Number(labelToMask.x || 0) / 100) * img.width
      const y = (Number(labelToMask.y || 0) / 100) * img.height
      const width = (Number(labelToMask.width || 0) / 100) * img.width
      const height = (Number(labelToMask.height || 0) / 100) * img.height
      ctx.fillStyle = '#000000'
      ctx.fillRect(x, y, width, height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image for occlusion rendering'))
    img.src = imageDataUrl
  })
}

function getInitialContentTags(card) {
  const normalizeTopicTags = (values) => {
    const blocked = new Set(['text', 'image occlusion', 'interpretation'])
    return [...new Set((values || [])
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter((tag) => tag && !blocked.has(tag)))]
  }
  const directTags = Array.isArray(card?.content_tags)
    ? card.content_tags
    : Array.isArray(card?.contentTags)
      ? card.contentTags
      : null
  if (Array.isArray(directTags) && directTags.length > 0) return normalizeTopicTags(directTags)
  const customTags = Array.isArray(card?.custom_user_tags)
    ? card.custom_user_tags
    : Array.isArray(card?.customUserTags)
      ? card.customUserTags
      : null
  if (Array.isArray(customTags) && customTags.length > 0) return normalizeTopicTags(customTags)
  const legacyTags = String(card?.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  if (legacyTags.length > 0) return normalizeTopicTags(legacyTags)
  const aiSuggestions = card?.ai_tag_suggestions || card?.aiTagSuggestions
  const aiTags = Array.isArray(aiSuggestions?.content_tags)
    ? aiSuggestions.content_tags
    : Array.isArray(aiSuggestions?.contentTags)
      ? aiSuggestions.contentTags
      : []
  const normalizedAiTags = normalizeTopicTags(aiTags)
  if (normalizedAiTags.length > 0) return normalizedAiTags
  return normalizeTopicTags(getCardDisplayTags(card))
}

export function CustomStudyView({ user, onBack, autoResumeFromLog = false, onAutoResumeHandled = null }) {
  const toast = useToast()
  // UI step: 'filter' | 'session' | 'batch-complete' | 'complete'
  const [step, setStep] = useState('filter')

  // Loading states
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [filterLoadError, setFilterLoadError] = useState('')

  // Filter data
  const [modules, setModules] = useState([])
  const [tagCounts, setTagCounts] = useState({}) // { tag: count }

  // Filter selections
  const [expandedModules, setExpandedModules] = useState({})
  const [expandedSubmodules, setExpandedSubmodules] = useState({})
  const [expandedTagCategories, setExpandedTagCategories] = useState({})
  const [selectedLectures, setSelectedLectures] = useState([])
  const [selectedModuleFilters, setSelectedModuleFilters] = useState([])
  const [selectedSubmoduleFilters, setSelectedSubmoduleFilters] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedCardTypes, setSelectedCardTypes] = useState(() => CARD_TYPE_OPTIONS.map((option) => option.id))
  const [selectedDifficulties, setSelectedDifficulties] = useState(() => REVIEW_DIFFICULTY_OPTIONS.map((option) => option.id))
  const [sessionMode, setSessionMode] = useState('review') // 'new' | 'review'
  const [cardLimitInput, setCardLimitInput] = useState('')
  const [difficultyCounts, setDifficultyCounts] = useState({})

  // Session state
  const [allCards, setAllCards] = useState([])
  const [currentBatchStart, setCurrentBatchStart] = useState(0)
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [examDate, setExamDate] = useState(null)
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 })
  const [reviewedCardIds, setReviewedCardIds] = useState([])
  const [reviewStartTime, setReviewStartTime] = useState(null)
  const [lectureMap, setLectureMap] = useState({})
  const [keyboardFlashRating, setKeyboardFlashRating] = useState(null)
  const [keyboardRatePending, setKeyboardRatePending] = useState(false)
  const [resumePrompt, setResumePrompt] = useState(null)
  const [sessionLogId, setSessionLogId] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editingCardDraft, setEditingCardDraft] = useState(null)
  const [editingOcclusionDraft, setEditingOcclusionDraft] = useState(null)
  const [editingCardKind, setEditingCardKind] = useState('text')
  const [drawingOcclusionBox, setDrawingOcclusionBox] = useState(null)
  const [didEditTags, setDidEditTags] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const keyboardFlashTimeoutRef = useRef(null)
  const sessionLogClosedRef = useRef(false)
  const pauseSessionOnUnmountRef = useRef(() => {})
  const editBackRef = useRef(null)
  const occlusionEditorRef = useRef(null)
  // Use refs to track stats immediately (React state updates are async)
  const sessionStatsRef = useRef({ again: 0, hard: 0, good: 0, easy: 0 })
  const reviewedCardIdsRef = useRef([])
  const sessionScope = 'custom-study'
  const sessionModeKey = 'custom-study'

  const getStatsSnapshot = (stats, coveredIds) => {
    // Prefer refs for immediate values, fall back to state
    const effectiveStats = stats || sessionStatsRef.current || sessionStats
    const effectiveCoveredIds = coveredIds || reviewedCardIdsRef.current || reviewedCardIds
    const again = Number(effectiveStats?.again || 0)
    const hard = Number(effectiveStats?.hard || 0)
    const good = Number(effectiveStats?.good || 0)
    const easy = Number(effectiveStats?.easy || 0)
    const cardsCovered = Array.isArray(effectiveCoveredIds) ? effectiveCoveredIds.length : 0
    return { again, hard, good, easy, cardsCovered }
  }

  const displayTagCategories = TAG_CATEGORIES

  // Load modules, lectures, and tag counts on mount
  useEffect(() => {
    loadFilterData()
  }, [])

  useEffect(() => {
    loadDifficultyCounts()
  }, [selectedLectures, selectedTags, selectedCardTypes, sessionMode])

  useEffect(() => {
    if (sessionMode !== 'review') {
      if (selectedDifficulties.length > 0) setSelectedDifficulties([])
      return
    }

    if (selectedDifficulties.length === 0) {
      setSelectedDifficulties(REVIEW_DIFFICULTY_OPTIONS.map((option) => option.id))
    }
  }, [sessionMode, selectedDifficulties.length])

  const hydrateSavedAllCards = async (saved) => {
    if (Array.isArray(saved?.allCards) && saved.allCards.length > 0) {
      return saved.allCards
    }
    const orderedIds = Array.isArray(saved?.allCardIds) ? saved.allCardIds.filter(Boolean) : []
    if (orderedIds.length === 0) return []

    const uniqueIds = [...new Set(orderedIds)]
    const { data, error } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', uniqueIds)
    if (error) {
      // Failed to hydrate saved session - non-critical
      return []
    }
    const byId = {}
    for (const card of data || []) byId[card.id] = card
    return orderedIds.map((id) => byId[id]).filter(Boolean)
  }

  const applySavedSession = async (saved) => {
    const hydratedAllCards = await hydrateSavedAllCards(saved)
    if (!Array.isArray(hydratedAllCards) || hydratedAllCards.length === 0) return false

    setSessionMode(saved.sessionMode || 'review')
    setSelectedLectures(Array.isArray(saved.selectedLectures) ? saved.selectedLectures : [])
    setSelectedModuleFilters(Array.isArray(saved.selectedModuleFilters) ? saved.selectedModuleFilters : [])
    setSelectedSubmoduleFilters(Array.isArray(saved.selectedSubmoduleFilters) ? saved.selectedSubmoduleFilters : [])
    setSelectedTags(Array.isArray(saved.selectedTags) ? saved.selectedTags : [])
    setSelectedCardTypes(Array.isArray(saved.selectedCardTypes) ? saved.selectedCardTypes : [])
    setSelectedDifficulties(Array.isArray(saved.selectedDifficulties) ? saved.selectedDifficulties : [])
    setCardLimitInput(saved.cardLimitInput || '')
    setSessionLogId(saved.sessionLogId || null)
    sessionLogClosedRef.current = false
    setAllCards(hydratedAllCards)
    setCurrentBatchStart(Number.isFinite(saved.currentBatchStart) ? saved.currentBatchStart : 0)
    setCurrentCardIndex(Number.isFinite(saved.currentCardIndex) ? saved.currentCardIndex : 0)
    setIsFlipped(Boolean(saved.isFlipped))
    const restoredStats = saved.sessionStats || { again: 0, hard: 0, good: 0, easy: 0 }
    const restoredReviewedCardIds = Array.isArray(saved.reviewedCardIds) ? saved.reviewedCardIds : []
    setSessionStats(restoredStats)
    sessionStatsRef.current = restoredStats
    setReviewedCardIds(restoredReviewedCardIds)
    reviewedCardIdsRef.current = restoredReviewedCardIds
    setReviewStartTime(saved.reviewStartTime || null)
    setStep(saved.step === 'batch-complete' ? 'batch-complete' : 'session')
    setResumePrompt(null)
    return true
  }

  const loadFilterData = async () => {
    setLoading(true)
    setFilterLoadError('')

    try {
      // Fetch modules with their lectures
      const { data: modulesData, error: modulesError } = await supabase
        .from('modules')
        .select('id, name, abbreviation, color')
        .eq('user_id', user.id)
        .order('display_order', { ascending: true })

      if (modulesError) {
        throw new Error(`Failed to load modules: ${modulesError.message}`)
      }

      const modulesWithLectures = []
      for (const mod of modulesData || []) {
        const { data: submodules, error: submodulesError } = await supabase
          .from('submodules')
          .select('id, name')
          .eq('module_id', mod.id)
          .order('display_order', { ascending: true })

        if (submodulesError) {
          throw new Error(`Failed to load submodules for module "${mod.name}": ${submodulesError.message}`)
        }

        const { data: lectures, error: lecturesError } = await supabase
          .from('lectures')
          .select('id, title, submodule_id')
          .eq('module_id', mod.id)
          .order('display_order', { ascending: true })

        if (lecturesError) {
          throw new Error(`Failed to load lectures for module "${mod.name}": ${lecturesError.message}`)
        }

        const allLectures = lectures || []
        const submodulesWithLectures = (submodules || []).map((submodule) => ({
          ...submodule,
          lectures: allLectures.filter((lecture) => lecture.submodule_id === submodule.id)
        }))

        modulesWithLectures.push({
          ...mod,
          lectures: allLectures,
          submodules: submodulesWithLectures,
          unassignedLectures: allLectures.filter((lecture) => !lecture.submodule_id)
        })
      }
      setModules(modulesWithLectures)

      // Build lecture map for later
      const lMap = {}
      for (const mod of modulesWithLectures) {
        for (const lec of mod.lectures) {
          lMap[lec.id] = {
            ...lec,
            module_id: mod.id,
            moduleTitle: mod.name,
            moduleAbbreviation: mod.abbreviation,
            moduleColor: mod.color,
          }
        }
      }
      setLectureMap(lMap)

      // Fetch tag counts
      const { data: tags, error: tagsError } = await getUniqueTagsWithCounts()
      if (tagsError) {
        throw new Error(`Failed to load tag counts: ${tagsError.message}`)
      }
      const counts = {}
      for (const { tag, count } of tags || []) {
        counts[tag] = count
      }
      setTagCounts(counts)

      // Fetch exam date
      const { data: settings } = await getUserSettings()
      if (settings?.exam_date) {
        setExamDate(settings.exam_date)
      }

      if (user?.id) {
        const saved = loadPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
        const hasSavedCards = (
          (Array.isArray(saved?.allCards) && saved.allCards.length > 0) ||
          (Array.isArray(saved?.allCardIds) && saved.allCardIds.length > 0)
        )
        if (saved && hasSavedCards && saved.step !== 'complete') {
          if (autoResumeFromLog) {
            await applySavedSession(saved)
            if (typeof onAutoResumeHandled === 'function') onAutoResumeHandled()
          } else {
            setResumePrompt(saved)
          }
        } else if (autoResumeFromLog && typeof onAutoResumeHandled === 'function') {
          onAutoResumeHandled()
        }
      }
    } catch (error) {
      // Failed to load filters
      setModules([])
      setLectureMap({})
      setTagCounts({})
      setFilterLoadError(error?.message || 'Failed to load module and lecture filters')
    } finally {
      setLoading(false)
    }
  }

  const persistCurrentSession = () => {
    if (!user?.id) return
    if (!['session', 'batch-complete'].includes(step) || !Array.isArray(allCards) || allCards.length === 0) {
      clearPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
      return
    }

    persistSession({
      userId: user.id,
      mode: sessionModeKey,
      scope: sessionScope,
      payload: {
        step,
        sessionMode,
        selectedLectures,
        selectedModuleFilters,
        selectedSubmoduleFilters,
        selectedTags,
        selectedCardTypes,
        selectedDifficulties,
        cardLimitInput,
        sessionLogId,
        allCardIds: allCards.map((card) => card.id),
        currentBatchStart,
        currentCardIndex,
        isFlipped,
        sessionStats,
        reviewedCardIds,
        reviewStartTime,
        examDate,
      }
    })
  }

  const pauseSessionIfActive = async () => {
    persistCurrentSession()
    const isActiveStep = step === 'session' || step === 'batch-complete'
    if (!isActiveStep) return
    if (!Array.isArray(allCards) || allCards.length === 0) return
    if (!sessionLogId || sessionLogClosedRef.current) return
    sessionLogClosedRef.current = true
    await closeStudySessionLog(sessionLogId, {
      status: 'paused',
      stats: getStatsSnapshot(),
    }).catch((error) => {
      // Session log pause failed - non-critical
    })
  }

  useEffect(() => {
    if (loading || resumePrompt) return
    persistCurrentSession()
  }, [
    loading,
    resumePrompt,
    step,
    sessionMode,
    selectedLectures,
    selectedModuleFilters,
    selectedSubmoduleFilters,
    selectedTags,
    selectedCardTypes,
    selectedDifficulties,
    cardLimitInput,
    sessionLogId,
    allCards,
    currentBatchStart,
    currentCardIndex,
    isFlipped,
    sessionStats,
    reviewedCardIds,
    reviewStartTime,
    examDate,
  ])

  useEffect(() => {
    if (loading || resumePrompt) return
    const onBeforeUnload = (event) => {
      pauseSessionIfActive()
    }
    const onPageHide = () => {
      pauseSessionIfActive()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistCurrentSession()
      }
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [
    loading,
    resumePrompt,
    step,
    sessionMode,
    selectedLectures,
    selectedModuleFilters,
    selectedSubmoduleFilters,
    selectedTags,
    selectedCardTypes,
    selectedDifficulties,
    cardLimitInput,
    sessionLogId,
    allCards,
    currentBatchStart,
    currentCardIndex,
    isFlipped,
    sessionStats,
    reviewedCardIds,
    reviewStartTime,
    examDate,
  ])

  useEffect(() => {
    pauseSessionOnUnmountRef.current = pauseSessionIfActive
  })

  useEffect(() => {
    return () => {
      pauseSessionOnUnmountRef.current()
    }
  }, [])

  const loadDifficultyCounts = async () => {
    const baseline = {}
    for (const option of REVIEW_DIFFICULTY_OPTIONS) baseline[option.id] = 0

    if (sessionMode !== 'review') {
      setDifficultyCounts(baseline)
      return
    }

    const { data: cards, error } = await getCustomStudyCards({
      lectureIds: selectedLectures.length > 0 ? selectedLectures : null,
      tags: selectedTags.length > 0 ? selectedTags : null,
      cardTypes: selectedCardTypes.length > 0 ? selectedCardTypes : null,
      mode: sessionMode,
      shuffle: false,
    })

    if (error) {
      setDifficultyCounts(baseline)
      return
    }

    for (const card of cards || []) {
      const bucket = getDifficultyBucket(card)
      baseline[bucket] = (baseline[bucket] || 0) + 1
    }

    setDifficultyCounts(baseline)
  }

  // Toggle module expansion
  const toggleModule = (moduleId) => {
    setExpandedModules(prev => ({ ...prev, [moduleId]: !prev[moduleId] }))
  }

  const toggleSubmodule = (submoduleId) => {
    setExpandedSubmodules(prev => ({ ...prev, [submoduleId]: !prev[submoduleId] }))
  }

  // Toggle lecture selection
  const toggleLecture = (lectureId) => {
    const lecture = lectureMap[lectureId]
    setSelectedLectures(prev =>
      prev.includes(lectureId)
        ? prev.filter(id => id !== lectureId)
        : [...prev, lectureId]
    )
    if (lecture?.module_id) {
      setSelectedModuleFilters((prev) => prev.filter((id) => id !== lecture.module_id))
    }
    if (lecture?.submodule_id) {
      setSelectedSubmoduleFilters((prev) => prev.filter((id) => id !== lecture.submodule_id))
    }
  }

  // Toggle all lectures in a module
  const toggleModuleLectures = (module) => {
    const lectureIds = module.lectures.map(l => l.id)
    const allSelected = lectureIds.every(id => selectedLectures.includes(id))

    if (allSelected) {
      setSelectedLectures(prev => prev.filter(id => !lectureIds.includes(id)))
      setSelectedModuleFilters((prev) => prev.filter((id) => id !== module.id))
      const submoduleIds = (module.submodules || []).map((submodule) => submodule.id)
      setSelectedSubmoduleFilters((prev) => prev.filter((id) => !submoduleIds.includes(id)))
    } else {
      setSelectedLectures(prev => [...new Set([...prev, ...lectureIds])])
      setSelectedModuleFilters((prev) => [...new Set([...prev, module.id])])
      const submoduleIds = (module.submodules || []).map((submodule) => submodule.id)
      if (submoduleIds.length > 0) {
        setSelectedSubmoduleFilters((prev) => prev.filter((id) => !submoduleIds.includes(id)))
      }
    }
  }

  const toggleSubmoduleLectures = (module, submodule) => {
    const lectureIds = (submodule?.lectures || []).map((l) => l.id)
    if (lectureIds.length === 0) return
    const allSelected = lectureIds.every((id) => selectedLectures.includes(id))

    if (allSelected) {
      setSelectedLectures((prev) => prev.filter((id) => !lectureIds.includes(id)))
      setSelectedSubmoduleFilters((prev) => prev.filter((id) => id !== submodule.id))
      setSelectedModuleFilters((prev) => prev.filter((id) => id !== module.id))
    } else {
      setSelectedLectures((prev) => [...new Set([...prev, ...lectureIds])])
      setSelectedSubmoduleFilters((prev) => [...new Set([...prev, submodule.id])])
      setSelectedModuleFilters((prev) => prev.filter((id) => id !== module.id))
    }
  }

  // Toggle tag selection
  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const toggleTagCategory = (category) => {
    setExpandedTagCategories(prev => ({ ...prev, [category]: !prev[category] }))
  }

  const toggleCategoryTags = (categoryTags) => {
    const allSelected = categoryTags.every((tag) => selectedTags.includes(tag))
    if (allSelected) {
      setSelectedTags(prev => prev.filter((tag) => !categoryTags.includes(tag)))
    } else {
      setSelectedTags(prev => [...new Set([...prev, ...categoryTags])])
    }
  }

  const toggleAllCardTypes = () => {
    const allIds = CARD_TYPE_OPTIONS.map((option) => option.id)
    const allSelected = allIds.every((id) => selectedCardTypes.includes(id))
    if (allSelected) {
      setSelectedCardTypes([])
    } else {
      setSelectedCardTypes(allIds)
    }
  }

  const allCardTypesSelected = CARD_TYPE_OPTIONS.length > 0 && CARD_TYPE_OPTIONS.every((idObj) => selectedCardTypes.includes(idObj.id))
  const someCardTypesSelected = selectedCardTypes.length > 0 && !allCardTypesSelected

  const toggleAllDifficulties = () => {
    const allIds = REVIEW_DIFFICULTY_OPTIONS.map((o) => o.id)
    const allSelected = allIds.every((id) => selectedDifficulties.includes(id))
    if (allSelected) {
      setSelectedDifficulties([])
    } else {
      setSelectedDifficulties(allIds)
    }
  }

  // Count matching cards (estimate for UI)
  const getMatchingCardCount = () => {
    // This is a rough estimate based on selected tags
    if (selectedTags.length === 0) {
      return Object.values(tagCounts).reduce((a, b) => a + b, 0)
    }
    // For OR logic, it's complex to estimate without querying
    // Just show sum of selected tag counts (overestimate due to overlap)
    return selectedTags.reduce((sum, tag) => sum + (tagCounts[tag] || 0), 0)
  }

  // Start session
  const startSession = async () => {
    setStarting(true)
    if (user?.id) {
      clearPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
    }
    setResumePrompt(null)

    const { data: cards, error } = await getCustomStudyCards({
      lectureIds: selectedLectures.length > 0 ? selectedLectures : null,
      tags: selectedTags.length > 0 ? selectedTags : null,
      cardTypes: selectedCardTypes.length > 0 ? selectedCardTypes : null,
      difficultyBuckets: sessionMode === 'review' && selectedDifficulties.length > 0 ? selectedDifficulties : null,
      mode: sessionMode,
      shuffle: true,
    })

    if (error) {
      toast.error('Failed to load cards. Please try again.')
      setStarting(false)
      return
    }

    if (cards.length === 0) {
      const modeHint = sessionMode === 'review'
        ? ' You are in Review Cards mode, which only includes cards already in review/relearning.'
        : ''
      toast.warn(`No cards match your filters.${modeHint} Try adjusting card type or session type.`)
      setStarting(false)
      return
    }

    const parsedLimit = Number.parseInt(cardLimitInput, 10)
    const hasValidLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    const limitedCards = hasValidLimit ? cards.slice(0, parsedLimit) : cards

    const { data: logRow } = await startStudySessionLog({
      sourceType: 'custom',
      sessionMode,
      filters: {
        selectedLectures,
        selectedModuleFilters,
        selectedSubmoduleFilters,
        selectedTags,
        selectedCardTypes,
        selectedDifficulties,
        cardLimitInput,
      },
    })

    setAllCards(limitedCards)
    setSessionLogId(logRow?.id || null)
    sessionLogClosedRef.current = false
    setCurrentBatchStart(0)
    setCurrentCardIndex(0)
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 })
    sessionStatsRef.current = { again: 0, hard: 0, good: 0, easy: 0 }
    setReviewedCardIds([])
    reviewedCardIdsRef.current = []
    setStep('session')
    setStarting(false)
  }

  // Current batch of cards
  const currentBatch = allCards.slice(currentBatchStart, currentBatchStart + BATCH_SIZE)
  const currentCard = currentBatch[currentCardIndex]
  const currentLectureInfo = lectureMap[currentCard?.lecture_id]
  const cardTags = getCardDisplayTags(currentCard)
  const totalReviewed = currentBatchStart + currentCardIndex
  const remainingAfterBatch = allCards.length - (currentBatchStart + BATCH_SIZE)
  const reviewedThisSession = reviewedCardIds.length
  const dueRemaining = Math.max(0, allCards.length - totalReviewed)
  const relearningRemaining = allCards
    .slice(totalReviewed)
    .filter((card) => card.state === STATE.RELEARNING).length
  const cycleCounts = currentBatch.reduce((acc, card) => {
    const step = Number(card?.learning_step || 0)
    if (card?.state === STATE.REVIEW) {
      acc.graduated += 1
    } else if (card?.state === STATE.LEARNING && step >= 1) {
      acc.secondCycle += 1
    } else if (card?.state === STATE.NEW || card?.state === STATE.LEARNING || card?.state === STATE.RELEARNING) {
      acc.firstCycle += 1
    }
    return acc
  }, { firstCycle: 0, secondCycle: 0, graduated: 0 })

  // Flip card
  const handleFlip = () => {
    if (!isFlipped) {
      setReviewStartTime(Date.now())
    }
    setIsFlipped(!isFlipped)
  }

  // Rate card
  const handleRate = async (rating) => {
    if (saving || !currentCard) return
    setSaving(true)

    const timeMs = reviewStartTime ? Date.now() - reviewStartTime : null

    // Record the review (updates SRS)
    const { data: updatedCard, error } = await recordReview(currentCard.id, rating, {
      reviewTimeMs: timeMs,
      examDate: examDate,
    })

    // Update refs immediately (these are synchronous, unlike React state)
    const ratingKey = ['', 'again', 'hard', 'good', 'easy'][rating]
    sessionStatsRef.current = {
      ...sessionStatsRef.current,
      [ratingKey]: (sessionStatsRef.current[ratingKey] || 0) + 1,
    }
    if (!reviewedCardIdsRef.current.includes(currentCard.id)) {
      reviewedCardIdsRef.current = [...reviewedCardIdsRef.current, currentCard.id]
    }

    if (error) {
      // Recording review failed
    } else if (updatedCard) {
      setReviewedCardIds([...reviewedCardIdsRef.current])
      const shouldRequeue = sessionMode === 'review' && (rating === RATING.AGAIN || rating === RATING.HARD)
      if (shouldRequeue) {
        setAllCards(prev => [...prev, { ...currentCard, ...updatedCard }])
      } else {
        setAllCards(prev => prev.map(card => card.id === currentCard.id ? { ...card, ...updatedCard } : card))
      }
    }

    // Update React state for UI rendering
    setSessionStats({ ...sessionStatsRef.current })

    if (sessionLogId && !sessionLogClosedRef.current) {
      updateStudySessionLog(sessionLogId, getStatsSnapshot(sessionStatsRef.current, reviewedCardIdsRef.current)).catch((err) => {
        // Session log update failed - non-critical
      })
    }

    // Move to next card
    const shouldRequeue = sessionMode === 'review' && (rating === RATING.AGAIN || rating === RATING.HARD)
    const projectedLength = allCards.length + (shouldRequeue ? 1 : 0)
    const nextAbsoluteIndex = totalReviewed + 1

    if (sessionMode === 'review') {
      if (nextAbsoluteIndex >= projectedLength) {
        if (user?.id) {
          clearPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
        }
        if (sessionLogId && !sessionLogClosedRef.current) {
          sessionLogClosedRef.current = true
          // Use refs directly as they have the most up-to-date values
          await closeStudySessionLog(sessionLogId, {
            status: 'completed',
            stats: getStatsSnapshot(sessionStatsRef.current, reviewedCardIdsRef.current),
          })
        }
        setStep('complete')
      } else {
        const nextBatchStart = Math.floor(nextAbsoluteIndex / BATCH_SIZE) * BATCH_SIZE
        setCurrentBatchStart(nextBatchStart)
        setCurrentCardIndex(nextAbsoluteIndex - nextBatchStart)
        setIsFlipped(false)
        setReviewStartTime(null)
      }
    } else if (currentCardIndex + 1 >= currentBatch.length) {
      // End of batch
      if (currentBatchStart + BATCH_SIZE >= allCards.length) {
        // No more cards
        if (user?.id) {
          clearPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
        }
        if (sessionLogId && !sessionLogClosedRef.current) {
          sessionLogClosedRef.current = true
          // Use refs directly as they have the most up-to-date values
          await closeStudySessionLog(sessionLogId, {
            status: 'completed',
            stats: getStatsSnapshot(sessionStatsRef.current, reviewedCardIdsRef.current),
          })
        }
        setStep('complete')
      } else {
        // More batches available
        setStep('batch-complete')
      }
    } else {
      setCurrentCardIndex(prev => prev + 1)
      setIsFlipped(false)
      setReviewStartTime(null)
    }

    setSaving(false)
  }

  const flashKeyboardRating = (rating) => {
    if (keyboardFlashTimeoutRef.current) {
      clearTimeout(keyboardFlashTimeoutRef.current)
    }
    setKeyboardFlashRating(rating)
    keyboardFlashTimeoutRef.current = window.setTimeout(() => {
      setKeyboardFlashRating(null)
      keyboardFlashTimeoutRef.current = null
    }, 140)
  }

  useEffect(() => {
    return () => {
      if (keyboardFlashTimeoutRef.current) {
        clearTimeout(keyboardFlashTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!target) return false
      const tag = target.tagName
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    const onKeyDown = (event) => {
      if (isEditableTarget(event.target)) return
      if (event.repeat) return
      if (step !== 'session' || saving || keyboardRatePending || !currentCard) return

      if (event.key === ' ') {
        if (!isFlipped) {
          event.preventDefault()
          handleFlip()
        }
        return
      }

      if (!isFlipped) return

      const key = event.key
      if (!['1', '2', '3', '4'].includes(key)) return
      event.preventDefault()

      const ratingMap = {
        '1': RATING.AGAIN,
        '2': RATING.HARD,
        '3': RATING.GOOD,
        '4': RATING.EASY,
      }

      const rating = ratingMap[key]
      flashKeyboardRating(rating)
      setKeyboardRatePending(true)
      window.setTimeout(async () => {
        await handleRate(rating)
        setKeyboardRatePending(false)
      }, 120)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, isFlipped, saving, keyboardRatePending, currentCard])

  // Continue to next batch
  const continueNextBatch = () => {
    setCurrentBatchStart(prev => prev + BATCH_SIZE)
    setCurrentCardIndex(0)
    setIsFlipped(false)
    setReviewStartTime(null)
    setStep('session')
  }

  // End session early
  const endSession = () => {
    if (user?.id) {
      clearPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
    }
    if (sessionLogId && !sessionLogClosedRef.current) {
      sessionLogClosedRef.current = true
      closeStudySessionLog(sessionLogId, {
        status: 'completed',
        stats: getStatsSnapshot(),
      }).catch((error) => {
        // Session log close failed - non-critical
      })
    }
    setStep('complete')
  }

  const handleResumeSaved = async () => {
    if (!resumePrompt) return
    await applySavedSession(resumePrompt)
  }

  const handleStartFresh = () => {
    if (sessionLogId && !sessionLogClosedRef.current) {
      sessionLogClosedRef.current = true
      closeStudySessionLog(sessionLogId, {
        status: 'paused',
        stats: getStatsSnapshot(),
      }).catch((error) => {
        // Session log pause failed - non-critical
      })
    }
    if (user?.id) {
      clearPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
    }
    setResumePrompt(null)
    setSessionLogId(null)
    setAllCards([])
    setCurrentBatchStart(0)
    setCurrentCardIndex(0)
    setIsFlipped(false)
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 })
    sessionStatsRef.current = { again: 0, hard: 0, good: 0, easy: 0 }
    setReviewedCardIds([])
    reviewedCardIdsRef.current = []
    setReviewStartTime(null)
    setStep('filter')
  }

  const handlePauseAndExit = async () => {
    await pauseSessionIfActive()
    onBack()
  }

  const handleDoneAndExit = () => {
    if (user?.id) {
      clearPersistedSession({ userId: user.id, mode: sessionModeKey, scope: sessionScope })
    }
    onBack()
  }

  const applyEditorCommand = (command, value = null) => {
    if (!editBackRef.current) return
    editBackRef.current.focus()
    if (value === null) {
      document.execCommand(command)
    } else {
      document.execCommand(command, false, value)
    }
    setTimeout(() => {
      if (editBackRef.current) {
        setEditingCardDraft((prev) => prev ? { ...prev, back: editBackRef.current.innerHTML } : prev)
      }
    }, 10)
  }

  const openEditModal = () => {
    if (!currentCard) return
    const contentTags = getInitialContentTags(currentCard)
    const cardKind = inferCardKind(currentCard)
    const occlusionData = getOcclusionData(currentCard)
    const interpretationData = getInterpretationData(currentCard)
    if (cardKind === 'occlusion') {
      const parsedFront = extractImageAndQuestionFromFront(currentCard.front)
      const label = occlusionData?.label || {}
      setEditingOcclusionDraft({
        questionText: occlusionData?.questionText || parsedFront.questionText || 'What is the masked structure?',
        labelText: label.text || String(currentCard.back || '').trim(),
        x: Number(label.x || 0),
        y: Number(label.y || 0),
        width: Number(label.width || 120),
        height: Number(label.height || 60),
        originalImage: occlusionData?.originalImage || parsedFront.imageDataUrl || '',
        contentTags,
      })
      setEditingCardDraft(null)
    } else if (cardKind === 'interpretation') {
      const interpretation = interpretationData || {}
      const parsedFront = extractImageAndQuestionFromFront(currentCard.front)
      setEditingCardDraft({
        front: normalizeInterpretationQuestion(interpretation.question || parsedFront.questionText || ''),
        back: currentCard.back || interpretation.answer || '',
        imageDataUrl: interpretation.imageDataUrl || parsedFront.imageDataUrl || '',
        contentTags,
      })
      setEditingOcclusionDraft(null)
    } else {
      setEditingCardDraft({
        front: currentCard.front || '',
        back: currentCard.back || '',
        contentTags,
      })
      setEditingOcclusionDraft(null)
    }
    setEditingCardKind(cardKind)
    setDidEditTags(false)
    setNewTagInput('')
    setShowEditModal(true)
  }

  const closeEditModal = () => {
    setShowEditModal(false)
    setEditingCardDraft(null)
    setEditingOcclusionDraft(null)
    setEditingCardKind('text')
    setDrawingOcclusionBox(null)
    setDidEditTags(false)
    setNewTagInput('')
  }

  const saveSessionEdit = async () => {
    if (!currentCard) return
    setEditSaving(true)
    try {
      if (editingCardKind === 'occlusion' && editingOcclusionDraft) {
        const questionText = String(editingOcclusionDraft.questionText || '').trim()
        const labelText = String(editingOcclusionDraft.labelText || '').trim()
        const contentTags = Array.isArray(editingOcclusionDraft.contentTags) ? editingOcclusionDraft.contentTags : []
        const label = {
          id: 'manual',
          x: Math.max(0, Number(editingOcclusionDraft.x || 0)),
          y: Math.max(0, Number(editingOcclusionDraft.y || 0)),
          width: Math.max(1, Number(editingOcclusionDraft.width || 1)),
          height: Math.max(1, Number(editingOcclusionDraft.height || 1)),
          text: labelText,
        }
        const maskedDataUrl = await createMaskedImage(editingOcclusionDraft.originalImage, label)
        const updates = {
          front: `<img src="${maskedDataUrl}" style="max-width:400px;"><br><br><br>${formatQuestionForFrontHtml(questionText)}`,
          back: labelText,
          occlusion_data: {
            originalImage: editingOcclusionDraft.originalImage,
            label,
            questionText,
          }
        }
        if (didEditTags) {
          updates.content_tags = contentTags
          updates.custom_user_tags = contentTags
          updates.ai_tag_suggestions = null
        }
        const { data, error: updateError } = await updateFlashcard(currentCard.id, updates)
        if (updateError) throw updateError
        const merged = { ...currentCard, ...(data || updates) }
        setAllCards((prev) => prev.map((card) => card.id === currentCard.id ? merged : card))
      } else if (editingCardDraft) {
        const contentTags = Array.isArray(editingCardDraft.contentTags) ? editingCardDraft.contentTags : []
        if (editingCardKind === 'interpretation') {
          const question = String(editingCardDraft.front || '').trim()
          const existingInterpretationData = getInterpretationData(currentCard) || {}
          const updates = {
            front: `<img src="${editingCardDraft.imageDataUrl}" style="max-width:400px;"><br><br><br>${formatQuestionForFrontHtml(question)}`,
            back: editingCardDraft.back || '',
            interpretation_data: {
              ...existingInterpretationData,
              imageDataUrl: editingCardDraft.imageDataUrl || existingInterpretationData.imageDataUrl || '',
              question: normalizeInterpretationQuestion(question),
              answer: stripHtmlTags(editingCardDraft.back || ''),
            }
          }
          if (didEditTags) {
            updates.content_tags = contentTags
            updates.custom_user_tags = contentTags
            updates.ai_tag_suggestions = null
          }
          const { data, error: updateError } = await updateFlashcard(currentCard.id, updates)
          if (updateError) throw updateError
          const merged = { ...currentCard, ...(data || updates) }
          setAllCards((prev) => prev.map((card) => card.id === currentCard.id ? merged : card))
        } else {
          const updates = {
            front: editingCardDraft.front || '',
            back: editingCardDraft.back || '',
          }
          if (didEditTags) {
            updates.content_tags = contentTags
            updates.custom_user_tags = contentTags
            updates.ai_tag_suggestions = null
          }
          const { data, error: updateError } = await updateFlashcard(currentCard.id, updates)
          if (updateError) throw updateError
          const merged = { ...currentCard, ...(data || updates) }
          setAllCards((prev) => prev.map((card) => card.id === currentCard.id ? merged : card))
        }
      }
      closeEditModal()
    } catch {
      toast.error('Failed to save flashcard changes. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  // Get next intervals for display
  const nextIntervals = currentCard ? getNextIntervals(currentCard) : {}

  // Loading state
  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  // Filter selection screen
  if (step === 'filter') {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-secondary" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-primary">Custom Study Session</h1>
            <p className="text-secondary mt-1">Select topics and cards to study</p>
          </div>
        </div>

        {resumePrompt && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
            <h2 className="text-sm font-semibold text-primary mb-1">Unfinished session found</h2>
            <p className="text-sm text-secondary mb-3">
              Saved {formatSavedTime(resumePrompt.savedAt)}. Resume where you left off?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleResumeSaved}
                className="px-3 py-2 bg-accent hover:bg-blue-600 text-white text-sm rounded-lg font-medium transition-colors"
              >
                Resume
              </button>
              <button
                onClick={handleStartFresh}
                className="px-3 py-2 bg-white hover:bg-gray-100 text-primary text-sm rounded-lg font-medium border border-divider transition-colors"
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {/* Session Mode */}
          <div className="bg-surface rounded-xl border border-divider p-6">
            <h2 className="text-lg font-semibold text-primary mb-4">Session Type</h2>
            <div className="flex gap-4">
              <label className={`flex-1 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                sessionMode === 'new' ? 'border-accent bg-blue-50' : 'border-divider hover:border-gray-300'
              }`}>
                <input
                  type="radio"
                  name="mode"
                  value="new"
                  checked={sessionMode === 'new'}
                  onChange={() => setSessionMode('new')}
                  className="sr-only"
                />
                <div className="font-medium text-primary">New Cards</div>
                <div className="text-sm text-secondary mt-1">Learn cards you haven't seen yet</div>
              </label>
              <label className={`flex-1 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                sessionMode === 'review' ? 'border-accent bg-blue-50' : 'border-divider hover:border-gray-300'
              }`}>
                <input
                  type="radio"
                  name="mode"
                  value="review"
                  checked={sessionMode === 'review'}
                  onChange={() => setSessionMode('review')}
                  className="sr-only"
                />
                <div className="font-medium text-primary">Review Cards</div>
                <div className="text-sm text-secondary mt-1">Review cards with existing progress</div>
              </label>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-primary mb-2">
                Card Cap (optional)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={cardLimitInput}
                onChange={(e) => setCardLimitInput(e.target.value)}
                placeholder="No cap"
                className="w-44 px-3 py-2 bg-background border border-divider rounded-lg text-primary focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
              />
              <p className="text-xs text-secondary mt-1">
                Leave blank to include all matching cards.
              </p>
            </div>
          </div>

          {/* Module/Lecture Filter */}
          <div className="bg-surface rounded-xl border border-divider p-6">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-secondary" />
              <h2 className="text-lg font-semibold text-primary">Filter by Module/Lecture</h2>
            </div>

            {modules.length === 0 ? (
              <p className="text-secondary text-sm">
                {filterLoadError || 'No modules found. Create some modules first.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {modules.map(module => {
                  const lectureIds = module.lectures.map(l => l.id)
                  const selectedCount = lectureIds.filter(id => selectedLectures.includes(id)).length
                  const allSelected = lectureIds.length > 0 && selectedCount === lectureIds.length
                  const someSelected = selectedCount > 0 && selectedCount < lectureIds.length

                  return (
                    <div key={module.id} className="border border-divider rounded-lg">
                      <div className="flex items-center gap-2 p-3">
                        <button
                          onClick={() => toggleModule(module.id)}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          {expandedModules[module.id] ? (
                            <ChevronDown className="w-4 h-4 text-secondary" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-secondary" />
                          )}
                        </button>
                        <label className="flex items-center gap-2 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected }}
                            onChange={() => toggleModuleLectures(module)}
                            className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                          />
                          <span className="font-medium text-primary">{module.name}</span>
                          <span className="text-sm text-secondary">({module.lectures.length} lectures)</span>
                        </label>
                      </div>

                      {expandedModules[module.id] && module.lectures.length > 0 && (
                        <div className="border-t border-divider bg-gray-50 p-3 pl-8 space-y-2">
                          {(module.submodules || []).map((submodule) => {
                            const lectureIds = submodule.lectures.map((l) => l.id)
                            const selectedCount = lectureIds.filter((id) => selectedLectures.includes(id)).length
                            const allSelected = lectureIds.length > 0 && selectedCount === lectureIds.length
                            const someSelected = selectedCount > 0 && selectedCount < lectureIds.length

                            return (
                              <div key={submodule.id} className="border border-divider rounded-lg bg-white">
                                <div className="flex items-center gap-2 p-2.5">
                                  <button
                                    onClick={() => toggleSubmodule(submodule.id)}
                                    className="p-1 hover:bg-gray-100 rounded"
                                  >
                                    {expandedSubmodules[submodule.id] ? (
                                      <ChevronDown className="w-4 h-4 text-secondary" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-secondary" />
                                    )}
                                  </button>
                                  <label className="flex items-center gap-2 flex-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={allSelected}
                                      ref={el => { if (el) el.indeterminate = someSelected }}
                                      onChange={() => toggleSubmoduleLectures(module, submodule)}
                                      className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                                    />
                                    <span className="text-sm font-medium text-primary">{submodule.name}</span>
                                    <span className="text-xs text-secondary">({submodule.lectures.length} lectures)</span>
                                  </label>
                                </div>

                                {expandedSubmodules[submodule.id] && (
                                  <div className="border-t border-divider bg-gray-50 p-2.5 pl-10 space-y-2">
                                    {submodule.lectures.length === 0 ? (
                                      <p className="text-xs text-secondary">No lectures in this submodule yet.</p>
                                    ) : (
                                      submodule.lectures.map((lecture) => (
                                        <label key={lecture.id} className="flex items-center gap-2 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={selectedLectures.includes(lecture.id)}
                                            onChange={() => toggleLecture(lecture.id)}
                                            className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                                          />
                                          <span className="text-sm text-primary">{lecture.title}</span>
                                        </label>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}

                          {module.unassignedLectures?.length > 0 && (
                            <div className="border border-divider rounded-lg bg-white p-2.5">
                              <p className="text-xs font-medium text-secondary mb-2">Unassigned Lectures</p>
                              <div className="space-y-2">
                                {module.unassignedLectures.map((lecture) => (
                                  <label key={lecture.id} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={selectedLectures.includes(lecture.id)}
                                      onChange={() => toggleLecture(lecture.id)}
                                      className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                                    />
                                    <span className="text-sm text-primary">{lecture.title}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {selectedLectures.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-secondary">{selectedLectures.length} lecture(s) selected</span>
                <button
                  onClick={() => setSelectedLectures([])}
                  className="text-sm text-accent hover:underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Topic Tags Filter */}
          <div className="bg-surface rounded-xl border border-divider p-6">
            <div className="flex items-center gap-2 mb-4">
              <Tag className="w-5 h-5 text-secondary" />
              <h2 className="text-lg font-semibold text-primary">Filter by Topic Tags</h2>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {Object.entries(displayTagCategories).map(([category, categoryTags]) => {
                const selectedCount = categoryTags.filter(tag => selectedTags.includes(tag)).length
                const allSelected = categoryTags.length > 0 && selectedCount === categoryTags.length
                const someSelected = selectedCount > 0 && selectedCount < categoryTags.length
                const categoryCount = categoryTags.reduce((sum, tag) => sum + (tagCounts[tag] || 0), 0)

                return (
                  <div key={category} className="border border-divider rounded-lg">
                    <div className="flex items-center gap-2 p-3">
                      <button
                        onClick={() => toggleTagCategory(category)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {expandedTagCategories[category] ? (
                          <ChevronDown className="w-4 h-4 text-secondary" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-secondary" />
                        )}
                      </button>
                      <label className="flex items-center gap-2 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected }}
                          onChange={() => toggleCategoryTags(categoryTags)}
                          className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                        />
                        <span className="font-medium text-primary">{CATEGORY_LABELS[category]}</span>
                        <span className="text-sm text-secondary">({categoryCount})</span>
                      </label>
                    </div>

                    {expandedTagCategories[category] && (
                      <div className="border-t border-divider bg-gray-50 p-3 pl-10 space-y-2">
                        {categoryTags.map((tag) => (
                          <label key={tag} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedTags.includes(tag)}
                              onChange={() => toggleTag(tag)}
                              className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                            />
                            <span className="text-sm text-primary">{tag}</span>
                            <span className="text-xs text-secondary">({tagCounts[tag] || 0})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {Object.keys(tagCounts).length === 0 && (
              <p className="text-secondary text-sm mt-3">
                No accepted tags yet; showing full AI tag taxonomy so you can still filter consistently.
              </p>
            )}

            {selectedTags.length > 0 && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-secondary">{selectedTags.length} tag(s) selected</span>
                <button
                  onClick={() => setSelectedTags([])}
                  className="text-sm text-accent hover:underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="bg-surface rounded-xl border border-divider p-6">
            <div className="flex items-center gap-2 mb-4">
              <Tag className="w-5 h-5 text-secondary" />
              <h2 className="text-lg font-semibold text-primary">Filter by Card Type</h2>
            </div>
            <div className="space-y-2">
              <div className="border border-divider rounded-lg">
                <label className="flex items-center gap-2 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allCardTypesSelected}
                    ref={el => { if (el) el.indeterminate = someCardTypesSelected }}
                    onChange={toggleAllCardTypes}
                    className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                  />
                  <span className="font-medium text-primary">Select all</span>
                </label>
              </div>
              {CARD_TYPE_OPTIONS.map((option) => (
                <div key={option.id} className="border border-divider rounded-lg bg-gray-50">
                  <label className="flex items-center gap-2 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCardTypes.includes(option.id)}
                      onChange={() => {
                        setSelectedCardTypes((prev) =>
                          prev.includes(option.id)
                            ? prev.filter((id) => id !== option.id)
                            : [...prev, option.id]
                        )
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                    />
                    <span className="text-sm text-primary">{option.label}</span>
                  </label>
                </div>
              ))}
            </div>
            {selectedCardTypes.length > 0 && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-secondary">{selectedCardTypes.length} card type(s) selected</span>
                <button
                  onClick={() => setSelectedCardTypes([])}
                  className="text-sm text-accent hover:underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Difficulty Filter (Review mode only) */}
          {sessionMode === 'review' && (
          <div className="bg-surface rounded-xl border border-divider p-6">
            <div className="flex items-center gap-2 mb-4">
              <Gauge className="w-5 h-5 text-secondary" />
              <h2 className="text-lg font-semibold text-primary">Filter by Difficulty</h2>
            </div>
            <p className="text-xs text-secondary mb-3">
              Based on previous review performance (ease, lapses, and relearning state).
            </p>
            {(() => {
              const allIds = REVIEW_DIFFICULTY_OPTIONS.map((option) => option.id)
              const allSelected = allIds.length > 0 && allIds.every((id) => selectedDifficulties.includes(id))
              const someSelected = selectedDifficulties.length > 0 && !allSelected

              return (
                <div className="space-y-2">
                  <div className="border border-divider rounded-lg">
                    <label className="flex items-center gap-2 p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected }}
                        onChange={toggleAllDifficulties}
                        className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                      />
                      <span className="font-medium text-primary">Select all</span>
                    </label>
                  </div>
                  {REVIEW_DIFFICULTY_OPTIONS.map((option) => (
                    <div key={option.id} className="border border-divider rounded-lg bg-gray-50">
                      <label className="flex items-center gap-2 p-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedDifficulties.includes(option.id)}
                          onChange={() => {
                            setSelectedDifficulties((prev) =>
                              prev.includes(option.id)
                                ? prev.filter((id) => id !== option.id)
                                : [...prev, option.id]
                            )
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                        />
                        <span className="text-sm text-primary">{option.label}</span>
                      </label>
                    </div>
                  ))}
                </div>
              )
            })()}

            {selectedDifficulties.length > 0 && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-secondary">{selectedDifficulties.length} difficulty bucket(s) selected</span>
                <button
                  onClick={() => setSelectedDifficulties([])}
                  className="text-sm text-accent hover:underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
          )}

          {/* Start Button */}
          <div className="bg-surface rounded-xl border border-divider p-6">
            <button
              onClick={startSession}
              disabled={starting}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-accent hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-xl font-medium transition-colors"
            >
              {starting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Start Session
                </>
              )}
            </button>
            {(() => {
              const applied = []
              if (selectedLectures.length > 0) applied.push(`${selectedLectures.length} lectures`)
              if (selectedTags.length > 0) applied.push(`${selectedTags.length} tags`)
              if (selectedCardTypes.length > 0) applied.push(`${selectedCardTypes.length} card types`)
              if (sessionMode === 'review' && selectedDifficulties.length > 0) {
                applied.push(`${selectedDifficulties.length} difficulty buckets`)
              }

              if (applied.length === 0) return null

              return (
                <p className="text-center text-sm text-secondary mt-2">
                  Filters applied: {applied.join(', ')}
                </p>
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  // Active study session
  if (step === 'session') {
    const modulesById = Object.fromEntries(modules.map((module) => [module.id, module]))
    const submodulesById = Object.fromEntries(
      modules.flatMap((module) => (module.submodules || []).map((submodule) => [submodule.id, submodule]))
    )
    const selectedLectureDetails = selectedLectures
      .map((id) => lectureMap[id])
      .filter(Boolean)
    const selectedModuleLabels = selectedModuleFilters
      .map((id) => modulesById[id])
      .filter(Boolean)
      .map((module) => module.abbreviation || module.name)
    const selectedSubmoduleLabels = selectedSubmoduleFilters
      .map((id) => submodulesById[id])
      .filter(Boolean)
      .map((submodule) => submodule.name)
    const coveredLectureIds = new Set()
    for (const moduleId of selectedModuleFilters) {
      const module = modulesById[moduleId]
      for (const lecture of module?.lectures || []) coveredLectureIds.add(lecture.id)
    }
    for (const submoduleId of selectedSubmoduleFilters) {
      const submodule = submodulesById[submoduleId]
      for (const lecture of submodule?.lectures || []) coveredLectureIds.add(lecture.id)
    }
    const individuallySelectedLectures = selectedLectureDetails.filter((lecture) => !coveredLectureIds.has(lecture.id))
    const lectureFilterText = individuallySelectedLectures.length <= 3
      ? individuallySelectedLectures.map((lecture) => lecture.title).join(', ')
      : `${individuallySelectedLectures.length} lectures selected`
    const tagsFilterText = selectedTags.join(', ')
    const allCardTypesSelectedForHeader = CARD_TYPE_OPTIONS.every((option) => selectedCardTypes.includes(option.id))
    const allDifficultiesSelectedForHeader = REVIEW_DIFFICULTY_OPTIONS.every((option) => selectedDifficulties.includes(option.id))
    const hasPrimaryFilters = selectedLectures.length > 0 || selectedTags.length > 0
    const headerFilters = []
    if (selectedModuleLabels.length > 0) {
      headerFilters.push(`${selectedModuleLabels.length === 1 ? 'Module' : 'Modules'}: ${selectedModuleLabels.join(', ')}`)
    }
    if (selectedSubmoduleLabels.length > 0) {
      headerFilters.push(`${selectedSubmoduleLabels.length === 1 ? 'Submodule' : 'Submodules'}: ${selectedSubmoduleLabels.join(', ')}`)
    }
    if (individuallySelectedLectures.length > 0) {
      headerFilters.push(`${individuallySelectedLectures.length === 1 ? 'Lecture' : 'Lectures'}: ${lectureFilterText}`)
    }
    if (selectedTags.length > 0) {
      headerFilters.push(`${selectedTags.length === 1 ? 'Tag' : 'Tags'}: ${tagsFilterText}`)
    }
    if (hasPrimaryFilters && !allCardTypesSelectedForHeader && selectedCardTypes.length > 0) {
      headerFilters.push(`${selectedCardTypes.length === 1 ? 'Card Type' : 'Card Types'}: ${selectedCardTypes.map((id) => CARD_TYPE_LABELS[id] || id).join(', ')}`)
    }
    if (hasPrimaryFilters && sessionMode === 'review' && !allDifficultiesSelectedForHeader && selectedDifficulties.length > 0) {
      headerFilters.push(`Difficulty: ${selectedDifficulties.map((id) => DIFFICULTY_LABELS[id] || id).join(', ')}`)
    }
    if (headerFilters.length === 0) {
      headerFilters.push('No filters')
    }

    return (
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={handlePauseAndExit} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-secondary" />
            </button>
          <div>
              <h1 className="text-xl font-bold text-primary">Study Session</h1>
              <p className="text-sm text-secondary">{headerFilters.join(' • ')}</p>
            </div>
          </div>
        </div>

        {sessionMode === 'new' && (
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500"></div>
              <span className="text-xs text-secondary">
                First Cycle: <span className="font-medium text-primary">{cycleCounts.firstCycle}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-xs text-secondary">
                Second Cycle: <span className="font-medium text-primary">{cycleCounts.secondCycle}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-xs text-secondary">
                Graduated: <span className="font-medium text-primary">{cycleCounts.graduated}</span>
              </span>
            </div>
          </div>
        )}

        {sessionMode === 'review' && (
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500"></div>
              <span className="text-xs text-secondary">
                Relearning: <span className="font-medium text-primary">{relearningRemaining}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-xs text-secondary">
                Due Remaining: <span className="font-medium text-primary">{dueRemaining}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-xs text-secondary">
                Reviewed This Session: <span className="font-medium text-primary">{reviewedThisSession}</span>
              </span>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="max-w-2xl mx-auto">
          <div
            onClick={handleFlip}
            className="bg-surface rounded-2xl border border-divider p-8 min-h-[300px] cursor-pointer hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                {formatCardStateLabel(currentCard?.state)}
              </span>
              {currentCard?.lapse_count > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
                  Lapses: {currentCard.lapse_count}
                </span>
              )}
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  openEditModal()
                }}
                className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-secondary hover:text-primary transition-colors"
                title="Edit this flashcard"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mb-6">
              <div className="text-xs text-secondary uppercase tracking-wide mb-2">Question</div>
              <div
                className="text-lg text-primary"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentCard?.front || '') }}
              />
            </div>

            {isFlipped && (
              <div className="border-t border-divider pt-6">
                <div className="text-xs text-secondary uppercase tracking-wide mb-2">Answer</div>
                <div
                  className="text-lg text-primary"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentCard?.back || '') }}
                />
              </div>
            )}

            {!isFlipped && (
              <div className="text-center text-secondary text-sm mt-8">
                Click to reveal answer
              </div>
            )}

            <div className="border-t border-divider pt-5 mt-10">
              <div className="flex flex-wrap gap-2 mb-2">
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${currentLectureInfo?.moduleColor || '#6B7280'}15`, color: currentLectureInfo?.moduleColor || '#6B7280' }}
                >
                  {(currentLectureInfo?.moduleAbbreviation || currentLectureInfo?.moduleTitle || 'Unknown')} - {currentLectureInfo?.title || 'Unknown'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {cardTags.map((tag) => (
                  <span key={tag} className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Rating buttons (only show when flipped) */}
          {isFlipped && (
            <div className="grid grid-cols-4 gap-3 mt-6">
              <button
                onClick={() => handleRate(RATING.AGAIN)}
                disabled={saving || keyboardRatePending}
                className={`flex flex-col items-center gap-1 px-4 py-3 border border-red-200 rounded-xl transition-colors disabled:opacity-50 ${
                  keyboardFlashRating === RATING.AGAIN ? 'bg-red-100' : 'bg-red-50 hover:bg-red-100'
              }`}
              >
                <span className="text-sm font-medium text-red-700">Again</span>
                <span className="text-xs text-red-600">{nextIntervals.again || '?'}</span>
              </button>
              <button
                onClick={() => handleRate(RATING.HARD)}
                disabled={saving || keyboardRatePending}
                className={`flex flex-col items-center gap-1 px-4 py-3 border border-orange-200 rounded-xl transition-colors disabled:opacity-50 ${
                  keyboardFlashRating === RATING.HARD ? 'bg-orange-100' : 'bg-orange-50 hover:bg-orange-100'
              }`}
              >
                <span className="text-sm font-medium text-orange-700">Hard</span>
                <span className="text-xs text-orange-600">{nextIntervals.hard || '?'}</span>
              </button>
              <button
                onClick={() => handleRate(RATING.GOOD)}
                disabled={saving || keyboardRatePending}
                className={`flex flex-col items-center gap-1 px-4 py-3 border border-green-200 rounded-xl transition-colors disabled:opacity-50 ${
                  keyboardFlashRating === RATING.GOOD ? 'bg-green-100' : 'bg-green-50 hover:bg-green-100'
              }`}
              >
                <span className="text-sm font-medium text-green-700">Good</span>
                <span className="text-xs text-green-600">{nextIntervals.good || '?'}</span>
              </button>
              <button
                onClick={() => handleRate(RATING.EASY)}
                disabled={saving || keyboardRatePending}
                className={`flex flex-col items-center gap-1 px-4 py-3 border border-blue-200 rounded-xl transition-colors disabled:opacity-50 ${
                  keyboardFlashRating === RATING.EASY ? 'bg-blue-100' : 'bg-blue-50 hover:bg-blue-100'
              }`}
              >
                <span className="text-sm font-medium text-blue-700">Easy</span>
                <span className="text-xs text-blue-600">{nextIntervals.easy || '?'}</span>
              </button>
            </div>
          )}
        </div>

        {showEditModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-2xl p-6 max-w-3xl w-full shadow-xl border border-divider max-h-[90vh] overflow-y-auto">
              <div className="mb-4">
                <h2 className="text-xl font-bold text-primary">Edit Flashcard</h2>
              </div>
              {editingCardKind === 'occlusion' && editingOcclusionDraft ? (
                <div className="space-y-5">
                  <p className="text-sm text-secondary">Edit the occlusion box, label, and question:</p>
                  <div className="grid lg:grid-cols-2 gap-6">
                    <div>
                      <div
                        ref={occlusionEditorRef}
                        className="relative inline-block border border-divider rounded-lg overflow-hidden cursor-crosshair"
                        onMouseDown={(e) => {
                          if (!drawingOcclusionBox) return
                          const rect = e.currentTarget.getBoundingClientRect()
                          const x = ((e.clientX - rect.left) / rect.width) * 100
                          const y = ((e.clientY - rect.top) / rect.height) * 100
                          setDrawingOcclusionBox({ x, y, width: 0, height: 0, isDrawing: true })
                        }}
                        onMouseMove={(e) => {
                          if (!drawingOcclusionBox?.isDrawing) return
                          const rect = e.currentTarget.getBoundingClientRect()
                          const currentX = ((e.clientX - rect.left) / rect.width) * 100
                          const currentY = ((e.clientY - rect.top) / rect.height) * 100
                          setDrawingOcclusionBox((prev) => ({
                            ...prev,
                            width: currentX - prev.x,
                            height: currentY - prev.y,
                          }))
                        }}
                        onMouseUp={() => {
                          if (!drawingOcclusionBox?.isDrawing) return
                          const box = {
                            x: drawingOcclusionBox.width < 0 ? drawingOcclusionBox.x + drawingOcclusionBox.width : drawingOcclusionBox.x,
                            y: drawingOcclusionBox.height < 0 ? drawingOcclusionBox.y + drawingOcclusionBox.height : drawingOcclusionBox.y,
                            width: Math.abs(drawingOcclusionBox.width),
                            height: Math.abs(drawingOcclusionBox.height),
                          }
                          if (box.width > 1 && box.height > 1) {
                            setEditingOcclusionDraft((prev) => ({ ...prev, x: box.x, y: box.y, width: box.width, height: box.height }))
                          }
                          setDrawingOcclusionBox(null)
                        }}
                        onMouseLeave={() => {
                          if (drawingOcclusionBox?.isDrawing) {
                            setDrawingOcclusionBox(null)
                          }
                        }}
                      >
                        <img src={editingOcclusionDraft.originalImage} alt="Editing" className="w-full h-auto" draggable={false} />
                        {!drawingOcclusionBox && editingOcclusionDraft.width > 0 && (
                          <div
                            className="absolute border-2 border-orange-500 bg-orange-500/20"
                            style={{
                              left: `${editingOcclusionDraft.x}%`,
                              top: `${editingOcclusionDraft.y}%`,
                              width: `${editingOcclusionDraft.width}%`,
                              height: `${editingOcclusionDraft.height}%`,
                              cursor: 'move',
                            }}
                          >
                            <div className="absolute -top-6 left-0 bg-orange-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                              {editingOcclusionDraft.labelText}
                            </div>
                          </div>
                        )}
                        {drawingOcclusionBox && (
                          <div
                            className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10"
                            style={{
                              left: `${drawingOcclusionBox.width < 0 ? drawingOcclusionBox.x + drawingOcclusionBox.width : drawingOcclusionBox.x}%`,
                              top: `${drawingOcclusionBox.height < 0 ? drawingOcclusionBox.y + drawingOcclusionBox.height : drawingOcclusionBox.y}%`,
                              width: `${Math.abs(drawingOcclusionBox.width)}%`,
                              height: `${Math.abs(drawingOcclusionBox.height)}%`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="bg-gray-50 rounded-lg p-4 border border-divider space-y-4">
                        <div>
                          <label className="text-sm font-medium text-primary block mb-2">Label Text</label>
                          <input
                            type="text"
                            value={editingOcclusionDraft.labelText}
                            onChange={(e) => setEditingOcclusionDraft((prev) => ({ ...prev, labelText: e.target.value }))}
                            className="w-full text-sm border border-divider rounded px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-primary block mb-2">Question Text</label>
                          <input
                            type="text"
                            value={editingOcclusionDraft.questionText}
                            onChange={(e) => setEditingOcclusionDraft((prev) => ({ ...prev, questionText: e.target.value }))}
                            className="w-full text-sm border border-divider rounded px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-primary block mb-2">Occlusion Box</label>
                          <button
                            onClick={() => {
                              if (drawingOcclusionBox) {
                                setDrawingOcclusionBox(null)
                              } else {
                                setEditingOcclusionDraft((prev) => ({ ...prev, x: 0, y: 0, width: 0, height: 0 }))
                                setDrawingOcclusionBox({})
                              }
                            }}
                            className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                              drawingOcclusionBox ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-orange-600 hover:bg-orange-700 text-white'
                            }`}
                          >
                            {drawingOcclusionBox ? 'Cancel Redraw' : 'Redraw Box'}
                          </button>
                          {drawingOcclusionBox !== null && !drawingOcclusionBox.x && (
                            <p className="text-xs text-secondary mt-2">Click and drag on the image to draw a new box</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-secondary">Topic Tags</label>
                          <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-white border border-divider rounded-lg">
                            {editingOcclusionDraft.contentTags?.map((tag, tagIdx) => (
                              <span key={`${tag}-${tagIdx}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full">
                                {tag}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDidEditTags(true)
                                    setEditingOcclusionDraft((prev) => ({ ...prev, contentTags: prev.contentTags.filter((_, i) => i !== tagIdx) }))
                                  }}
                                  className="w-3.5 h-3.5 flex items-center justify-center hover:bg-blue-100 rounded-full"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))}
                            <input
                              type="text"
                              value={newTagInput}
                              onChange={(e) => setNewTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTagInput.trim()) {
                                  e.preventDefault()
                                  const newTag = newTagInput.trim().toLowerCase()
                                  if (!editingOcclusionDraft.contentTags?.includes(newTag)) {
                                    setDidEditTags(true)
                                    setEditingOcclusionDraft((prev) => ({ ...prev, contentTags: [...(prev.contentTags || []), newTag] }))
                                  }
                                  setNewTagInput('')
                                }
                              }}
                              className="flex-1 min-w-[100px] bg-transparent border-none outline-none text-sm placeholder:text-gray-400"
                              placeholder="Type tag and press Enter..."
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2 justify-end">
                    <button onClick={closeEditModal} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary rounded-lg text-sm font-medium transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={saveSessionEdit}
                      disabled={drawingOcclusionBox !== null || editSaving}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                editingCardDraft && (
                  <div className="space-y-2">
                    {editingCardKind === 'interpretation' && editingCardDraft.imageDataUrl && (
                      <div className="mb-2">
                        <img src={editingCardDraft.imageDataUrl} alt="Interpretation" style={{ maxWidth: '400px' }} className="rounded-lg border border-divider" />
                      </div>
                    )}
                    {editingCardKind === 'interpretation' ? (
                      <textarea
                        value={editingCardDraft.front || ''}
                        onChange={(e) => setEditingCardDraft((prev) => ({ ...prev, front: e.target.value }))}
                        className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm min-h-[84px]"
                        placeholder="Question"
                        rows={4}
                      />
                    ) : (
                      <input
                        type="text"
                        value={editingCardDraft.front || ''}
                        onChange={(e) => setEditingCardDraft((prev) => ({ ...prev, front: e.target.value }))}
                        className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm"
                        placeholder="Front"
                      />
                    )}

                    <div className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-lg border border-divider">
                      <div className="text-xs text-secondary w-full mb-1">Format answer:</div>
                      <button type="button" onClick={() => applyEditorCommand('bold')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs font-bold">B</button>
                      <button type="button" onClick={() => applyEditorCommand('italic')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs italic">I</button>
                      <button type="button" onClick={() => applyEditorCommand('underline')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs underline">U</button>
                      <button type="button" onClick={() => applyEditorCommand('insertUnorderedList')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs" title="Bullet point">•</button>
                      <span className="border-l border-divider mx-1"></span>
                      {ESSENTIAL_SYMBOLS.map((symbol) => (
                        <button key={symbol} type="button" onClick={() => applyEditorCommand('insertText', symbol)} className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs">
                          {symbol}
                        </button>
                      ))}
                    </div>

                    <div
                      ref={(el) => {
                        if (!el) return
                        editBackRef.current = el
                        if (el.innerHTML !== (editingCardDraft.back || '')) {
                          el.innerHTML = editingCardDraft.back || ''
                        }
                      }}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(e) => {
                        const html = e.currentTarget.innerHTML
                        setEditingCardDraft((prev) => ({ ...prev, back: html }))
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Tab') {
                          e.preventDefault()
                          if (e.shiftKey) {
                            document.execCommand('outdent')
                          } else {
                            document.execCommand('indent')
                          }
                        }
                      }}
                      data-placeholder="Back"
                      className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm min-h-[100px] focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                      style={{ whiteSpace: 'pre-wrap' }}
                    />
                    <div className="space-y-2">
                      <label className="text-xs text-secondary">Topic Tags</label>
                      <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-gray-50 border border-divider rounded-lg">
                        {editingCardDraft.contentTags?.map((tag, tagIdx) => (
                          <span key={`${tag}-${tagIdx}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full">
                            {tag}
                            <button
                              type="button"
                              onClick={() => {
                                setDidEditTags(true)
                                setEditingCardDraft((prev) => ({ ...prev, contentTags: prev.contentTags.filter((_, i) => i !== tagIdx) }))
                              }}
                              className="w-3.5 h-3.5 flex items-center justify-center hover:bg-blue-100 rounded-full"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTagInput.trim()) {
                              e.preventDefault()
                              const newTag = newTagInput.trim().toLowerCase()
                              if (!editingCardDraft.contentTags?.includes(newTag)) {
                                setDidEditTags(true)
                                setEditingCardDraft((prev) => ({ ...prev, contentTags: [...(prev.contentTags || []), newTag] }))
                              }
                              setNewTagInput('')
                            }
                          }}
                          className="flex-1 min-w-[100px] bg-transparent border-none outline-none text-sm placeholder:text-gray-400"
                          placeholder="Type tag and press Enter..."
                        />
                      </div>
                    </div>
                  </div>
                )
              )}

              {editingCardKind !== 'occlusion' && (
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={closeEditModal}
                    disabled={editSaving}
                    className="px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 rounded text-sm flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                  <button
                    onClick={saveSessionEdit}
                    disabled={editSaving}
                    className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-sm flex items-center gap-1"
                  >
                    {editSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Save
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Batch complete screen
  if (step === 'batch-complete') {
    const batchReviewed = currentBatch.length

    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={handlePauseAndExit} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-secondary" />
          </button>
          <h1 className="text-2xl font-bold text-primary">Batch Complete</h1>
        </div>

        <div className="max-w-md mx-auto">
          <div className="bg-surface rounded-2xl border border-divider p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-accent" />
            </div>
            <h2 className="text-xl font-semibold text-primary mb-2">Great progress!</h2>
            <p className="text-secondary mb-6">
              Reviewed {currentBatchStart + batchReviewed} of {allCards.length} cards
            </p>

            <div className="grid grid-cols-4 gap-2 mb-6">
              <div className="bg-red-50 rounded-lg p-3">
                <div className="text-lg font-bold text-red-600">{sessionStats.again}</div>
                <div className="text-xs text-red-600">Again</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <div className="text-lg font-bold text-orange-600">{sessionStats.hard}</div>
                <div className="text-xs text-orange-600">Hard</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <div className="text-lg font-bold text-green-600">{sessionStats.good}</div>
                <div className="text-xs text-green-600">Good</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-lg font-bold text-blue-600">{sessionStats.easy}</div>
                <div className="text-xs text-blue-600">Easy</div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={continueNextBatch}
                className="w-full px-6 py-3 bg-accent hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
              >
                Continue ({remainingAfterBatch > 0 ? Math.min(remainingAfterBatch, BATCH_SIZE) : 0} more cards)
              </button>
              <button
                onClick={endSession}
                className="w-full px-6 py-3 bg-gray-100 hover:bg-gray-200 text-primary rounded-xl font-medium transition-colors"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Session complete screen
  if (step === 'complete') {
    const totalReviewedFinal = reviewedCardIds.length

    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={handleDoneAndExit} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-secondary" />
          </button>
          <h1 className="text-2xl font-bold text-primary">Session Complete</h1>
        </div>

        <div className="max-w-md mx-auto">
          <div className="bg-surface rounded-2xl border border-divider p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-semibold text-primary mb-2">Well done!</h2>
            <p className="text-secondary mb-6">You reviewed {totalReviewedFinal} cards</p>

            <div className="grid grid-cols-4 gap-2 mb-6">
              <div className="bg-red-50 rounded-lg p-3">
                <div className="text-lg font-bold text-red-600">{sessionStats.again}</div>
                <div className="text-xs text-red-600">Again</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <div className="text-lg font-bold text-orange-600">{sessionStats.hard}</div>
                <div className="text-xs text-orange-600">Hard</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <div className="text-lg font-bold text-green-600">{sessionStats.good}</div>
                <div className="text-xs text-green-600">Good</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-lg font-bold text-blue-600">{sessionStats.easy}</div>
                <div className="text-xs text-blue-600">Easy</div>
              </div>
            </div>

            <button
              onClick={handleDoneAndExit}
              className="w-full px-6 py-3 bg-accent hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

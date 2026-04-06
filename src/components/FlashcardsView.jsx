import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Save, Plus, Upload, Download, Trash2, Edit2, Check, X, Loader2, EyeOff, MessageSquare, ImageIcon, Type, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sanitizeHtml } from '../lib/htmlSanitizer'
import { getCardDisplayTags, getFlashcardsByLecture, syncLectureFlashcards } from '../lib/flashcardService'
import { generateFlashcardsFromNotes } from '../lib/flashcardsGenerator'
import { useToast } from './Toast'

function parseCsvLine(line) {
  const out = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1]
    if (ch === '"' && inQuotes && next === '"') {
      current += '"'
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

function titleTag(title) {
  return (title || 'Lecture')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w))
}

function normalizeTagArray(value) {
  if (!Array.isArray(value)) return []
  const tags = value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
  return [...new Set(tags)].slice(0, 3)
}

function normalizeEditableTagList(value) {
  if (!Array.isArray(value)) return []
  const tags = value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
  return [...new Set(tags)]
}

function parseTagInput(input) {
  return normalizeTagArray(
    String(input || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  )
}

function normalizeSuggestedTagArray(value) {
  if (!Array.isArray(value)) return []
  const tags = value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
  return [...new Set(tags)].slice(0, 5)
}

function normalizeExportTagArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))]
  }
  if (typeof value === 'string') {
    const raw = value.trim()
    if (!raw) return []
    const parts = raw.includes(',') ? raw.split(',') : [raw]
    return [...new Set(parts.map((part) => String(part || '').trim().toLowerCase()).filter(Boolean))]
  }
  return []
}

function extractAiSuggestionTags(aiTagSuggestions) {
  let parsed = aiTagSuggestions
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = null
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  if (parsed.status === 'ignored') return []
  const camel = normalizeExportTagArray(parsed.contentTags)
  const snake = normalizeExportTagArray(parsed.content_tags)
  return [...new Set([...camel, ...snake])]
}

function getCardExportTags(card) {
  const typeTag = card?.interpretationData
    ? 'interpretation'
    : card?.occlusionData
      ? 'image occlusion'
      : 'text'
  const legacyTags = normalizeExportTagArray(card?.tags)
  const contentTags = normalizeExportTagArray(card?.contentTags || card?.content_tags)
  const customUserTags = normalizeExportTagArray(card?.customUserTags || card?.custom_user_tags)
  const aiSuggestionTags = extractAiSuggestionTags(card?.aiTagSuggestions || card?.ai_tag_suggestions)
  return [...new Set([typeTag, ...legacyTags, ...contentTags, ...customUserTags, ...aiSuggestionTags])]
}

function getEditableTopicTags(card) {
  const blocked = new Set(['text', 'image occlusion', 'interpretation'])
  const merged = [
    ...normalizeExportTagArray(card?.contentTags || card?.content_tags),
    ...normalizeExportTagArray(card?.customUserTags || card?.custom_user_tags),
    ...normalizeExportTagArray(card?.tags),
    ...extractAiSuggestionTags(card?.aiTagSuggestions || card?.ai_tag_suggestions)
  ]
  return [...new Set(merged)].filter((tag) => !blocked.has(tag))
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function createEmptyCardDraft() {
  return {
    front: '',
    back: '',
    tags: '',
    sectionIndex: null,
    sourcePointIndex: null,
    sourcePointText: '',
    sectionTitle: '',
  }
}

function getCoverageKey(sectionIndex, pointIndex) {
  return `${sectionIndex}:${pointIndex}`
}

function mapDbCardToViewCard(card = {}) {
  return {
    ...card,
    sectionIndex: Number.isInteger(card.section_index) ? card.section_index : null,
    sectionKey: card.section_key || '',
    sectionTitle: card.section_title || '',
    sourcePointIndex: Number.isInteger(card.source_point_index) ? card.source_point_index : null,
    sourcePointText: card.source_point_text || '',
    sourceParentPointIndex: Number.isInteger(card.source_parent_point_index) ? card.source_parent_point_index : null,
    sourceParentPointText: card.source_parent_point_text || '',
    frontImages: Array.isArray(card.front_images) ? card.front_images : [],
    backImages: Array.isArray(card.back_images) ? card.back_images : [],
    contentTags: Array.isArray(card.content_tags) ? card.content_tags : [],
    customUserTags: Array.isArray(card.custom_user_tags) ? card.custom_user_tags : [],
    aiTagSuggestions: card.ai_tag_suggestions || null,
    tagsLastSuggestedAt: card.tags_last_suggested_at || null,
    occlusionData: card.occlusion_data || null,
    interpretationData: card.interpretation_data || null,
  }
}

function inferCardsSectionMetadata(cards, notes) {
  const sections = notes?.notes || []
  if (!sections.length) return cards

  const sectionCorpus = sections.map((section, index) => ({
    index,
    key: `section-${index}`,
    title: String(section?.section || `Section ${index + 1}`),
    corpus: normalizeText([section?.section || '', ...(section?.points || [])].join(' '))
  }))

  return cards.map((card) => {
    if (card.sectionKey && Number.isInteger(card.sectionIndex)) return card
    const terms = tokenize(`${card.front} ${card.back}`)
    if (!terms.length) return card

    let best = null
    sectionCorpus.forEach((section) => {
      let score = 0
      terms.forEach((term) => {
        if (section.corpus.includes(term)) score += 1
      })
      if (!best || score > best.score) best = { section, score }
    })

    if (!best || best.score <= 0) return card
    return {
      ...card,
      sectionIndex: best.section.index,
      sectionKey: best.section.key,
      sectionTitle: best.section.title
    }
  })
}

const NOTES_IMAGE_BUCKET = 'lecture-pdfs'

function normalizePointImageEntry(entry) {
  if (!entry) return []
  if (Array.isArray(entry)) return entry.filter((img) => img && typeof img === 'object')
  if (typeof entry === 'object') return [entry]
  return []
}

async function resolveImageSourceToDataUrl(src) {
  if (!src || typeof src !== 'string') return null
  if (src.startsWith('data:image/')) return src
  if (!/^https?:\/\//i.test(src)) return null

  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status})`)
  }
  const blob = await response.blob()

  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => reject(new Error('Failed to convert image to base64'))
    reader.readAsDataURL(blob)
  })
}

function estimateBase64Bytes(base64) {
  if (!base64 || typeof base64 !== 'string') return 0
  return Math.ceil((base64.length * 3) / 4)
}

async function optimizeInterpretationImageDataUrl(dataUrl, options = {}) {
  const {
    maxBytes = 1_800_000,
    maxDimension = 1400,
    minQuality = 0.52,
  } = options

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return { dataUrl, mediaType: 'image/jpeg', bytes: 0, optimized: false }
  }

  const [prefix = '', originalBase64 = ''] = dataUrl.split(',')
  const originalMediaMatch = prefix.match(/^data:(image\/[a-z0-9.+-]+);base64$/i)
  const originalMediaType = originalMediaMatch ? originalMediaMatch[1].toLowerCase() : 'image/jpeg'
  const originalBytes = estimateBase64Bytes(originalBase64)

  if (originalBytes > 0 && originalBytes <= maxBytes) {
    return { dataUrl, mediaType: originalMediaType, bytes: originalBytes, optimized: false }
  }

  const image = await new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode image for optimization'))
    img.src = dataUrl
  })

  const naturalWidth = Number(image.naturalWidth || image.width || 0)
  const naturalHeight = Number(image.naturalHeight || image.height || 0)
  if (!naturalWidth || !naturalHeight) {
    throw new Error('Invalid image dimensions')
  }

  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight))
  const baseWidth = Math.max(1, Math.round(naturalWidth * scale))
  const baseHeight = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not initialize canvas for image optimization')

  const widthSteps = [1, 0.9, 0.8, 0.72]
  const qualitySteps = [0.82, 0.74, 0.66, 0.58, minQuality]
  let bestDataUrl = null
  let bestBytes = Number.POSITIVE_INFINITY

  for (const widthStep of widthSteps) {
    const outWidth = Math.max(1, Math.round(baseWidth * widthStep))
    const outHeight = Math.max(1, Math.round(baseHeight * widthStep))
    canvas.width = outWidth
    canvas.height = outHeight
    ctx.clearRect(0, 0, outWidth, outHeight)
    ctx.drawImage(image, 0, 0, outWidth, outHeight)

    for (const quality of qualitySteps) {
      const candidate = canvas.toDataURL('image/jpeg', quality)
      const candidateBase64 = candidate.split(',')[1] || ''
      const candidateBytes = estimateBase64Bytes(candidateBase64)

      if (candidateBytes < bestBytes) {
        bestDataUrl = candidate
        bestBytes = candidateBytes
      }
      if (candidateBytes <= maxBytes) {
        return { dataUrl: candidate, mediaType: 'image/jpeg', bytes: candidateBytes, optimized: true }
      }
    }
  }

  return {
    dataUrl: bestDataUrl || dataUrl,
    mediaType: bestDataUrl ? 'image/jpeg' : originalMediaType,
    bytes: Number.isFinite(bestBytes) ? bestBytes : originalBytes,
    optimized: !!bestDataUrl,
  }
}

function sanitizeInterpretationContextText(value, maxLen = 280) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.slice(0, maxLen)
}

function buildInterpretationContext(imageData) {
  const sectionTitle = sanitizeInterpretationContextText(imageData?.sectionTitle || '', 140)
  const pointText = sanitizeInterpretationContextText(imageData?.pointText || '', 320)
  const sectionPointsRaw = Array.isArray(imageData?.sectionPoints) ? imageData.sectionPoints : []
  const sectionPoints = sectionPointsRaw
    .map((point) => sanitizeInterpretationContextText(String(point || ''), 220))
    .filter(Boolean)
    .slice(0, 12)

  if (!sectionTitle && !pointText && sectionPoints.length === 0) return null
  return { sectionTitle: sectionTitle || null, pointText: pointText || null, sectionPoints }
}

export function FlashcardsView({ lecture, module, onBack, onSaved }) {
  const toast = useToast()
  const [flashcards, setFlashcards] = useState([])
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('saved') // 'saved' | 'saving' | 'error'
  const [loadingFlashcards, setLoadingFlashcards] = useState(true)
  const [showAddCard, setShowAddCard] = useState(false)
  const [newCard, setNewCard] = useState(createEmptyCardDraft)
  const [showSourceCoverage, setShowSourceCoverage] = useState(false)
  const [coverageFilter, setCoverageFilter] = useState('all')
  const [creatingFromCoverageKey, setCreatingFromCoverageKey] = useState(null)
  const [expandedCards, setExpandedCards] = useState({})
  const [editingCard, setEditingCard] = useState(null) // {index, front, back, tags, contentTags}
  const [newTagInput, setNewTagInput] = useState('') // For adding new tags in edit mode
  const csvImportInputRef = useRef(null)
  const editCardBackRef = useRef(null)
  const newCardBackRef = useRef(null)
  const editAnswerContainerRef = useRef(null)

  // Image Occlusion states
  const [occlusionModalOpen, setOcclusionModalOpen] = useState(false)
  const [occlusionStep, setOcclusionStep] = useState('select') // 'select' | 'edit' | 'generating'
  const [selectedOcclusionImage, setSelectedOcclusionImage] = useState(null)
  const [detectedLabels, setDetectedLabels] = useState([]) // [{id, x, y, width, height, text, enabled}]
  const [occlusionProcessing, setOcclusionProcessing] = useState(false)
  const [drawingOcclusionBox, setDrawingOcclusionBox] = useState(null)
  const [editingLabelId, setEditingLabelId] = useState(null)
  const [draggingLabel, setDraggingLabel] = useState(null)
  const [resizingLabel, setResizingLabel] = useState(null)
  const [editingOcclusionCard, setEditingOcclusionCard] = useState(null)
  const [cardImagePickerOpen, setCardImagePickerOpen] = useState(false)
  const [imagePickerCardIndex, setImagePickerCardIndex] = useState(null)

  // Interpretation card states
  const [interpretationModalOpen, setInterpretationModalOpen] = useState(false)
  const [interpretationStep, setInterpretationStep] = useState('select') // 'select' | 'generating' | 'confirm'
  const [selectedInterpretationImage, setSelectedInterpretationImage] = useState(null)
  const [interpretationCard, setInterpretationCard] = useState(null) // {question, answer, imageDataUrl}
  const [interpretationProcessing, setInterpretationProcessing] = useState(false)

  const [addCardMenuOpen, setAddCardMenuOpen] = useState(false)
  const [activeEditableImage, setActiveEditableImage] = useState(null) // { imgIndex, left, top }
  const [aiTagEdits, setAiTagEdits] = useState({})
  const [notesImages, setNotesImages] = useState([])
  const [notesImagesLoading, setNotesImagesLoading] = useState(false)
  const imageTagBackfillRef = useRef(null)
  const notesSignedUrlCacheRef = useRef(new Map())
  const saveInFlightRef = useRef(false)
  const pendingSavePayloadRef = useRef(null)
  const saveWaitersRef = useRef([])
  const saveDebounceTimerRef = useRef(null)
  const lastDebouncedPayloadRef = useRef(null)
  const isMountedRef = useRef(true)
  const exitingRef = useRef(false)
  const cardRowRefs = useRef({})

  const essentialSymbols = [
    { symbol: 'α' }, { symbol: 'β' }, { symbol: 'Δ' }, { symbol: 'μ' },
    { symbol: '→' }, { symbol: '←' }, { symbol: '↑' }, { symbol: '↓' },
  ]

  const getSectionTitle = (sectionIndex) => {
    const section = lecture?.notes?.notes?.[sectionIndex]
    return String(section?.section || `Section ${sectionIndex + 1}`)
  }

  const getAllNotesImages = () => notesImages

  const getSignedUrlsMap = async (paths) => {
    const now = Date.now()
    const uniquePaths = [...new Set((paths || []).filter(Boolean))]
    const urlsMap = {}
    const missingPaths = []

    uniquePaths.forEach((path) => {
      const cached = notesSignedUrlCacheRef.current.get(path)
      if (cached && cached.expiresAt > now) {
        urlsMap[path] = cached.url
      } else {
        missingPaths.push(path)
      }
    })

    if (missingPaths.length > 0) {
      const { data, error } = await supabase.storage
        .from(NOTES_IMAGE_BUCKET)
        .createSignedUrls(missingPaths, 60 * 60 * 24 * 7)

      if (error) {
        // Failed to create signed URLs - non-critical
      } else {
        ;(data || []).forEach((row) => {
          if (!row?.path || !row?.signedUrl) return
          urlsMap[row.path] = row.signedUrl
          notesSignedUrlCacheRef.current.set(row.path, {
            url: row.signedUrl,
            expiresAt: now + (1000 * 60 * 60 * 24 * 6)
          })
        })
      }
    }

    return urlsMap
  }

  useEffect(() => {
    let cancelled = false

    const loadNoteImages = async () => {
      setNotesImagesLoading(true)
      try {
        const rawNotes = lecture?.notes || {}
        const resolvedImages = []
        const pendingImages = []
        const paths = []

        // Helper to get point text from notes structure
        const getPointText = (sectionIdx, pointIdx) => {
          const section = rawNotes.notes?.[sectionIdx]
          if (!section?.points) return null
          const point = section.points[pointIdx]
          if (!point) return null
          // Strip HTML tags to get plain text
          return String(point).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        }

        // Get all bullet points from a section (for section-level images)
        const getSectionPoints = (sectionIdx) => {
          const section = rawNotes.notes?.[sectionIdx]
          if (!section?.points || !Array.isArray(section.points)) return []
          return section.points
            .map((point) => String(point).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
        }

        if (rawNotes._pointImages) {
          Object.entries(rawNotes._pointImages).forEach(([key, imageData]) => {
            const [sectionIdx, pointIdx] = key.split('-').map(Number)
            const safeSectionIdx = Number.isNaN(sectionIdx) ? 0 : sectionIdx
            const safePointIdx = Number.isNaN(pointIdx) ? 0 : pointIdx
            const pointImages = normalizePointImageEntry(imageData)
            const pointText = getPointText(safeSectionIdx, safePointIdx)
            pointImages.forEach((pointImage, pointImageIndex) => {
              if (pointImage?.storagePath) paths.push(pointImage.storagePath)
              pendingImages.push({
                type: 'point-image',
                sectionIndex: safeSectionIdx,
                sectionKey: `section-${safeSectionIdx}`,
                sectionTitle: getSectionTitle(safeSectionIdx),
                pointIndex: safePointIdx,
                pointText: pointText,
                label: `Section ${safeSectionIdx + 1}, Point ${safePointIdx + 1}${pointImages.length > 1 ? ` (Image ${pointImageIndex + 1})` : ''}`,
                image: pointImage
              })
            })
          })
        }

        if (rawNotes._sectionImages) {
          Object.entries(rawNotes._sectionImages).forEach(([sectionIndexRaw, imageData]) => {
            const sectionIndex = Number(sectionIndexRaw)
            if (Number.isNaN(sectionIndex)) return
            const sectionImages = normalizePointImageEntry(imageData)
            if (sectionImages.length === 0) return
            // For section images, gather all bullet points from the section
            // This provides context for interpretation cards since section images apply to all points
            const sectionPoints = getSectionPoints(sectionIndex)
            sectionImages.forEach((sectionImage, sectionImageIndex) => {
              if (sectionImage?.storagePath) paths.push(sectionImage.storagePath)
              pendingImages.push({
                type: 'section-image',
                sectionIndex,
                sectionKey: `section-${sectionIndex}`,
                sectionTitle: getSectionTitle(sectionIndex),
                sectionPoints, // All bullet points in this section
                label: `Section ${sectionIndex + 1}${sectionImages.length > 1 ? ` (Image ${sectionImageIndex + 1})` : ''}`,
                image: sectionImage
              })
            })
          })
        }

        const signedUrls = await getSignedUrlsMap(paths)

        pendingImages.forEach((entry) => {
          const dataUrl = entry.image?.dataUrl || (entry.image?.storagePath ? signedUrls[entry.image.storagePath] : null)
          if (!dataUrl) return
          resolvedImages.push({
            ...entry,
            image: {
              ...entry.image,
              dataUrl
            }
          })
        })

        if (rawNotes.notes) {
          rawNotes.notes.forEach((section, sIdx) => {
            if (section.section) {
              const sectionHtml = String(section.section)
              const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g
              let match
              while ((match = imgRegex.exec(sectionHtml)) !== null) {
                resolvedImages.push({
                  type: 'section-html',
                  sectionIndex: sIdx,
                  sectionKey: `section-${sIdx}`,
                  sectionTitle: getSectionTitle(sIdx),
                  image: { dataUrl: match[1] },
                  label: section.section.replace(/<[^>]+>/g, '').substring(0, 50)
                })
              }
            }

            if (section.points) {
              section.points.forEach((point, pIdx) => {
                const pointHtml = String(point)
                const pointText = pointHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g
                let match
                while ((match = imgRegex.exec(pointHtml)) !== null) {
                  resolvedImages.push({
                    type: 'point-html',
                    sectionIndex: sIdx,
                    sectionKey: `section-${sIdx}`,
                    sectionTitle: getSectionTitle(sIdx),
                    pointIndex: pIdx,
                    pointText: pointText,
                    image: { dataUrl: match[1] },
                    label: pointHtml.replace(/<[^>]+>/g, '').substring(0, 50)
                  })
                }
              })
            }
          })
        }

        if (!cancelled) setNotesImages(resolvedImages)
      } finally {
        if (!cancelled) setNotesImagesLoading(false)
      }
    }

    loadNoteImages()
    return () => {
      cancelled = true
    }
  }, [lecture.id, lecture.notes])

  const getSuggestedImagesForCard = (card) => {
    const allImages = getAllNotesImages()
    const sectionIndex = Number.isInteger(card?.sectionIndex) ? card.sectionIndex : null
    if (sectionIndex === null) return allImages

    const suggested = allImages.filter((img) => img.sectionIndex === sectionIndex)
    const fallback = allImages.filter((img) => img.sectionIndex !== sectionIndex)
    return [...suggested, ...fallback]
  }

  const attachImageToCardAnswer = async (index, selectedImage) => {
    if (!selectedImage?.image?.dataUrl) return
    const card = flashcards[index]
    if (!card) return

    const imageHtml = `<br><br><img src="${selectedImage.image.dataUrl}" style="max-width:320px;">`
    const nextBack = `${card.back || ''}${imageHtml}`.trim()
    const previousImages = Array.isArray(card.answerImages) ? card.answerImages : []

    const updatedCard = {
      ...card,
      back: nextBack,
      answerImages: [
        ...previousImages,
        {
          dataUrl: selectedImage.image.dataUrl,
          sectionIndex: selectedImage.sectionIndex,
          sectionKey: selectedImage.sectionKey,
          sectionTitle: selectedImage.sectionTitle,
          type: selectedImage.type
        }
      ]
    }

    const updatedFlashcards = flashcards.map((c, i) => (i === index ? updatedCard : c))
    setFlashcards(updatedFlashcards)
    setCardImagePickerOpen(false)
    setImagePickerCardIndex(null)
    await persistFlashcards(updatedFlashcards, { immediate: true, errorPrefix: 'Failed to attach image' })
  }

  const removeEditableImageByIndex = (imgIndex) => {
    const editor = editCardBackRef.current
    if (!editor || !editingCard) return

    const imgs = editor.querySelectorAll('img')
    const target = imgs[imgIndex]
    if (!target) return

    const prev = target.previousSibling
    if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'BR') {
      prev.remove()
      const prev2 = target.previousSibling
      if (prev2 && prev2.nodeType === Node.ELEMENT_NODE && prev2.tagName === 'BR') {
        prev2.remove()
      }
    }
    target.remove()

    const html = editor.innerHTML
    setEditingCard((prevState) => ({ ...prevState, back: html }))
    setActiveEditableImage(null)
  }

  const handleEditAnswerClick = (e) => {
    const editor = editCardBackRef.current
    const container = editAnswerContainerRef.current
    if (!editor || !container) return

    if (!(e.target instanceof HTMLImageElement)) {
      setActiveEditableImage(null)
      return
    }

    const imgs = Array.from(editor.querySelectorAll('img'))
    const imgIndex = imgs.indexOf(e.target)
    if (imgIndex < 0) return

    const imgRect = e.target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    setActiveEditableImage({
      imgIndex,
      left: imgRect.left - containerRect.left + imgRect.width - 10,
      top: imgRect.top - containerRect.top - 10
    })
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current)
        saveDebounceTimerRef.current = null
      }
    }
  }, [])

  const flushQueuedSaves = async () => {
    if (saveInFlightRef.current) return
    saveInFlightRef.current = true

    try {
      while (pendingSavePayloadRef.current) {
        const payload = pendingSavePayloadRef.current
        pendingSavePayloadRef.current = null

        const { error } = await syncLectureFlashcards(lecture.id, payload)
        if (error) throw error
      }

      if (isMountedRef.current) {
        setHasChanges(false)
        setSaveStatus('saved')
      }
      if (onSaved) onSaved()

      const waiters = saveWaitersRef.current.splice(0)
      waiters.forEach(({ resolve }) => resolve())
    } catch (error) {
      if (isMountedRef.current) {
        setSaveStatus('error')
      }
      const waiters = saveWaitersRef.current.splice(0)
      waiters.forEach(({ reject }) => reject(error))
    } finally {
      saveInFlightRef.current = false
      if (pendingSavePayloadRef.current) {
        flushQueuedSaves()
      }
    }
  }

  const enqueueFlashcardsSave = (cardsPayload) => {
    if (isMountedRef.current) {
      setSaveStatus('saving')
      setHasChanges(true)
    }
    pendingSavePayloadRef.current = cardsPayload
    const waitForFlush = new Promise((resolve, reject) => {
      saveWaitersRef.current.push({ resolve, reject })
    })
    flushQueuedSaves()
    return waitForFlush
  }

  const scheduleFlashcardsSave = (cardsPayload, immediate = false) => {
    lastDebouncedPayloadRef.current = cardsPayload
    if (immediate) {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current)
        saveDebounceTimerRef.current = null
      }
      return enqueueFlashcardsSave(cardsPayload)
    }

    if (isMountedRef.current) {
      setHasChanges(true)
      setSaveStatus('saving')
    }
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current)
    }
    saveDebounceTimerRef.current = setTimeout(() => {
      const payload = lastDebouncedPayloadRef.current
      saveDebounceTimerRef.current = null
      if (payload) enqueueFlashcardsSave(payload)
    }, 900)
    return Promise.resolve()
  }

  const waitForPendingSaves = async () => {
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current)
      saveDebounceTimerRef.current = null
      if (lastDebouncedPayloadRef.current) {
        await enqueueFlashcardsSave(lastDebouncedPayloadRef.current)
      }
    }
    if (!saveInFlightRef.current && !pendingSavePayloadRef.current) return
    await new Promise((resolve, reject) => {
      saveWaitersRef.current.push({ resolve, reject })
    })
  }

  const persistFlashcards = async (updatedFlashcards, options = {}) => {
    const { immediate = true } = options
    try {
      await scheduleFlashcardsSave(updatedFlashcards, immediate)
    } catch (error) {
      toast.error('Failed to save flashcards. Please try again.')
      if (isMountedRef.current) {
        setSaveStatus('error')
      }
      throw error
    }
  }

  const handleBack = async () => {
    if (exitingRef.current) return
    exitingRef.current = true
    if (isMountedRef.current) {
      setSaving(true)
      setSaveStatus('saving')
    }

    try {
      await waitForPendingSaves()
      if (onBack) await onBack()
    } catch {
      toast.error('Could not save your changes. Please try again.')
      exitingRef.current = false
    } finally {
      if (isMountedRef.current) {
        setSaving(false)
      }
    }
  }

  useEffect(() => {
    let isCancelled = false
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current)
      saveDebounceTimerRef.current = null
    }
    pendingSavePayloadRef.current = null
    lastDebouncedPayloadRef.current = null
    saveWaitersRef.current = []
    saveInFlightRef.current = false
    exitingRef.current = false

    setFlashcards([])
    setHasChanges(false)
    setSaveStatus('saving')
    setLoadingFlashcards(true)
    imageTagBackfillRef.current = null

    ;(async () => {
      const { data: tableCards, error: fetchError } = await getFlashcardsByLecture(lecture.id)
      if (fetchError) {
        // Failed to fetch flashcards
        if (!isCancelled) {
          setSaveStatus('error')
          setLoadingFlashcards(false)
        }
        return
      }

      let cardsForView = Array.isArray(tableCards) ? tableCards : []

      // One-time compatibility migration for legacy JSON-backed lectures.
      if (cardsForView.length === 0 && Array.isArray(lecture.notes?._flashcards) && lecture.notes._flashcards.length > 0) {
        const { error: migrateError } = await syncLectureFlashcards(lecture.id, lecture.notes._flashcards)
        if (migrateError) {
          // Migration failed - non-critical
        } else {
          const { data: migratedCards } = await getFlashcardsByLecture(lecture.id)
          cardsForView = Array.isArray(migratedCards) ? migratedCards : []
        }
      }

      if (!isCancelled) {
        const mappedCards = cardsForView.map(mapDbCardToViewCard)
        setFlashcards(inferCardsSectionMetadata(mappedCards, lecture.notes))
        setHasChanges(false)
        setSaveStatus('saved')
        setLoadingFlashcards(false)
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [lecture.id])

  const buildTagInputFromCard = (card, index = 0) => {
    const occlusionLabel = stripHtml(card?.occlusionData?.label?.text || '')
    const interpretationQuestion = stripHtml(card?.interpretationData?.question || '')
    const interpretationAnswer = stripHtml(card?.interpretationData?.answer || '')
    const sourcePointText = stripHtml(card?.sourcePointText || card?.source_point_text || occlusionLabel || interpretationQuestion || '')
    return {
      index,
      front: stripHtml(card?.front || interpretationQuestion || ''),
      back: stripHtml(card?.back || interpretationAnswer || ''),
      section_title: String(card?.sectionTitle || card?.section_title || ''),
      source_point_text: sourcePointText,
    }
  }

  const suggestTopicTagsForCards = async (cardsToTag) => {
    if (!Array.isArray(cardsToTag) || cardsToTag.length === 0) return {}
    try {
      await supabase.auth.refreshSession()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) return {}
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

      const payloadCards = cardsToTag
        .map((card, index) => buildTagInputFromCard(card, index))
        .filter((card) => card.front && card.back)

      if (payloadCards.length === 0) return {}

      const { data, error } = await supabase.functions.invoke('suggest-flashcard-tags', {
        body: { cards: payloadCards },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
        },
      })

      if (error) throw error
      const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : []
      const byIndex = {}
      suggestions.forEach((item) => {
        const idx = Number(item?.index)
        if (!Number.isInteger(idx)) return
        byIndex[idx] = {
          contentTags: normalizeSuggestedTagArray(item?.content_tags || item?.contentTags),
          confidence: Number(item?.confidence) || 0.5,
        }
      })
      return byIndex
    } catch (error) {
      // Topic tag suggestion failed - non-critical
      return {}
    }
  }

  const applySuggestedTopicTagsToCards = (cardsToTag, suggestionsByIndex) => {
    return cardsToTag.map((card, index) => {
      const suggestion = suggestionsByIndex[index]
      if (!suggestion || !Array.isArray(suggestion.contentTags) || suggestion.contentTags.length === 0) {
        return card
      }
      return {
        ...card,
        contentTags: suggestion.contentTags,
        aiTagSuggestions: {
          contentTags: suggestion.contentTags,
          confidenceContent: suggestion.confidence,
          status: 'accepted',
          acceptedAt: new Date().toISOString(),
        },
      }
    })
  }

  useEffect(() => {
    if (imageTagBackfillRef.current === lecture.id) return
    if (!Array.isArray(flashcards) || flashcards.length === 0) {
      imageTagBackfillRef.current = lecture.id
      return
    }

    const missingIndices = flashcards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => {
        const isImageCard = !!card?.occlusionData || !!card?.interpretationData
        if (!isImageCard) return false
        const hasContentTags = Array.isArray(card?.contentTags) && card.contentTags.length > 0
        const hasAiSuggestions = Array.isArray(card?.aiTagSuggestions?.contentTags) && card.aiTagSuggestions.contentTags.length > 0
        return !hasContentTags && !hasAiSuggestions
      })

    imageTagBackfillRef.current = lecture.id
    if (missingIndices.length === 0) return

    ;(async () => {
      const cardsToTag = missingIndices.map(({ card }) => card)
      const suggestionsByIndex = await suggestTopicTagsForCards(cardsToTag)
      if (!Object.keys(suggestionsByIndex).length) return

      const taggedSubset = applySuggestedTopicTagsToCards(cardsToTag, suggestionsByIndex)
      const updated = [...flashcards]
      missingIndices.forEach(({ index }, i) => {
        updated[index] = taggedSubset[i]
      })
      setFlashcards(updated)
      await saveFlashcardsNow(updated, 'Failed to backfill topic tags for image cards')
    })()
  }, [lecture.id, flashcards])

  const saveFlashcards = async () => {
    setSaving(true)
    try {
      await persistFlashcards(flashcards, { immediate: true, errorPrefix: 'Failed to save flashcards' })
    } catch (error) {
      // Save failed
    } finally {
      setSaving(false)
    }
  }

  const saveFlashcardsNow = async (updatedFlashcards, errorPrefix = 'Failed to save') => {
    await persistFlashcards(updatedFlashcards, { immediate: true, errorPrefix })
  }

  useEffect(() => {
    const nextEdits = {}
    let hasNew = false
    flashcards.forEach((card, index) => {
      if (card?.aiTagSuggestions?.status === 'pending' && !aiTagEdits[index]) {
        const suggestion = card.aiTagSuggestions || {}
        nextEdits[index] = {
          contentTagsInput: Array.isArray(suggestion.contentTags) ? suggestion.contentTags.join(', ') : '',
        }
        hasNew = true
      }
    })
    if (hasNew) {
      setAiTagEdits((prev) => ({ ...prev, ...nextEdits }))
    }
  }, [flashcards, aiTagEdits])

  const acceptAiSuggestions = async (index) => {
    const card = flashcards[index]
    if (!card?.aiTagSuggestions) return

    const edit = aiTagEdits[index]
    const suggested = card.aiTagSuggestions
    const contentTags = edit
      ? parseTagInput(edit.contentTagsInput)
      : normalizeTagArray(suggested.contentTags)

    const updated = [...flashcards]
    updated[index] = {
      ...card,
      contentTags,
      aiTagSuggestions: {
        ...suggested,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      },
    }

    setFlashcards(updated)
    await saveFlashcardsNow(updated, 'Failed to accept AI tag suggestions')
  }

  const ignoreAiSuggestions = async (index) => {
    const card = flashcards[index]
    if (!card?.aiTagSuggestions) return

    const updated = [...flashcards]
    updated[index] = {
      ...card,
      aiTagSuggestions: {
        ...card.aiTagSuggestions,
        status: 'ignored',
        ignoredAt: new Date().toISOString(),
      },
    }

    setFlashcards(updated)
    await saveFlashcardsNow(updated, 'Failed to ignore AI tag suggestions')
  }

  const exportCsv = () => {
    if (!flashcards.length) return
    const csv =
      'Front,Back,Tags\n' +
      flashcards
        .map((card) => {
          const front = String(card.front || '').replace(/"/g, '""')
          const back = String(card.back || '').replace(/"/g, '""')
          const tags = getCardExportTags(card).join(', ').replace(/"/g, '""')
          return `"${front}","${back}","${tags}"`
        })
        .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${titleTag(lecture.title)}_flashcards.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importCsv = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      if (!lines.length) throw new Error('CSV is empty')

      const firstCells = parseCsvLine(lines[0]).map((c) => c.trim().toLowerCase())
      const hasHeader =
        firstCells[0]?.includes('front') ||
        firstCells[0]?.includes('question') ||
        firstCells[1]?.includes('back') ||
        firstCells[1]?.includes('answer')
      const startIndex = hasHeader ? 1 : 0

      const imported = []
      for (let i = startIndex; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i])
        const front = String(cells[0] || '').trim()
        const back = String(cells[1] || '').trim()
        const tags = String(cells[2] || '').trim()
        if (!front || !back) continue
        imported.push({ front, back, tags })
      }

      if (!imported.length) throw new Error('No valid flashcards found in CSV')

      setFlashcards(imported)
      await persistFlashcards(imported, { immediate: true })
      setEditingCard(null)
      toast.success(`Imported ${imported.length} flashcards`)
    } catch {
      toast.error('CSV import failed. Please check your file format.')
    } finally {
      e.target.value = ''
    }
  }

  const addCard = async () => {
    if (!newCard.front.trim() || !newCard.back.trim()) return
    const sectionIndex = Number.isInteger(newCard.sectionIndex) ? newCard.sectionIndex : null
    const sourcePointIndex = Number.isInteger(newCard.sourcePointIndex) ? newCard.sourcePointIndex : null
    const sourcePointText = String(newCard.sourcePointText || '').trim()
    const sectionTitle = String(newCard.sectionTitle || '').trim()
    const updatedFlashcards = [
      ...flashcards,
      {
        front: newCard.front.trim(),
        back: newCard.back.trim(),
        tags: (newCard.tags || '').trim(),
        ...(sectionIndex !== null ? {
          sectionIndex,
          sectionKey: `section-${sectionIndex}`,
          sectionTitle: sectionTitle || getSectionTitle(sectionIndex),
        } : {}),
        ...(sourcePointIndex !== null ? {
          sourcePointIndex,
          sourcePointText,
        } : {}),
      },
    ]

    setFlashcards(updatedFlashcards)
    setNewCard(createEmptyCardDraft())
    setShowAddCard(false)
    await persistFlashcards(updatedFlashcards, { immediate: true, errorPrefix: 'Failed to save flashcard' })
  }

  const startEditCard = (index) => {
    const card = flashcards[index]
    const initialContentTags = getEditableTopicTags(card)

    // Check if this is an occlusion card
    if (card.occlusionData) {
      setEditingOcclusionCard({
        index,
        originalImage: card.occlusionData.originalImage,
        label: { ...card.occlusionData.label },
        questionText: card.occlusionData.questionText || 'What is the masked structure?',
        contentTags: initialContentTags,
      })
      setOcclusionModalOpen(true)
      setOcclusionStep('edit-card')
      setNewTagInput('')
    } else {
      setEditingCard({
        index,
        front: card.front || '',
        back: card.back || '',
        tags: card.tags || '',
        contentTags: initialContentTags,
      })
      setNewTagInput('')
      setActiveEditableImage(null)
      setExpandedCards((prev) => ({ ...prev, [index]: true }))
    }
  }

  const saveEditCard = async () => {
    if (!editingCard) return
    const { index, front, back, tags, contentTags } = editingCard
    const normalizedContentTags = normalizeEditableTagList(contentTags)
    const legacyTagsString = normalizedContentTags.join(', ')
    const updatedFlashcards = flashcards.map((card, i) => {
      if (i !== index) return card
      const nextBack = back.trim()
      const existingAnswerImages = Array.isArray(card.answerImages) ? card.answerImages : []
      const syncedAnswerImages = existingAnswerImages.filter((img) => nextBack.includes(img.dataUrl))

      // Sync AI suggestions with edited tags to prevent deleted tags from reappearing
      // and ensure newly added tags don't get lost. Clear both contentTags and content_tags
      // since getSuggestedTagsList merges both formats.
      let updatedAiTagSuggestions = card.aiTagSuggestions
      if (updatedAiTagSuggestions) {
        const existingTags = [
          ...(Array.isArray(updatedAiTagSuggestions.contentTags) ? updatedAiTagSuggestions.contentTags : []),
          ...(Array.isArray(updatedAiTagSuggestions.content_tags) ? updatedAiTagSuggestions.content_tags : [])
        ]
        const syncedSuggestionTags = existingTags.filter((tag) => normalizedContentTags.includes(tag))
        updatedAiTagSuggestions = {
          ...updatedAiTagSuggestions,
          contentTags: syncedSuggestionTags,
          content_tags: syncedSuggestionTags,
          status: 'accepted',
          acceptedAt: new Date().toISOString()
        }
      }

      return {
        ...card,
        front: front.trim(),
        back: nextBack,
        tags: legacyTagsString || tags.trim(),
        // Update both camelCase and snake_case versions since getCardFilterTags checks snake_case first
        contentTags: normalizedContentTags,
        content_tags: normalizedContentTags,
        customUserTags: normalizedContentTags,
        custom_user_tags: normalizedContentTags,
        aiTagSuggestions: updatedAiTagSuggestions,
        ai_tag_suggestions: updatedAiTagSuggestions,
        answerImages: syncedAnswerImages.length > 0 ? syncedAnswerImages : undefined
      }
    })

    setFlashcards(updatedFlashcards)
    setEditingCard(null)
    setActiveEditableImage(null)
    await persistFlashcards(updatedFlashcards, { immediate: true, errorPrefix: 'Failed to save flashcard' })
  }

  const deleteCard = async (index) => {
    const updatedFlashcards = flashcards.filter((_, i) => i !== index)
    setFlashcards(updatedFlashcards)
    await persistFlashcards(updatedFlashcards, { immediate: true, errorPrefix: 'Failed to delete flashcard' })
  }

  // Create masked image with one label covered
  const createMaskedImage = (imageDataUrl, labelToMask) => {
    return new Promise((resolve, reject) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')

        // Draw original image
        ctx.drawImage(img, 0, 0)

        // Calculate pixel coordinates from percentages
        const x = (labelToMask.x / 100) * img.width
        const y = (labelToMask.y / 100) * img.height
        const width = (labelToMask.width / 100) * img.width
        const height = (labelToMask.height / 100) * img.height

        // Draw black rectangle
        ctx.fillStyle = '#000000'
        ctx.fillRect(x, y, width, height)

        resolve(canvas.toDataURL('image/jpeg', 0.9))
      }
      img.onerror = () => {
        reject(new Error('Failed to load image for occlusion rendering'))
      }
      img.src = imageDataUrl
    })
  }

  // Generate occlusion cards
  const generateOcclusionCards = async () => {
    if (!selectedOcclusionImage || detectedLabels.length === 0) return

    const enabledLabels = detectedLabels.filter(l => l.enabled)
    if (enabledLabels.length === 0) {
      toast.warn('Please enable at least one label to generate cards.')
      return
    }

    setOcclusionProcessing(true)
    setOcclusionStep('generating')

    try {
      const sourceDataUrl = await resolveImageSourceToDataUrl(selectedOcclusionImage.image.dataUrl)
      if (!sourceDataUrl) {
        throw new Error('Could not load selected image data')
      }

      // Generate cards - one per enabled label (no AI explanations)
      const newCards = []
      for (const label of enabledLabels) {
        const maskedDataUrl = await createMaskedImage(sourceDataUrl, label)

        newCards.push({
          front: `<img src="${maskedDataUrl}" style="max-width:400px;"><br><br>What is the masked structure?`,
          back: `<b>${label.text}</b>`,
          sectionIndex: selectedOcclusionImage.sectionIndex,
          sectionKey: selectedOcclusionImage.sectionKey,
          sectionTitle: selectedOcclusionImage.sectionTitle,
          occlusionData: {
            originalImage: sourceDataUrl,
            label: { x: label.x, y: label.y, width: label.width, height: label.height, text: label.text },
            questionText: 'What is the masked structure?'
          }
        })
      }

      const suggested = await suggestTopicTagsForCards(newCards)
      const taggedNewCards = applySuggestedTopicTagsToCards(newCards, suggested)
      const updatedFlashcards = [...flashcards, ...taggedNewCards]
      setFlashcards(updatedFlashcards)
      await persistFlashcards(updatedFlashcards, { immediate: true })

      // Close modal
      setOcclusionModalOpen(false)
      setOcclusionStep('select')
      setSelectedOcclusionImage(null)
      setDetectedLabels([])

      toast.success(`Generated ${taggedNewCards.length} occlusion cards!`)
    } catch {
      toast.error('Failed to generate cards. Please try again.')
    } finally {
      setOcclusionProcessing(false)
    }
  }

  // Save edited occlusion card
  const saveOcclusionCardEdit = async () => {
    if (!editingOcclusionCard) return
    const { index, originalImage, label, questionText, contentTags } = editingOcclusionCard

    const maskedDataUrl = await createMaskedImage(originalImage, label)
    const normalizedTags = Array.isArray(contentTags) ? contentTags : []

    const updatedCard = {
      ...flashcards[index],
      front: `<img src="${maskedDataUrl}" style="max-width:400px;"><br><br>${questionText}`,
      back: `<b>${label.text}</b>`,
      // Update both camelCase and snake_case versions since getCardFilterTags checks snake_case first
      contentTags: normalizedTags,
      content_tags: normalizedTags,
      customUserTags: normalizedTags,
      custom_user_tags: normalizedTags,
      // Clear both camelCase and snake_case AI suggestions
      aiTagSuggestions: null,
      ai_tag_suggestions: null,
      occlusionData: {
        originalImage,
        label: { ...label },
        questionText
      }
    }
    const updated = [...flashcards]
    updated[index] = updatedCard
    setFlashcards(updated)
    setEditingOcclusionCard(null)
    setOcclusionModalOpen(false)
    await persistFlashcards(updated, { immediate: true, errorPrefix: 'Failed to save occlusion card' })
  }

  // Generate interpretation card from selected image
  const generateInterpretationCard = async (imageData) => {
    if (!imageData) {
      return
    }

    setInterpretationProcessing(true)
    setInterpretationStep('generating')

    try {
      const debugId = `interp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await supabase.auth.refreshSession()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token

      if (!accessToken) {
        throw new Error('Please sign in')
      }

      // Extract media type from data URL (e.g., "data:image/png;base64,...")
      const sourceDataUrl = await resolveImageSourceToDataUrl(imageData.image.dataUrl)
      if (!sourceDataUrl) {
        throw new Error('Could not load selected image data')
      }
      const optimizedImage = await optimizeInterpretationImageDataUrl(sourceDataUrl, {
        maxBytes: 1_800_000,
        maxDimension: 1400,
      })
      const mediaType = optimizedImage.mediaType || 'image/jpeg'
      const base64Data = String(optimizedImage.dataUrl || '').split(',')[1] || ''
      const estimatedBytes = estimateBase64Bytes(base64Data)
      if (!base64Data) {
        throw new Error('Could not prepare selected image for interpretation')
      }
      if (estimatedBytes > 2_100_000) {
        throw new Error('Selected image is too large. Please crop tighter or use a smaller image.')
      }
      console.info('[interpretation]', debugId, 'prepared payload', {
        mediaType,
        estimatedBytes,
        optimized: !!optimizedImage.optimized,
      })

      // Keep trace context concise to avoid oversized requests.
      const context = buildInterpretationContext(imageData)

      // Primary path: Supabase client invoke
      let result = null
      let error = null
      let invokeThrownError = null
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      try {
        const invokeResponse = await supabase.functions.invoke('generate-interpretation', {
          body: {
            image_base64: base64Data,
            media_type: mediaType,
            context
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: anonKey,
          },
        })
        result = invokeResponse?.data || null
        error = invokeResponse?.error || null
      } catch (invokeErr) {
        invokeThrownError = invokeErr
        console.warn('[interpretation]', debugId, 'invoke threw', invokeErr)
      }

      if (!error && result?.question) {
        // Success - use result
        setInterpretationCard({
          question: result.question,
          answer: result.answer,
          imageDataUrl: imageData.image.dataUrl
        })
        setInterpretationStep('confirm')
        return
      }
      if (error) {
        console.warn('[interpretation]', debugId, 'invoke returned error object', error)
      }

      // Fallback path: direct fetch (same pattern used by flashcards generation)
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const functionUrl = `${supabaseUrl}/functions/v1/generate-interpretation`

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
        },
        body: JSON.stringify({
          image_base64: base64Data,
          media_type: mediaType,
          context
        }),
      })

      const fallbackRaw = await response.text()
      let fallbackResult = {}
      try {
        fallbackResult = fallbackRaw ? JSON.parse(fallbackRaw) : {}
      } catch {
        fallbackResult = {}
      }
      console.info('[interpretation]', debugId, 'fallback response', {
        status: response.status,
        ok: response.ok,
        bodyPreview: String(fallbackRaw || '').slice(0, 220),
      })

      if (!response.ok || !fallbackResult?.question) {
        const fallbackStatusDetail = fallbackRaw
          ? `Edge Function request failed (${response.status}): ${fallbackRaw.slice(0, 220)}`
          : `Edge Function request failed (${response.status})`
        const baseError =
          fallbackResult?.error ||
          fallbackStatusDetail ||
          error?.message ||
          invokeThrownError?.message ||
          (fallbackRaw ? `Edge Function request failed (${response.status}): ${fallbackRaw.slice(0, 220)}` : `Edge Function request failed (${response.status})`)
        const authErrorText = String(baseError || '').toLowerCase()
        const isAuthError = response.status === 401
          || response.status === 403
          || authErrorText.includes('invalid jwt')
          || authErrorText.includes('invalid token')
          || authErrorText.includes('expired token')
          || authErrorText.includes('unauthorized')
        if (isAuthError) {
          await supabase.auth.refreshSession()
          const { data: retrySessionData } = await supabase.auth.getSession()
          const retryAccessToken = retrySessionData?.session?.access_token
          if (retryAccessToken && retryAccessToken !== accessToken) {
            const retryResponse = await fetch(functionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${retryAccessToken}`,
                apikey: anonKey,
              },
              body: JSON.stringify({
                image_base64: base64Data,
                media_type: mediaType,
                context
              }),
            })
            const retryRaw = await retryResponse.text()
            let retryResult = {}
            try {
              retryResult = retryRaw ? JSON.parse(retryRaw) : {}
            } catch {
              retryResult = {}
            }
            if (retryResponse.ok && retryResult?.question) {
              setInterpretationCard({
                question: retryResult.question,
                answer: retryResult.answer,
                imageDataUrl: imageData.image.dataUrl
              })
              setInterpretationStep('confirm')
              return
            }
          }
        }
        throw new Error(baseError)
      }

      setInterpretationCard({
        question: fallbackResult.question,
        answer: fallbackResult.answer,
        imageDataUrl: imageData.image.dataUrl
      })
      setInterpretationStep('confirm')
    } catch (err) {
      console.error('Interpretation generation failed:', err)
      const message = err?.message ? `Failed to generate interpretation card: ${err.message}` : 'Failed to generate interpretation card. Please try again.'
      toast.error(message)
      setInterpretationStep('select')
    } finally {
      setInterpretationProcessing(false)
    }
  }

  // Add interpretation card to deck
  const addInterpretationCard = async () => {
    if (!interpretationCard) return

    const newCard = {
      front: `<img src="${interpretationCard.imageDataUrl}" style="max-width:400px;"><br><br>${interpretationCard.question}`,
      back: interpretationCard.answer,
      sectionIndex: selectedInterpretationImage?.sectionIndex,
      sectionKey: selectedInterpretationImage?.sectionKey,
      sectionTitle: selectedInterpretationImage?.sectionTitle,
      interpretationData: {
        imageDataUrl: interpretationCard.imageDataUrl,
        question: interpretationCard.question,
        answer: interpretationCard.answer
      }
    }

    const taggedCard = applySuggestedTopicTagsToCards(
      [newCard],
      await suggestTopicTagsForCards([newCard])
    )[0]
    const updatedFlashcards = [...flashcards, taggedCard]
    setFlashcards(updatedFlashcards)

    // Reset modal
    setInterpretationModalOpen(false)
    setInterpretationStep('select')
    setSelectedInterpretationImage(null)
    setInterpretationCard(null)
    await persistFlashcards(updatedFlashcards, { immediate: true, errorPrefix: 'Failed to save interpretation card' })
  }

  const openOcclusionFromMenu = () => {
    if (notesImagesLoading) {
      toast.info('Images are still loading. Please wait a moment.')
      return
    }
    const imageCount = getAllNotesImages().length
    if (imageCount === 0) {
      toast.warn('No images found in your notes. Add images to your lecture notes first.')
      return
    }
    setAddCardMenuOpen(false)
    setOcclusionModalOpen(true)
    setOcclusionStep('select')
  }

  const openInterpretationFromMenu = () => {
    if (notesImagesLoading) {
      toast.info('Images are still loading. Please wait a moment.')
      return
    }
    const imageCount = getAllNotesImages().length
    if (imageCount === 0) {
      toast.warn('No images found in your notes. Add images to your lecture notes first.')
      return
    }
    setAddCardMenuOpen(false)
    setInterpretationModalOpen(true)
    setInterpretationStep('select')
  }

  const notesCoverageSections = useMemo(() => {
    const sections = Array.isArray(lecture?.notes?.notes) ? lecture.notes.notes : []
    return sections.map((section, sectionIndex) => {
      const points = Array.isArray(section?.points) ? section.points : []
      const levels = Array.isArray(section?.pointLevels) ? section.pointLevels : []
      return {
        sectionIndex,
        sectionTitle: String(section?.section || `Section ${sectionIndex + 1}`),
        points: points.map((point, pointIndex) => {
          const levelRaw = Number(levels[pointIndex] ?? 0)
          const level = Number.isFinite(levelRaw) ? Math.max(0, Math.floor(levelRaw)) : 0
          const text = stripHtml(point)
          return {
            key: getCoverageKey(sectionIndex, pointIndex),
            sectionIndex,
            pointIndex,
            level,
            text: text || '(Empty bullet)',
          }
        }),
      }
    }).filter((section) => section.points.length > 0)
  }, [lecture?.notes])

  const sourceCoverageByKey = useMemo(() => {
    const map = {}
    flashcards.forEach((card, index) => {
      const sectionIndex = Number.isInteger(card?.sectionIndex) ? card.sectionIndex : null
      const pointIndex = Number.isInteger(card?.sourcePointIndex) ? card.sourcePointIndex : null
      if (!Number.isInteger(sectionIndex) || !Number.isInteger(pointIndex)) return
      const key = getCoverageKey(sectionIndex, pointIndex)
      if (!map[key]) map[key] = []
      map[key].push(index)
    })
    return map
  }, [flashcards])

  const coverageSummary = useMemo(() => {
    const points = notesCoverageSections.flatMap((section) => section.points)
    const total = points.length
    const covered = points.filter((point) => (sourceCoverageByKey[point.key] || []).length > 0).length
    const uncovered = Math.max(0, total - covered)
    const coveragePct = total > 0 ? ((covered / total) * 100).toFixed(1) : '0.0'
    return { total, covered, uncovered, coveragePct }
  }, [notesCoverageSections, sourceCoverageByKey])

  const openAddCardFromCoverage = async (point) => {
    const coverageKey = getCoverageKey(point.sectionIndex, point.pointIndex)
    setCreatingFromCoverageKey(coverageKey)
    let aiQuestion = ''
    let aiAnswer = ''
    try {
      const aiCards = await generateFlashcardsFromNotes({
        notes: {
          title: lecture?.title || 'Lecture',
          notes: [
            {
              section: point.sectionTitle || `Section ${point.sectionIndex + 1}`,
              points: [point.text],
            },
          ],
        },
        lectureTitle: lecture?.title || 'Lecture',
        moduleAbbreviation: module?.abbreviation || '',
      })
      const first = Array.isArray(aiCards) ? aiCards[0] : null
      aiQuestion = stripHtml(first?.front || '')
      aiAnswer = stripHtml(first?.back || '')
    } catch {
      // AI question generation fallback handled below.
    }
    const fallbackQuestion = `What is the key idea from this point?\n${point.text}`
    const nextFront = aiQuestion || fallbackQuestion
    const nextBack = aiAnswer || point.text

    setShowSourceCoverage(false)
    setShowAddCard(true)
    setNewCard({
      ...createEmptyCardDraft(),
      front: point.text === '(Empty bullet)' ? '' : nextFront,
      sectionIndex: point.sectionIndex,
      sourcePointIndex: point.pointIndex,
      sourcePointText: point.text === '(Empty bullet)' ? '' : point.text,
      sectionTitle: point.sectionTitle || '',
      back: point.text === '(Empty bullet)' ? '' : nextBack,
    })
    setCreatingFromCoverageKey(null)
  }

  const openLinkedCardsFromCoverage = (linkedIndices) => {
    if (!Array.isArray(linkedIndices) || linkedIndices.length === 0) return
    setShowSourceCoverage(false)
    setExpandedCards((prev) => {
      const next = { ...prev }
      linkedIndices.forEach((index) => { next[index] = true })
      return next
    })
    const firstIndex = linkedIndices[0]
    window.setTimeout(() => {
      const row = cardRowRefs.current[firstIndex]
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 40)
  }

  const pickerCard = imagePickerCardIndex !== null ? flashcards[imagePickerCardIndex] : null
  const pickerImages = pickerCard ? getSuggestedImagesForCard(pickerCard) : []

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-divider">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                disabled={saving || exitingRef.current}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={`Back to ${module?.name || 'module'}`}
              >
                <ArrowLeft className="w-5 h-5 text-secondary" />
              </button>
              {module && (
                <div
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
                  style={{ backgroundColor: `${module.color}15`, color: module.color }}
                >
                  {module.abbreviation}
                </div>
              )}
              <h1 className="text-2xl font-bold text-primary">{lecture.title}</h1>
            </div>

            <div className="flex items-center gap-2">
              {flashcards.length > 0 ? (
                <>
                  <button
                    onClick={exportCsv}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export CSV
                  </button>

                </>
              ) : (
                <>
                  <button
                    onClick={() => csvImportInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Import CSV
                  </button>
                  <input
                    type="file"
                    ref={csvImportInputRef}
                    onChange={importCsv}
                    accept=".csv,text/csv"
                    className="hidden"
                  />
                  <button
                    onClick={exportCsv}
                    disabled={!flashcards.length}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export CSV
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-4 text-sm">
          <span className={saveStatus === 'error' ? 'text-red-600' : 'text-secondary'}>
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Save failed' : 'Saved'}
          </span>
        </div>

        {showAddCard && (
          <div className="bg-surface rounded-xl border border-divider p-4 mb-5">
            <h3 className="font-semibold text-primary mb-3">Add New Card</h3>
            <div className="space-y-2">
              <input
                type="text"
                value={newCard.front}
                onChange={(e) => setNewCard((prev) => ({ ...prev, front: e.target.value }))}
                placeholder="Front (question)"
                className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm"
              />

              {/* Formatting Toolbar for New Card */}
              <div className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-lg border border-divider">
                <div className="text-xs text-secondary w-full mb-1">Format answer:</div>
                <button
                  type="button"
                  onClick={() => {
                    if (!newCardBackRef.current) return
                    newCardBackRef.current.focus()
                    document.execCommand('bold')
                    setTimeout(() => {
                      if (newCardBackRef.current) {
                        setNewCard(p => ({ ...p, back: newCardBackRef.current.innerHTML }))
                      }
                    }, 10)
                  }}
                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs font-bold"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!newCardBackRef.current) return
                    newCardBackRef.current.focus()
                    document.execCommand('italic')
                    setTimeout(() => {
                      if (newCardBackRef.current) {
                        setNewCard(p => ({ ...p, back: newCardBackRef.current.innerHTML }))
                      }
                    }, 10)
                  }}
                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs italic"
                >
                  I
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!newCardBackRef.current) return
                    newCardBackRef.current.focus()
                    document.execCommand('underline')
                    setTimeout(() => {
                      if (newCardBackRef.current) {
                        setNewCard(p => ({ ...p, back: newCardBackRef.current.innerHTML }))
                      }
                    }, 10)
                  }}
                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs underline"
                >
                  U
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!newCardBackRef.current) return
                    newCardBackRef.current.focus()
                    document.execCommand('insertUnorderedList')
                    setTimeout(() => {
                      if (newCardBackRef.current) {
                        setNewCard(p => ({ ...p, back: newCardBackRef.current.innerHTML }))
                      }
                    }, 10)
                  }}
                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs"
                  title="Bullet point"
                >
                  •
                </button>
                <span className="border-l border-divider mx-1"></span>
                {essentialSymbols.map(({ symbol }) => (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => {
                      if (!newCardBackRef.current) return
                      newCardBackRef.current.focus()
                      document.execCommand('insertText', false, symbol)
                      setTimeout(() => {
                      if (newCardBackRef.current) {
                        setNewCard(p => ({ ...p, back: newCardBackRef.current.innerHTML }))
                      }
                    }, 10)
                    }}
                    className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs"
                  >
                    {symbol}
                  </button>
                ))}
              </div>

              <div
                ref={(el) => {
                  if (el) {
                    newCardBackRef.current = el
                    if (el.innerHTML !== newCard.back) {
                      const selection = window.getSelection()
                      const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null
                      const startOffset = range?.startOffset
                      const startContainer = range?.startContainer

                      el.innerHTML = newCard.back || ''

                      // Restore cursor position after setting innerHTML
                      if (range && startContainer && el.contains(startContainer)) {
                        try {
                          range.setStart(startContainer, Math.min(startOffset || 0, startContainer.textContent?.length || 0))
                          range.collapse(true)
                          selection.removeAllRanges()
                          selection.addRange(range)
                        } catch (e) {
                          // Cursor positioning failed, ignore
                        }
                      }
                    }
                  }
                }}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => {
                  const html = e.currentTarget.innerHTML
                  setNewCard(p => ({ ...p, back: html }))
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
                data-placeholder="Back (answer)"
                className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                style={{ whiteSpace: 'pre-wrap' }}
              />
              <input
                type="text"
                value={newCard.tags}
                onChange={(e) => setNewCard((prev) => ({ ...prev, tags: e.target.value }))}
                placeholder="Tags (optional)"
                className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm"
              />
              {Number.isInteger(newCard.sectionIndex) && Number.isInteger(newCard.sourcePointIndex) && (
                <p className="text-xs text-secondary">
                  Source linked: Section {newCard.sectionIndex + 1}, Bullet {newCard.sourcePointIndex + 1}
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowAddCard(false)
                    setNewCard(createEmptyCardDraft())
                  }}
                  className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-primary rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={addCard}
                  disabled={!newCard.front.trim() || !newCard.back.trim()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg text-sm"
                >
                  Add Card
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-surface rounded-xl border border-divider p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-primary">{flashcards.length} Flashcards</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSourceCoverage(true)}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-medium transition-colors"
              >
                View Source Coverage
              </button>
              <div className="relative">
                <button
                  onClick={() => setAddCardMenuOpen((prev) => !prev)}
                  className="p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                  title="Add flashcard"
                >
                  <Plus className="w-4 h-4" />
                </button>
                {addCardMenuOpen && (
                  <div className="absolute right-0 mt-2 bg-white border border-divider rounded-lg shadow-lg p-2 flex gap-2 z-20">
                    <button
                      onClick={() => {
                        setNewCard(createEmptyCardDraft())
                        setShowAddCard(true)
                        setAddCardMenuOpen(false)
                      }}
                      className="p-2 bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
                      title="Add text flashcard"
                    >
                      <Type className="w-4 h-4" />
                    </button>
                    <button
                      onClick={openInterpretationFromMenu}
                      className="p-2 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded"
                      title="Add interpretation flashcard"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <button
                      onClick={openOcclusionFromMenu}
                      className="p-2 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded"
                      title="Add image occlusion flashcard"
                    >
                      <EyeOff className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {loadingFlashcards ? (
            <div className="min-h-[240px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
            </div>
          ) : flashcards.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-gray-100 rounded-2xl mb-4">
                <Layers className="w-7 h-7 text-secondary" />
              </div>
              <h3 className="text-lg font-semibold text-primary mb-2">No flashcards yet</h3>
              <p className="text-sm text-secondary max-w-sm mx-auto">
                Generate flashcards from your lecture notes, or import them using the buttons above.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {flashcards.map((card, index) => (
                <div
                  key={index}
                  ref={(el) => {
                    if (el) {
                      cardRowRefs.current[index] = el
                    } else {
                      delete cardRowRefs.current[index]
                    }
                  }}
                  className="border border-divider rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedCards((prev) => ({ ...prev, [index]: !prev[index] }))}
                    className="w-full px-4 py-3 flex justify-between items-center text-left bg-gray-50 hover:bg-gray-100"
                  >
                    <span className="text-sm text-primary truncate pr-3">
                      #{index + 1} {stripHtml(card.front).substring(0, 100)}
                    </span>
                    <span className="text-xs text-secondary">{expandedCards[index] ? '▲' : '▼'}</span>
                  </button>

                  {expandedCards[index] && (
                    <div className="px-4 py-3 border-t border-divider">
                      {editingCard?.index === index ? (
                        <div className="space-y-2">
                          {/* For interpretation cards, show image separately */}
                          {card.interpretationData && (
                            <div className="mb-2">
                              <img
                                src={card.interpretationData.imageDataUrl}
                                alt="Interpretation"
                                style={{maxWidth: '400px'}}
                                className="rounded-lg border border-divider"
                              />
                            </div>
                          )}
                          <input
                            type="text"
                            value={card.interpretationData ? editingCard.front.replace(/<img[^>]*>/g, '').replace(/<br\s*\/?>/gi, '').trim() : editingCard.front}
                            onChange={(e) => {
                              if (card.interpretationData) {
                                // Rebuild front with image + new question
                                const newFront = `<img src="${card.interpretationData.imageDataUrl}" style="max-width:400px;"><br><br>${e.target.value}`
                                setEditingCard((prev) => ({ ...prev, front: newFront }))
                              } else {
                                setEditingCard((prev) => ({ ...prev, front: e.target.value }))
                              }
                            }}
                            className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm"
                            placeholder={card.interpretationData ? "Question" : "Front"}
                          />

                          {/* Formatting Toolbar for Edit Card */}
                          <div className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-lg border border-divider">
                            <div className="text-xs text-secondary w-full mb-1">Format answer:</div>
                            <button
                              type="button"
                              onClick={() => {
                                if (!editCardBackRef.current) return
                                editCardBackRef.current.focus()
                                document.execCommand('bold')
                                setTimeout(() => {
                                  if (editCardBackRef.current) {
                                    setEditingCard(p => ({ ...p, back: editCardBackRef.current.innerHTML }))
                                  }
                                }, 10)
                              }}
                              className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs font-bold"
                            >
                              B
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!editCardBackRef.current) return
                                editCardBackRef.current.focus()
                                document.execCommand('italic')
                                setTimeout(() => {
                                  if (editCardBackRef.current) {
                                    setEditingCard(p => ({ ...p, back: editCardBackRef.current.innerHTML }))
                                  }
                                }, 10)
                              }}
                              className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs italic"
                            >
                              I
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!editCardBackRef.current) return
                                editCardBackRef.current.focus()
                                document.execCommand('underline')
                                setTimeout(() => {
                                  if (editCardBackRef.current) {
                                    setEditingCard(p => ({ ...p, back: editCardBackRef.current.innerHTML }))
                                  }
                                }, 10)
                              }}
                              className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs underline"
                            >
                              U
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!editCardBackRef.current) return
                                editCardBackRef.current.focus()
                                document.execCommand('insertUnorderedList')
                                setTimeout(() => {
                                  if (editCardBackRef.current) {
                                    setEditingCard(p => ({ ...p, back: editCardBackRef.current.innerHTML }))
                                  }
                                }, 10)
                              }}
                              className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs"
                              title="Bullet point"
                            >
                              •
                            </button>
                            <span className="border-l border-divider mx-1"></span>
                            {essentialSymbols.map(({ symbol }) => (
                              <button
                                key={symbol}
                                type="button"
                                onClick={() => {
                                  if (!editCardBackRef.current) return
                                  editCardBackRef.current.focus()
                                  document.execCommand('insertText', false, symbol)
                                  setTimeout(() => {
                                  if (editCardBackRef.current) {
                                    setEditingCard(p => ({ ...p, back: editCardBackRef.current.innerHTML }))
                                  }
                                }, 10)
                                }}
                                className="px-2 py-1 bg-white hover:bg-gray-100 border border-divider rounded text-xs"
                              >
                                {symbol}
                              </button>
                            ))}
                          </div>

                          <div className="relative" ref={editAnswerContainerRef}>
                            <div
                              ref={(el) => {
                              if (el) {
                                editCardBackRef.current = el
                                if (el.innerHTML !== editingCard.back) {
                                  const selection = window.getSelection()
                                  const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null
                                  const startOffset = range?.startOffset
                                  const startContainer = range?.startContainer

                                  el.innerHTML = editingCard.back || ''

                                  // Restore cursor position after setting innerHTML
                                  if (range && startContainer && el.contains(startContainer)) {
                                    try {
                                      range.setStart(startContainer, Math.min(startOffset || 0, startContainer.textContent?.length || 0))
                                      range.collapse(true)
                                      selection.removeAllRanges()
                                      selection.addRange(range)
                                    } catch (e) {
                                      // Cursor positioning failed, ignore
                                    }
                                  }
                                }
                              }
                            }}
                            contentEditable
                            suppressContentEditableWarning
                            onClick={handleEditAnswerClick}
                            onInput={(e) => {
                              const html = e.currentTarget.innerHTML
                              setEditingCard(p => ({ ...p, back: html }))
                              setActiveEditableImage(null)
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
                            {activeEditableImage && (
                              <button
                                onClick={() => removeEditableImageByIndex(activeEditableImage.imgIndex)}
                                className="absolute w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow z-10"
                                style={{ left: activeEditableImage.left, top: activeEditableImage.top }}
                                title="Remove image"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {/* Content Tags - Editable Bubbles */}
                          <div className="space-y-2">
                            <label className="text-xs text-secondary">Topic Tags</label>
                            <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-gray-50 border border-divider rounded-lg">
                              {editingCard.contentTags?.map((tag, tagIdx) => (
                                <span
                                  key={tagIdx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full"
                                >
                                  {tag}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCard((prev) => ({
                                        ...prev,
                                        contentTags: prev.contentTags.filter((_, i) => i !== tagIdx)
                                      }))
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
                                    if (!editingCard.contentTags?.includes(newTag)) {
                                      setEditingCard((prev) => ({
                                        ...prev,
                                        contentTags: [...(prev.contentTags || []), newTag]
                                      }))
                                    }
                                    setNewTagInput('')
                                  }
                                }}
                                className="flex-1 min-w-[100px] bg-transparent border-none outline-none text-sm placeholder:text-gray-400"
                                placeholder="Type tag and press Enter..."
                              />
                            </div>
                          </div>

                          {/* Legacy Tags (hidden but preserved) */}
                          <input
                            type="hidden"
                            value={editingCard.tags}
                            onChange={(e) => setEditingCard((prev) => ({ ...prev, tags: e.target.value }))}
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingCard(null)}
                              className="px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />Cancel
                            </button>
                            <button
                              onClick={saveEditCard}
                              className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 pb-3 border-b border-divider">
                            <p className="text-xs text-secondary mb-1">Q:</p>
                            <div className="text-sm text-primary" dangerouslySetInnerHTML={{ __html: sanitizeHtml(card.front) }} />
                          </div>
                          <div>
                            <p className="text-xs text-secondary mb-1">A:</p>
                            <p
                              className="text-sm text-primary"
                              dangerouslySetInnerHTML={{
                                __html: card.occlusionData?.label?.text
                                  ? `<b>${card.occlusionData.label.text}</b>`
                                  : sanitizeHtml(card.back)
                              }}
                            />
                          </div>
                          <div className="flex justify-between items-start mt-3">
                            <div className="flex-1 mr-4">
                              <p className="text-xs text-secondary mb-1">Tags:</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(() => {
                                  const displayTags = getCardDisplayTags(card)
                                  if (displayTags.length === 0) {
                                    return <span className="text-xs text-secondary">-</span>
                                  }

                                  return displayTags.map((tag, tagIdx) => (
                                    <span
                                      key={tagIdx}
                                      className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full"
                                    >
                                      {tag}
                                    </span>
                                  ))
                                })()}
                              </div>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <button
                                onClick={() => startEditCard(index)}
                                className="p-2 bg-gray-200 hover:bg-gray-300 rounded text-sm"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setImagePickerCardIndex(index)
                                  setCardImagePickerOpen(true)
                                }}
                                className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded text-sm"
                                title="Add image to answer"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteCard(index)}
                                className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded text-sm"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showSourceCoverage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-divider p-6 max-w-5xl w-full max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-primary">Source Notes Coverage</h3>
                <p className="text-sm text-secondary mt-1">
                  Coverage is based on flashcard source links (`section + bullet`), including nested bullets.
                </p>
              </div>
              <button
                onClick={() => setShowSourceCoverage(false)}
                className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
                aria-label="Close coverage panel"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            {coverageSummary.total === 0 ? (
              <div className="text-sm text-secondary bg-gray-50 border border-divider rounded-lg p-4">
                No note bullets found for this lecture.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-lg border border-divider p-3">
                    <div className="text-xs text-secondary">Total Bullets</div>
                    <div className="text-lg font-semibold text-primary">{coverageSummary.total}</div>
                  </div>
                  <div className="bg-green-50 rounded-lg border border-green-200 p-3">
                    <div className="text-xs text-green-700">Covered</div>
                    <div className="text-lg font-semibold text-green-700">{coverageSummary.covered}</div>
                  </div>
                  <div className="bg-amber-50 rounded-lg border border-amber-200 p-3">
                    <div className="text-xs text-amber-700">Uncovered</div>
                    <div className="text-lg font-semibold text-amber-700">{coverageSummary.uncovered}</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg border border-blue-200 p-3">
                    <div className="text-xs text-blue-700">Coverage</div>
                    <div className="text-lg font-semibold text-blue-700">{coverageSummary.coveragePct}%</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => setCoverageFilter('all')}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      coverageFilter === 'all'
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-secondary border-divider hover:bg-gray-50'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setCoverageFilter('uncovered')}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      coverageFilter === 'uncovered'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-secondary border-divider hover:bg-gray-50'
                    }`}
                  >
                    Uncovered Only
                  </button>
                </div>

                <div className="space-y-3">
                  {notesCoverageSections.map((section) => {
                    const pointsForSection = section.points.filter((point) => {
                      const linkedIndices = sourceCoverageByKey[point.key] || []
                      if (coverageFilter === 'uncovered') return linkedIndices.length === 0
                      return true
                    })
                    if (pointsForSection.length === 0) return null

                    return (
                      <div key={`coverage-section-${section.sectionIndex}`} className="border border-divider rounded-lg overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50 border-b border-divider">
                          <p className="text-sm font-medium text-primary">
                            Section {section.sectionIndex + 1}: {section.sectionTitle}
                          </p>
                        </div>
                        <div className="divide-y divide-divider">
                          {pointsForSection.map((point) => {
                            const linkedIndices = sourceCoverageByKey[point.key] || []
                            const covered = linkedIndices.length > 0
                            return (
                              <div key={`coverage-point-${point.key}`} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0 flex-1" style={{ paddingLeft: `${Math.min(point.level, 4) * 16}px` }}>
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                        covered
                                          ? 'bg-green-100 text-green-700'
                                          : 'bg-amber-100 text-amber-700'
                                      }`}>
                                        {covered ? `Covered (${linkedIndices.length})` : 'Uncovered'}
                                      </span>
                                      <span className="text-[11px] text-secondary">
                                        S{point.sectionIndex + 1} • P{point.pointIndex + 1}
                                      </span>
                                    </div>
                                    <p className="text-sm text-primary break-words">{point.text}</p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {!covered && (
                                      <button
                                        disabled={creatingFromCoverageKey === point.key}
                                        onClick={() => openAddCardFromCoverage({ ...point, sectionTitle: section.sectionTitle })}
                                        className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors inline-flex items-center gap-1.5"
                                      >
                                        {creatingFromCoverageKey === point.key ? (
                                          <>
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Generating...
                                          </>
                                        ) : (
                                          'Create Card'
                                        )}
                                      </button>
                                    )}
                                    {covered && (
                                      <button
                                        onClick={() => openLinkedCardsFromCoverage(linkedIndices)}
                                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-colors"
                                      >
                                        Show Linked Cards
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {cardImagePickerOpen && pickerCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-divider p-6 max-w-3xl w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-primary">Attach Image To Answer</h3>
                <p className="text-sm text-secondary">Suggested images from the same notes section appear first.</p>
              </div>
              <button
                onClick={() => {
                  setCardImagePickerOpen(false)
                  setImagePickerCardIndex(null)
                }}
                className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {pickerImages.map((item, idx) => {
                const isSuggested = Number.isInteger(pickerCard.sectionIndex) && item.sectionIndex === pickerCard.sectionIndex
                return (
                  <button
                    key={`${item.type}-${item.sectionIndex}-${item.pointIndex ?? 'section'}-${idx}`}
                    onClick={() => attachImageToCardAnswer(imagePickerCardIndex, item)}
                    className={`text-left border rounded-lg p-2 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors ${isSuggested ? 'border-indigo-300' : 'border-divider'}`}
                  >
                    <img
                      src={item.image.dataUrl}
                      alt={item.label}
                      className="w-full h-28 object-contain rounded bg-gray-100"
                    />
                    <div className="mt-2 text-xs">
                      <div className="text-primary truncate">{item.label}</div>
                      <div className="text-secondary truncate">{item.sectionTitle}</div>
                      {isSuggested && <div className="text-indigo-600 font-medium">Suggested</div>}
                    </div>
                  </button>
                )
              })}
            </div>
            {pickerImages.length === 0 && (
              <p className="text-sm text-secondary py-6 text-center">No images found in notes.</p>
            )}
          </div>
        </div>
      )}

      {/* Image Occlusion Modal */}
      {occlusionModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-surface rounded-xl border border-divider p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto my-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-primary">Image Occlusion</h3>
              <button
                onClick={() => {
                  setOcclusionModalOpen(false)
                  setOcclusionStep('select')
                  setSelectedOcclusionImage(null)
                  setDetectedLabels([])
                }}
                className="text-secondary hover:text-primary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1: Select Image */}
            {occlusionStep === 'select' && (
              <div>
                <p className="text-sm text-secondary mb-4">Select an image to create occlusion cards:</p>
                <div className="grid grid-cols-2 gap-4">
                  {getAllNotesImages().map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedOcclusionImage(item)
                        setOcclusionStep('edit')
                        setDetectedLabels([])
                      }}
                      className="border-2 border-divider hover:border-orange-500 rounded-lg p-3 text-left transition-colors"
                    >
                      <img
                        src={item.image.dataUrl}
                        alt={item.label}
                        className="w-full h-48 object-contain rounded mb-2 bg-gray-50"
                      />
                      <p className="text-xs text-secondary truncate">{item.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Draw Labels */}
            {occlusionStep === 'edit' && selectedOcclusionImage && (
              <div>
                <div className="mb-4">
                  <button
                    onClick={() => {
                      setOcclusionStep('select')
                      setSelectedOcclusionImage(null)
                      setDetectedLabels([])
                    }}
                    className="text-sm text-secondary hover:text-primary flex items-center gap-1"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to image selection
                  </button>
                </div>

                <p className="text-sm text-secondary mb-4">
                  Draw boxes around anatomical structures, then label them:
                </p>

                <div className="grid grid-cols-2 gap-6">
                  {/* Canvas Area */}
                  <div>
                    <div
                      className="relative border-2 border-divider rounded-lg overflow-hidden bg-gray-50"
                      style={{ maxWidth: '100%' }}
                      onMouseDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const x = ((e.clientX - rect.left) / rect.width) * 100
                        const y = ((e.clientY - rect.top) / rect.height) * 100
                        setDrawingOcclusionBox({ x, y, width: 0, height: 0 })
                      }}
                      onMouseMove={(e) => {
                        if (!drawingOcclusionBox) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const currentX = ((e.clientX - rect.left) / rect.width) * 100
                        const currentY = ((e.clientY - rect.top) / rect.height) * 100
                        setDrawingOcclusionBox(prev => ({
                          ...prev,
                          width: currentX - prev.x,
                          height: currentY - prev.y
                        }))
                      }}
                      onMouseUp={() => {
                        if (drawingOcclusionBox && Math.abs(drawingOcclusionBox.width) > 2 && Math.abs(drawingOcclusionBox.height) > 2) {
                          // Normalize negative dimensions
                          const box = {
                            x: drawingOcclusionBox.width < 0 ? drawingOcclusionBox.x + drawingOcclusionBox.width : drawingOcclusionBox.x,
                            y: drawingOcclusionBox.height < 0 ? drawingOcclusionBox.y + drawingOcclusionBox.height : drawingOcclusionBox.y,
                            width: Math.abs(drawingOcclusionBox.width),
                            height: Math.abs(drawingOcclusionBox.height)
                          }
                          setDetectedLabels(prev => [...prev, {
                            id: Date.now(),
                            ...box,
                            text: '',
                            enabled: true
                          }])
                        }
                        setDrawingOcclusionBox(null)
                      }}
                    >
                      <img
                        src={selectedOcclusionImage.image.dataUrl}
                        alt="Selected"
                        className="w-full h-auto"
                        draggable={false}
                      />

                      {/* Render existing labels */}
                      {detectedLabels.map((label) => (
                        <div
                          key={label.id}
                          className="absolute border-2 border-orange-500 bg-orange-500/20"
                          style={{
                            left: `${label.x}%`,
                            top: `${label.y}%`,
                            width: `${label.width}%`,
                            height: `${label.height}%`,
                            cursor: 'move'
                          }}
                        >
                          <div className="absolute -top-6 left-0 bg-orange-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                            {label.text || 'Unlabeled'}
                          </div>
                        </div>
                      ))}

                      {/* Render drawing box */}
                      {drawingOcclusionBox && (
                        <div
                          className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10"
                          style={{
                            left: `${drawingOcclusionBox.width < 0 ? drawingOcclusionBox.x + drawingOcclusionBox.width : drawingOcclusionBox.x}%`,
                            top: `${drawingOcclusionBox.height < 0 ? drawingOcclusionBox.y + drawingOcclusionBox.height : drawingOcclusionBox.y}%`,
                            width: `${Math.abs(drawingOcclusionBox.width)}%`,
                            height: `${Math.abs(drawingOcclusionBox.height)}%`
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Labels List */}
                  <div>
                    <div className="bg-gray-50 rounded-lg p-4 border border-divider">
                      <h4 className="text-sm font-semibold text-primary mb-3">Labels ({detectedLabels.length})</h4>
                      {detectedLabels.length === 0 ? (
                        <p className="text-xs text-secondary text-center py-4">
                          Click and drag on the image to draw boxes
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {detectedLabels.map((label, idx) => (
                            <div key={label.id} className="bg-white rounded border border-divider p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <input
                                  type="checkbox"
                                  checked={label.enabled}
                                  onChange={(e) => {
                                    setDetectedLabels(prev => prev.map(l =>
                                      l.id === label.id ? { ...l, enabled: e.target.checked } : l
                                    ))
                                  }}
                                  className="w-4 h-4"
                                />
                                <span className="text-xs font-medium text-primary">Box {idx + 1}</span>
                                <button
                                  onClick={() => {
                                    setDetectedLabels(prev => prev.filter(l => l.id !== label.id))
                                  }}
                                  className="ml-auto text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                              <input
                                type="text"
                                value={label.text}
                                onChange={(e) => {
                                  setDetectedLabels(prev => prev.map(l =>
                                    l.id === label.id ? { ...l, text: e.target.value } : l
                                  ))
                                }}
                                placeholder="Enter structure name..."
                                className="w-full text-sm border border-divider rounded px-2 py-1"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => setDetectedLabels([])}
                        disabled={detectedLabels.length === 0}
                        className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 text-primary rounded-lg text-sm font-medium transition-colors"
                      >
                        Clear All
                      </button>
                      <button
                        onClick={generateOcclusionCards}
                        disabled={detectedLabels.filter(l => l.enabled && l.text.trim()).length === 0 || occlusionProcessing}
                        className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        {occlusionProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>Generate Cards</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Generating */}
            {occlusionStep === 'generating' && (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 text-orange-600 animate-spin mx-auto mb-4" />
                <p className="text-sm text-secondary">Generating occlusion cards...</p>
              </div>
            )}

            {/* Edit existing occlusion card */}
            {occlusionStep === 'edit-card' && editingOcclusionCard && (
              <div>
                <p className="text-sm text-secondary mb-4">
                  Edit the occlusion box, label, and question:
                </p>

                <div className="grid grid-cols-2 gap-6">
                  {/* Canvas Area */}
                  <div>
                    <div
                      className="relative border-2 border-divider rounded-lg overflow-hidden bg-gray-50"
                      style={{ maxWidth: '100%' }}
                      onMouseDown={(e) => {
                        if (!drawingOcclusionBox) return // Only draw if in drawing mode
                        const rect = e.currentTarget.getBoundingClientRect()
                        const x = ((e.clientX - rect.left) / rect.width) * 100
                        const y = ((e.clientY - rect.top) / rect.height) * 100
                        setDrawingOcclusionBox({ x, y, width: 0, height: 0 })
                      }}
                      onMouseMove={(e) => {
                        if (!drawingOcclusionBox) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const currentX = ((e.clientX - rect.left) / rect.width) * 100
                        const currentY = ((e.clientY - rect.top) / rect.height) * 100
                        setDrawingOcclusionBox(prev => ({
                          ...prev,
                          width: currentX - prev.x,
                          height: currentY - prev.y
                        }))
                      }}
                      onMouseUp={() => {
                        if (drawingOcclusionBox && Math.abs(drawingOcclusionBox.width) > 2 && Math.abs(drawingOcclusionBox.height) > 2) {
                          // Normalize negative dimensions
                          const box = {
                            x: drawingOcclusionBox.width < 0 ? drawingOcclusionBox.x + drawingOcclusionBox.width : drawingOcclusionBox.x,
                            y: drawingOcclusionBox.height < 0 ? drawingOcclusionBox.y + drawingOcclusionBox.height : drawingOcclusionBox.y,
                            width: Math.abs(drawingOcclusionBox.width),
                            height: Math.abs(drawingOcclusionBox.height)
                          }
                          setEditingOcclusionCard(prev => ({
                            ...prev,
                            label: { ...prev.label, ...box }
                          }))
                        }
                        setDrawingOcclusionBox(null)
                      }}
                    >
                      <img
                        src={editingOcclusionCard.originalImage}
                        alt="Editing"
                        className="w-full h-auto"
                        draggable={false}
                      />

                      {/* Show current occlusion box only if not drawing */}
                      {!drawingOcclusionBox && editingOcclusionCard.label.width > 0 && (
                        <div
                          className="absolute border-2 border-orange-500 bg-orange-500/20"
                          style={{
                            left: `${editingOcclusionCard.label.x}%`,
                            top: `${editingOcclusionCard.label.y}%`,
                            width: `${editingOcclusionCard.label.width}%`,
                            height: `${editingOcclusionCard.label.height}%`,
                            cursor: 'move'
                          }}
                        >
                          <div className="absolute -top-6 left-0 bg-orange-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                            {editingOcclusionCard.label.text}
                          </div>
                        </div>
                      )}

                      {/* Show drawing box */}
                      {drawingOcclusionBox && (
                        <div
                          className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10"
                          style={{
                            left: `${drawingOcclusionBox.width < 0 ? drawingOcclusionBox.x + drawingOcclusionBox.width : drawingOcclusionBox.x}%`,
                            top: `${drawingOcclusionBox.height < 0 ? drawingOcclusionBox.y + drawingOcclusionBox.height : drawingOcclusionBox.y}%`,
                            width: `${Math.abs(drawingOcclusionBox.width)}%`,
                            height: `${Math.abs(drawingOcclusionBox.height)}%`
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Edit Controls */}
                  <div>
                    <div className="bg-gray-50 rounded-lg p-4 border border-divider space-y-4">
                      <div>
                        <label className="text-sm font-medium text-primary block mb-2">Label Text</label>
                        <input
                          type="text"
                          value={editingOcclusionCard.label.text}
                          onChange={(e) => {
                            setEditingOcclusionCard(prev => ({
                              ...prev,
                              label: { ...prev.label, text: e.target.value }
                            }))
                          }}
                          className="w-full text-sm border border-divider rounded px-3 py-2"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-primary block mb-2">Question Text</label>
                        <input
                          type="text"
                          value={editingOcclusionCard.questionText}
                          onChange={(e) => {
                            setEditingOcclusionCard(prev => ({
                              ...prev,
                              questionText: e.target.value
                            }))
                          }}
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
                              // Clear current box and enable drawing mode
                              setEditingOcclusionCard(prev => ({
                                ...prev,
                                label: { ...prev.label, x: 0, y: 0, width: 0, height: 0 }
                              }))
                              setDrawingOcclusionBox({})
                            }
                          }}
                          className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            drawingOcclusionBox
                              ? 'bg-red-600 hover:bg-red-700 text-white'
                              : 'bg-orange-600 hover:bg-orange-700 text-white'
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
                          {editingOcclusionCard.contentTags?.map((tag, tagIdx) => (
                            <span
                              key={`${tag}-${tagIdx}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full"
                            >
                              {tag}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingOcclusionCard((prev) => ({
                                    ...prev,
                                    contentTags: prev.contentTags.filter((_, i) => i !== tagIdx)
                                  }))
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
                                if (!editingOcclusionCard.contentTags?.includes(newTag)) {
                                  setEditingOcclusionCard((prev) => ({
                                    ...prev,
                                    contentTags: [...(prev.contentTags || []), newTag]
                                  }))
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

                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => {
                          setEditingOcclusionCard(null)
                          setOcclusionModalOpen(false)
                          setDrawingOcclusionBox(null)
                        }}
                        className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary rounded-lg text-sm font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveOcclusionCardEdit}
                        disabled={drawingOcclusionBox !== null}
                        className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interpretation Cards Modal */}
      {interpretationModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-divider px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-primary">Create Interpretation Card</h2>
              <button
                onClick={() => {
                  setInterpretationModalOpen(false)
                  setInterpretationStep('select')
                  setSelectedInterpretationImage(null)
                  setInterpretationCard(null)
                }}
                className="text-secondary hover:text-primary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {interpretationStep === 'select' && (
                <div>
                  <p className="text-sm text-secondary mb-4">
                    Select an image to generate an interpretation question and answer.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {getAllNotesImages().map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setSelectedInterpretationImage(img)
                          generateInterpretationCard(img)
                        }}
                        className="border-2 border-divider hover:border-teal-500 rounded-lg p-3 transition-colors"
                      >
                        <img
                          src={img.image.dataUrl}
                          alt={img.label}
                          className="w-full h-auto rounded"
                        />
                        <p className="text-xs text-secondary mt-2">{img.label}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {interpretationStep === 'generating' && (
                <div className="text-center py-12">
                  <Loader2 className="w-12 h-12 text-teal-600 animate-spin mx-auto mb-4" />
                  <p className="text-primary font-medium">Generating interpretation...</p>
                  <p className="text-sm text-secondary mt-2">AI is analyzing the image</p>
                </div>
              )}

              {interpretationStep === 'confirm' && interpretationCard && (
                <div>
                  <p className="text-sm text-secondary mb-4">
                    Review and edit the generated interpretation card before adding it to your deck.
                  </p>

                  <div className="space-y-4">
                    {/* Image */}
                    <div>
                      <label className="text-sm font-medium text-primary block mb-2">Image</label>
                      <img
                        src={interpretationCard.imageDataUrl}
                        alt="Interpretation"
                        className="max-w-md rounded-lg border border-divider"
                      />
                    </div>

                    {/* Question */}
                    <div>
                      <label className="text-sm font-medium text-primary block mb-2">Question</label>
                      <input
                        type="text"
                        value={interpretationCard.question}
                        onChange={(e) => setInterpretationCard(prev => ({ ...prev, question: e.target.value }))}
                        className="w-full text-sm border border-divider rounded-lg px-3 py-2"
                      />
                    </div>

                    {/* Answer */}
                    <div>
                      <label className="text-sm font-medium text-primary block mb-2">Answer</label>
                      <textarea
                        value={interpretationCard.answer.replace(/<b>/g, '').replace(/<\/b>/g, '').replace(/<br>/g, '\n').replace(/<br\/>/g, '\n').replace(/<br \/>/g, '\n')}
                        onChange={(e) => {
                          // Convert plain text back to HTML format
                          const plainText = e.target.value
                          const lines = plainText.split('\n')
                          let htmlAnswer = ''

                          if (lines.length > 0) {
                            // First line is the diagnosis (bold)
                            htmlAnswer = `<b>${lines[0]}</b>`

                            // Add remaining lines with line breaks
                            if (lines.length > 1) {
                              htmlAnswer += '<br><br>' + lines.slice(1).join('<br>')
                            }
                          }

                          setInterpretationCard(prev => ({ ...prev, answer: htmlAnswer }))
                        }}
                        className="w-full text-sm border border-divider rounded-lg px-3 py-2"
                        rows={6}
                      />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-4">
                      <button
                        onClick={() => {
                          setInterpretationModalOpen(false)
                          setInterpretationStep('select')
                          setSelectedInterpretationImage(null)
                          setInterpretationCard(null)
                        }}
                        className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary rounded-lg text-sm font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={addInterpretationCard}
                        className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Add Card
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

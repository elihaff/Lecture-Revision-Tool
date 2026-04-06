import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowLeft, BookOpen, Circle, Copy, Check, FileText, Trash2, GripVertical, Edit2, Plus, Save, X, Upload, Loader2, Download, FileUp, Image, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, closestCenter, pointerWithin, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, rectSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabase'
import { ImagePickerModal } from './ImagePickerModal'
import { CropModal } from './CropModal'
import { useToast } from './Toast'

let pdfjsLibPromise = null
let pdfMakePromise = null

async function getPdfJsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjsModule, workerModule]) => {
      const lib = pdfjsModule?.default || pdfjsModule
      const workerUrl = workerModule?.default || workerModule
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })
  }
  return pdfjsLibPromise
}

async function getPdfMake() {
  if (!pdfMakePromise) {
    pdfMakePromise = Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]).then(([pdfMakeModule, fontsModule]) => {
      const pdfMake = pdfMakeModule?.default || pdfMakeModule
      const pdfFonts = fontsModule?.default || fontsModule
      pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs
      if (typeof pdfMake.addVirtualFileSystem === 'function') {
        pdfMake.addVirtualFileSystem(pdfMake.vfs || {})
      }
      return pdfMake
    })
  }
  return pdfMakePromise
}

let unicodeFontInitPromise = null

function hasFontFiles(fontDef, vfsMap) {
  if (!fontDef || !vfsMap) return false
  const normalFile = fontDef.normal
  const boldFile = fontDef.bold
  return !!(normalFile && boldFile && vfsMap[normalFile] && vfsMap[boldFile])
}

function hasUnicodePdfFont(pdfMake) {
  return hasFontFiles(pdfMake.fonts?.NotoSans, pdfMake.vfs)
}

function normalizeUnicodePdfFont(pdfMake) {
  const noto = pdfMake.fonts?.NotoSans
  if (!noto) return false

  const normalFile = noto.normal
  const boldFile = noto.bold
  if (!normalFile || !pdfMake.vfs?.[normalFile]) return false

  if (!boldFile || !pdfMake.vfs?.[boldFile]) {
    // Some generated font bundles only include the regular face.
    // Reuse regular so bold text renders instead of throwing.
    pdfMake.fonts.NotoSans = {
      ...noto,
      bold: normalFile,
      italics: noto.italics || normalFile,
      bolditalics: noto.bolditalics && pdfMake.vfs?.[noto.bolditalics] ? noto.bolditalics : normalFile
    }
  }

  return hasUnicodePdfFont(pdfMake)
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function loadDirectUnicodeFontVfs() {
  const regularUrl = '/DejaVuSans-Regular.ttf'
  const boldUrl = '/DejaVuSans-Bold.ttf'

  const [regularResp, boldResp] = await Promise.all([fetch(regularUrl), fetch(boldUrl)])
  if (!regularResp.ok || !boldResp.ok) {
    throw new Error(`Direct TTF fetch failed (${regularResp.status}, ${boldResp.status})`)
  }

  const [regularBuffer, boldBuffer] = await Promise.all([regularResp.arrayBuffer(), boldResp.arrayBuffer()])
  return {
    'DejaVuSans-Regular.ttf': arrayBufferToBase64(regularBuffer),
    'DejaVuSans-Bold.ttf': arrayBufferToBase64(boldBuffer)
  }
}

async function probePdfFont(fontName, pdfMake) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    const timeoutId = setTimeout(() => done(false), 8000)

    try {
      const doc = pdfMake.createPdf({
        defaultStyle: { font: fontName, fontSize: 10 },
        content: [{ text: 'Probe → Bold', bold: true }]
      })

      doc.getBuffer(() => {
        clearTimeout(timeoutId)
        done(true)
      })
    } catch (error) {
      clearTimeout(timeoutId)
      // PDF font probe failed - non-critical
      done(false)
    }
  })
}

async function ensureUnicodePdfFont() {
  const pdfMake = await getPdfMake()
  if (normalizeUnicodePdfFont(pdfMake)) return true

  if (!unicodeFontInitPromise) {
    unicodeFontInitPromise = (async () => {
      const baseFonts = { ...(pdfMake.fonts || {}) }
      let unicodeVfs = null

      // Preferred path: direct TTF fetch + explicit registration.
      try {
        unicodeVfs = await loadDirectUnicodeFontVfs()
      } catch (directError) {
        // Unicode TTF load failed, using fallback
      }

      let tempPdfMake = null
      if (unicodeVfs) {
        tempPdfMake = {
          fonts: {
            ...baseFonts,
            NotoSans: {
              normal: 'DejaVuSans-Regular.ttf',
              bold: 'DejaVuSans-Bold.ttf',
              italics: 'DejaVuSans-Regular.ttf',
              bolditalics: 'DejaVuSans-Bold.ttf'
            }
          },
          vfs: unicodeVfs
        }
      } else {
        const response = await fetch('/custom-fonts.js')
        if (!response.ok) {
          throw new Error(`Failed to load custom-fonts.js (${response.status})`)
        }

        const script = await response.text()
        // Execute the generated font script with the module pdfMake instance.
        // custom-fonts.js assigns pdfMake.fonts and injects DejaVu ttf files into pdfMake.vfs.
        // eslint-disable-next-line no-new-func
        const applyFonts = new Function('pdfMake', `${script}\nreturn pdfMake;`)

        tempPdfMake = {
          fonts: {},
          vfs: {}
        }
        applyFonts(tempPdfMake)
        tempPdfMake.fonts = {
          ...baseFonts,
          ...(tempPdfMake.fonts || {})
        }
      }

      const tempNormal = tempPdfMake.fonts?.NotoSans?.normal
      if (
        tempNormal &&
        tempPdfMake.vfs?.[tempNormal] &&
        (!tempPdfMake.fonts?.NotoSans?.bold || !tempPdfMake.vfs?.[tempPdfMake.fonts.NotoSans.bold])
      ) {
        tempPdfMake.fonts.NotoSans = {
          ...tempPdfMake.fonts.NotoSans,
          bold: tempNormal,
          italics: tempPdfMake.fonts.NotoSans.italics || tempNormal,
          bolditalics: tempPdfMake.fonts.NotoSans.bolditalics && tempPdfMake.vfs?.[tempPdfMake.fonts.NotoSans.bolditalics]
            ? tempPdfMake.fonts.NotoSans.bolditalics
            : tempNormal
        }
      }

      const tempHasUnicodeFont = hasFontFiles(tempPdfMake.fonts?.NotoSans, tempPdfMake.vfs)
      if (!tempHasUnicodeFont) {
        throw new Error('Unicode font registration incomplete')
      }

      // Register custom VFS/fonts through pdfmake APIs used by the renderer.
      if (typeof pdfMake.addVirtualFileSystem === 'function') {
        pdfMake.addVirtualFileSystem(tempPdfMake.vfs)
      }
      pdfMake.vfs = {
        ...(pdfMake.vfs || {}),
        ...(tempPdfMake.vfs || {})
      }
      pdfMake.fonts = tempPdfMake.fonts

      if (typeof pdfMake.addFonts === 'function') {
        pdfMake.addFonts(pdfMake.fonts)
      }

      if (!normalizeUnicodePdfFont(pdfMake)) {
        throw new Error('Unicode font verification failed after registration')
      }

      const canRenderUnicodeFont = await probePdfFont('NotoSans', pdfMake)
      if (!canRenderUnicodeFont) {
        throw new Error('Unicode font probe failed after registration')
      }

      return true
    })().catch((error) => {
      unicodeFontInitPromise = null
      throw error
    })
  }

  return unicodeFontInitPromise
}

// Convert markdown-like syntax and symbols to HTML
function markdownToHTML(text) {
  if (!text) return ''
  return String(text)
    .replace(/\buparrow\b/gi, '↑')
    .replace(/\bdownarrow\b/gi, '↓')
    .replace(/<=>/g, '⇔')
    .replace(/<->/g, '↔')
    .replace(/=>/g, '⇒')
    .replace(/<=/g, '⇐')
    .replace(/->/g, '→')
    .replace(/<-/g, '←')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\^([^^]+)\^/g, '<sup>$1</sup>')
    .replace(/~([^~]+)~/g, '<sub>$1</sub>')
}

function clampPointLevels(levels, pointsLength) {
  const normalized = Array.from({ length: pointsLength }, (_, idx) => {
    const raw = Number(levels?.[idx] ?? 0)
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
  })
  for (let i = 1; i < normalized.length; i++) {
    normalized[i] = Math.min(normalized[i], normalized[i - 1] + 1)
  }
  return normalized
}

function inferFallbackPointLevels(points) {
  const levels = Array(points.length).fill(0)
  let activeParentIndex = null

  const isHeaderLike = (text) => {
    const clean = String(text || '').trim()
    if (!clean) return false
    if (clean.endsWith(':')) return true
    const words = clean.split(/\s+/).filter(Boolean)
    return words.length <= 6 && !/[.!?]$/.test(clean) && !clean.includes('→')
  }

  for (let i = 0; i < points.length; i++) {
    const current = String(points[i] || '').trim()
    if (!current) continue

    if (isHeaderLike(current)) {
      levels[i] = 0
      activeParentIndex = i
      continue
    }

    if (activeParentIndex !== null) {
      const prev = String(points[i - 1] || '').trim()
      const prevWasHeader = i - 1 === activeParentIndex || isHeaderLike(prev)
      if (prevWasHeader || levels[i - 1] > 0) {
        levels[i] = 1
        continue
      }
    }

    levels[i] = 0
    activeParentIndex = null
  }

  return levels
}

function normalizeNotesForDisplay(incomingNotes, fallbackTitle = 'Untitled') {
  const safeNotes = incomingNotes || { title: fallbackTitle, notes: [] }
  const isAiFlatPolicy = safeNotes?._ai_nesting_policy === 'flat'
  const allowLegacyInference = safeNotes?._allow_inferred_nesting === true
  return {
    ...safeNotes,
    notes: (safeNotes.notes || []).map((section) => {
      const points = Array.isArray(section?.points) ? section.points : []
      const supplied = clampPointLevels(section?.pointLevels, points.length)

      const hasAnySuppliedNesting = supplied.some((lvl) => lvl > 0)
      // Default behavior: trust stored levels and keep flat if no nesting is provided.
      // Optional heuristic inference is explicitly opt-in for legacy data only.
      const pointLevels = (allowLegacyInference && !isAiFlatPolicy && !hasAnySuppliedNesting)
        ? clampPointLevels(inferFallbackPointLevels(points), points.length)
        : supplied

      return {
        ...section,
        points,
        pointLevels
      }
    })
  }
}

// Copy notes to clipboard as formatted text
function notesToClipboardText(notes, learningObjectives) {
  if (!notes) return ''
  let text = ''
  if (notes.title) {
    text += `${notes.title}\n${'='.repeat(notes.title.length)}\n\n`
  }
  if (learningObjectives?.length > 0) {
    text += 'Learning Objectives:\n'
    learningObjectives.forEach((lo, i) => {
      const loText = typeof lo === 'string' ? lo : lo.text
      text += `${i + 1}. ${loText}\n`
    })
    text += '\n'
  }
  if (notes.notes?.length > 0) {
    notes.notes.forEach(section => {
      text += `${section.section}\n${'-'.repeat(section.section.length)}\n`
      section.points?.forEach(point => {
        const cleanPoint = point.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
        text += `• ${cleanPoint}\n`
      })
      text += '\n'
    })
  }
  return text
}

function buildPointHtmlWithFigureRefs(point, figNums = [], level = 0) {
  const bulletPrefix = level > 0 ? '-' : '•'
  const base = /<(ul|ol|li)\b/i.test(point || '') || String(point || '').trimStart().startsWith('•') || String(point || '').trimStart().startsWith('-')
    ? markdownToHTML(point)
    : `${bulletPrefix} ${markdownToHTML(point)}`

  const cleanFigNums = Array.isArray(figNums) ? figNums.filter((n) => Number.isFinite(Number(n))) : []
  if (cleanFigNums.length === 0) return base
  const suffix = cleanFigNums.map((n) => `(Fig ${n})`).join(', ')
  return `${base}<span class="text-indigo-500 text-xs font-medium"> ${suffix}</span>`
}

function normalizePointImageEntry(entry) {
  if (!entry) return []
  if (Array.isArray(entry)) {
    return entry.filter((item) => item && (item.dataUrl || item.storagePath))
  }
  return (entry.dataUrl || entry.storagePath) ? [entry] : []
}

function normalizePointImagesMap(rawMap) {
  const normalized = {}
  Object.entries(rawMap || {}).forEach(([key, value]) => {
    const images = normalizePointImageEntry(value)
    if (images.length === 1) {
      normalized[key] = images[0]
    } else if (images.length > 1) {
      normalized[key] = images
    }
  })
  return normalized
}

function normalizeSectionImageEntry(entry) {
  return normalizePointImageEntry(entry)
}

function normalizeSectionImagesMap(rawMap) {
  const normalized = {}
  Object.entries(rawMap || {}).forEach(([key, value]) => {
    const images = normalizeSectionImageEntry(value)
    if (images.length === 1) {
      normalized[key] = images[0]
    } else if (images.length > 1) {
      normalized[key] = images
    }
  })
  return normalized
}

function isSectionTitleReferenceTargetKey(key) {
  return String(key || '').startsWith('section-title-')
}

function normalizeReferenceKeyList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
  }
  const single = String(value || '').trim()
  return single ? [single] : []
}

function normalizeImageReferencesMap(rawMap) {
  const normalized = {}
  Object.entries(rawMap || {}).forEach(([targetKey, sourceValue]) => {
    const refs = normalizeReferenceKeyList(sourceValue)
    if (refs.length === 0) return
    normalized[targetKey] = isSectionTitleReferenceTargetKey(targetKey) ? refs : refs[0]
  })
  return normalized
}

const NOTES_IMAGE_BUCKET = 'lecture-pdfs'

const IMAGE_LAYOUT_DEFAULT = 'm'
const IMAGE_LAYOUT_SCALES = { s: 0.85, m: 1, l: 1.2 }

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getImageAspectRatio(image) {
  const w = Number(image?.width) || 1
  const h = Number(image?.height) || 1
  return w / Math.max(h, 1)
}

function normalizeSectionLayoutForFigures(figures, sectionLayout) {
  const safeLayout = sectionLayout || {}
  const figureKeys = new Set(figures.map((f) => f.key))

  const ordered = []
  ;(safeLayout.order || []).forEach((key) => {
    if (figureKeys.has(key)) ordered.push(key)
  })
  figures.forEach((fig) => {
    if (!ordered.includes(fig.key)) ordered.push(fig.key)
  })

  const sizes = {}
  Object.entries(safeLayout.sizes || {}).forEach(([key, value]) => {
    if (figureKeys.has(key) && IMAGE_LAYOUT_SCALES[value]) sizes[key] = value
  })

  const solo = {}
  Object.entries(safeLayout.solo || {}).forEach(([key, value]) => {
    if (figureKeys.has(key) && !!value) solo[key] = true
  })

  return { order: ordered, sizes, solo }
}

function computeFigureRows(figures, sectionLayout, options = {}) {
  const {
    maxRowWidth = 500,
    columnGap = 12,
    maxItemsPerRow = 4,
    minRowHeight = 90,
    maxRowHeight = 205,
    targetRowHeight = 128,
    singletonMinHeight = 120,
    singletonMaxHeight = 175,
    singletonTargetHeight = 145,
    autoSoloAspect = 3.8
  } = options

  const normalizedLayout = normalizeSectionLayoutForFigures(figures, sectionLayout)
  const byKey = new Map(figures.map((f) => [f.key, f]))
  const orderedFigures = normalizedLayout.order.map((key) => byKey.get(key)).filter(Boolean)
  const rows = []

  const isForcedSolo = (fig) => {
    if (normalizedLayout.solo?.[fig.key]) return true
    return getImageAspectRatio(fig.image) >= autoSoloAspect
  }

  for (let i = 0; i < orderedFigures.length;) {
    const first = orderedFigures[i]
    if (!first) break

    if (isForcedSolo(first)) {
      const sizeScale = IMAGE_LAYOUT_SCALES[normalizedLayout.sizes?.[first.key] || IMAGE_LAYOUT_DEFAULT] || 1
      const aspect = getImageAspectRatio(first.image)
      const baseHeight = clamp(maxRowWidth / (aspect * sizeScale), singletonMinHeight, singletonMaxHeight)
      const width = baseHeight * aspect * sizeScale
      const shrink = width > maxRowWidth ? maxRowWidth / width : 1
      rows.push({
        items: [{ fig: first, width: width * shrink, height: baseHeight * shrink }],
        forcedSolo: true
      })
      i += 1
      continue
    }

    const contiguous = []
    for (let j = i; j < orderedFigures.length; j++) {
      const next = orderedFigures[j]
      if (!next || isForcedSolo(next)) break
      contiguous.push(next)
      if (contiguous.length >= maxItemsPerRow) break
    }

    const candidateMax = Math.max(1, Math.min(maxItemsPerRow, contiguous.length))
    let best = null

    for (let count = 1; count <= candidateMax; count++) {
      const rowItems = contiguous.slice(0, count)
      const effectiveAspectSum = rowItems.reduce((sum, fig) => {
        const sizeScale = IMAGE_LAYOUT_SCALES[normalizedLayout.sizes?.[fig.key] || IMAGE_LAYOUT_DEFAULT] || 1
        return sum + (getImageAspectRatio(fig.image) * sizeScale)
      }, 0)
      if (!effectiveAspectSum) continue

      const rawHeight = (maxRowWidth - columnGap * (count - 1)) / effectiveAspectSum
      const clampedHeight = count === 1
        ? clamp(rawHeight, singletonMinHeight, singletonMaxHeight)
        : clamp(rawHeight, minRowHeight, maxRowHeight)

      let score = Math.abs(clampedHeight - (count === 1 ? singletonTargetHeight : targetRowHeight))
      if (rawHeight < minRowHeight) score += (minRowHeight - rawHeight) * 0.5
      if (rawHeight > maxRowHeight) score += (rawHeight - maxRowHeight) * 0.25
      score += count === 1 ? 8 : 0
      score -= count * 3

      if (count === 2) {
        const a1 = getImageAspectRatio(rowItems[0].image)
        const a2 = getImageAspectRatio(rowItems[1].image)
        const complementaryPair = (a1 < 1.0 && a2 > 1.15) || (a2 < 1.0 && a1 > 1.15)
        if (complementaryPair) score -= 14
        if (orderedFigures.length - i === 2) score -= 6
      }

      if (!best || score < best.score) {
        best = { count, rowItems, height: clampedHeight, score }
      }
    }

    if (!best) {
      i += 1
      continue
    }

    let prepared = best.rowItems.map((fig) => {
      const sizeScale = IMAGE_LAYOUT_SCALES[normalizedLayout.sizes?.[fig.key] || IMAGE_LAYOUT_DEFAULT] || 1
      const height = best.height * sizeScale
      const width = height * getImageAspectRatio(fig.image)
      return { fig, width, height }
    })

    const totalWidth = prepared.reduce((sum, item) => sum + item.width, 0) + columnGap * (prepared.length - 1)
    if (totalWidth > maxRowWidth) {
      const shrink = (maxRowWidth - columnGap * (prepared.length - 1)) / Math.max(1, prepared.reduce((sum, item) => sum + item.width, 0))
      prepared = prepared.map((item) => ({
        ...item,
        width: item.width * shrink,
        height: item.height * shrink
      }))
    }

    rows.push({ items: prepared, forcedSolo: prepared.length === 1 })
    i += best.count
  }

  return { rows, layout: normalizedLayout }
}

function SortableFigureCard({ id, className, children, sectionIndex, draggingEnabled = true }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggingEnabled,
    data: { kind: 'section-figure', sectionIndex }
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : 'auto',
    opacity: isDragging ? 0.6 : 1
  }

  return (
    <div ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {children}
    </div>
  )
}

function PointImageLinkDropTarget({ id, enabled = false }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: !enabled,
    data: { kind: 'point-image-link-target' }
  })

  if (!enabled) return null

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-0 rounded-lg pointer-events-none transition-colors ${
        isOver ? 'bg-green-100/50 ring-2 ring-green-500' : 'bg-transparent'
      }`}
      aria-hidden="true"
    />
  )
}

function SectionTitleDropTarget({ id, enabled = false }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: !enabled,
    data: { kind: 'section-title-image-link-target' }
  })

  if (!enabled) return null

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-0 rounded-lg pointer-events-none transition-colors ${
        isOver ? 'bg-indigo-100/50 ring-2 ring-indigo-500' : 'bg-transparent'
      }`}
      aria-hidden="true"
    />
  )
}

export function NotesView({ lecture, module, onBack, onOpenFlashcards }) {
  const toast = useToast()
  // Local state for editing
  const [notes, setNotes] = useState(lecture.notes || { title: lecture.title, notes: [] })
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('saved') // 'saved' | 'saving' | 'error'
  const [copied, setCopied] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  // Editing state
  const [editingNote, setEditingNote] = useState(null)
  const [convertingLegacy, setConvertingLegacy] = useState(false)
  const [uploadingSlides, setUploadingSlides] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [flashcards, setFlashcards] = useState(lecture.notes?._flashcards || [])
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false)
  const [showAddCard, setShowAddCard] = useState(false)
  const [newCard, setNewCard] = useState({ front: '', back: '' })
  const [activeFormatting, setActiveFormatting] = useState({ superscript: false, subscript: false })
  const [unicodeFontReady, setUnicodeFontReady] = useState(false)
  const textareaRef = useRef(null)
  const isFormattingRef = useRef(false) // Flag to prevent ref callback interference during formatting
  const importInputRef = useRef(null)
  const legacyImportInputRef = useRef(null)
  const csvImportInputRef = useRef(null)
  const cachedPdfRef = useRef(null) // Cache PDF document to avoid re-downloading
  const saveInFlightRef = useRef(false)
  const pendingSavePayloadRef = useRef(null)
  const saveWaitersRef = useRef([])
  const exitingRef = useRef(false)
  const isMountedRef = useRef(true)
  const saveDebounceTimerRef = useRef(null)
  const lastDebouncedPayloadRef = useRef(null)
  const signedUrlCacheRef = useRef(new Map())
  const exportImageDataUrlCacheRef = useRef(new Map())
  const slideThumbnailCacheRef = useRef(new Map())

  // Drag and drop state
  const [draggedPoint, setDraggedPoint] = useState(null)
  const [draggedSection, setDraggedSection] = useState(null)
  const [dropTargetPoint, setDropTargetPoint] = useState(null)
  const [dropTargetSection, setDropTargetSection] = useState(null)
  const [draggedFigureKey, setDraggedFigureKey] = useState(null)

  // Image insertion state
  const [pdfThumbnails, setPdfThumbnails] = useState([])
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false)
  const [thumbnailsError, setThumbnailsError] = useState('')
  const [pointImages, setPointImages] = useState({})
  const [sectionImages, setSectionImages] = useState({})
  const [imageReferences, setImageReferences] = useState({})
  const [imageLayout, setImageLayout] = useState({})
  const [openLayoutControlsKey, setOpenLayoutControlsKey] = useState(null)
  const [imagePickerOpen, setImagePickerOpen] = useState(null) // {sectionIndex, pointIndex} or {sectionIndex} for section images
  const [cropModalOpen, setCropModalOpen] = useState(null) // {pageNum, dataUrl, width, height, targetKey, targetType, sectionIndex, pointIndex, initialAnnotations, initialCropArea}
  const [loadingHighRes, setLoadingHighRes] = useState(false) // Loading state for high-res image fetch

  const learningObjectives = lecture.learning_objectives || []
  const sections = notes.notes || []
  const hasSlidesSource = Boolean(lecture?.pdf_path) || pdfThumbnails.length > 0 || pdfPageCount > 0
  const hasInsertedImages = Object.keys(pointImages).length > 0 || Object.keys(sectionImages).length > 0
  const canInsertFromSlides = hasSlidesSource || hasInsertedImages

  const getImageInsertionUnavailableReason = () => {
    if (thumbnailsLoading || uploadingSlides) return 'Slides are still loading. Please wait a moment and try again.'
    if (thumbnailsError) return `${thumbnailsError} Upload slides PDF to enable image insertion.`
    if (!lecture?.pdf_path) return 'No slides PDF is linked to this lecture yet. Upload slides PDF to enable image insertion.'
    return 'Slides are not available for this lecture yet. Upload slides PDF to enable image insertion.'
  }

  const isIOSLikeDevice = () => {
    if (typeof navigator === 'undefined') return false
    const ua = String(navigator.userAgent || '')
    const platform = String(navigator.platform || '')
    const maxTouchPoints = Number(navigator.maxTouchPoints || 0)
    return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)
  }

  const buildPdfThumbnails = async (arrayBuffer) => {
    const pdfjsLib = await getPdfJsLib()
    const mobileMode = isIOSLikeDevice()
    const thumbnailScale = mobileMode ? 0.16 : 0.3
    const maxThumbnailPages = mobileMode ? 8 : 120

    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      useSystemFonts: true,
      isEvalSupported: false,
    })
    const pdf = await loadingTask.promise
    cachedPdfRef.current = pdf

    const targetPages = Math.min(pdf.numPages, maxThumbnailPages)
    const thumbnails = []
    let failedPages = 0

    for (let pageNum = 1; pageNum <= targetPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum)
        const pageText = mobileMode
          ? ''
          : (await page.getTextContent()).items.map((item) => item.str).join(' ').toLowerCase()

        const viewport = page.getViewport({ scale: thumbnailScale })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          failedPages += 1
          continue
        }

        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise

        thumbnails.push({
          pageNum,
          dataUrl: canvas.toDataURL('image/jpeg', 0.65),
          text: pageText,
          width: viewport.width,
          height: viewport.height
        })
        slideThumbnailCacheRef.current.set(pageNum, thumbnails[thumbnails.length - 1])

        page.cleanup?.()
      } catch {
        failedPages += 1
      }

      // Yield between pages to reduce memory pressure on Safari/iPad.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    return {
      thumbnails,
      totalPages: pdf.numPages,
      renderedPages: targetPages,
      failedPages,
      truncated: pdf.numPages > targetPages,
    }
  }

  const ensurePdfDocumentLoaded = useCallback(async () => {
    if (cachedPdfRef.current) return cachedPdfRef.current
    if (!lecture?.pdf_path) return null

    const { data: pdfBlob, error } = await supabase.storage
      .from('lecture-pdfs')
      .download(lecture.pdf_path)
    if (error || !pdfBlob) return null

    const arrayBuffer = await pdfBlob.arrayBuffer()
    const pdfjsLib = await getPdfJsLib()
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise
    cachedPdfRef.current = pdf
    if (!pdfPageCount && Number.isFinite(pdf.numPages)) {
      setPdfPageCount(pdf.numPages)
    }
    return pdf
  }, [lecture?.pdf_path, pdfPageCount])

  const loadSlideThumbnailByPage = useCallback(async (pageNum) => {
    const safePageNum = Number(pageNum)
    if (!Number.isFinite(safePageNum) || safePageNum < 1) return null
    const cached = slideThumbnailCacheRef.current.get(safePageNum)
    if (cached) return cached

    const pdf = await ensurePdfDocumentLoaded()
    if (!pdf || safePageNum > pdf.numPages) return null

    const mobileMode = isIOSLikeDevice()
    const thumbnailScale = mobileMode ? 0.16 : 0.3

    const page = await pdf.getPage(safePageNum)
    const pageText = mobileMode
      ? ''
      : (await page.getTextContent()).items.map((item) => item.str).join(' ').toLowerCase()

    const viewport = page.getViewport({ scale: thumbnailScale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise

    const thumb = {
      pageNum: safePageNum,
      dataUrl: canvas.toDataURL('image/jpeg', 0.65),
      text: pageText,
      width: viewport.width,
      height: viewport.height,
    }
    slideThumbnailCacheRef.current.set(safePageNum, thumb)
    page.cleanup?.()
    return thumb
  }, [ensurePdfDocumentLoaded])

  const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl)
    return await response.blob()
  }

  const uploadImageDataUrl = async (dataUrl, kind = 'image') => {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData?.user?.id || 'anonymous'
    const ext = dataUrl.includes('image/png') ? 'png' : 'jpg'
    const path = `${userId}/${lecture.id}/notes-assets/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
    const blob = await dataUrlToBlob(dataUrl)
    const { error } = await supabase.storage
      .from(NOTES_IMAGE_BUCKET)
      .upload(path, blob, { upsert: false, contentType: blob.type || `image/${ext}` })
    if (error) throw error
    return path
  }

  const ensureImagePersisted = async (image, kindPrefix = 'point') => {
    if (!image || typeof image !== 'object') return image
    const next = { ...image }

    if (typeof next.dataUrl === 'string' && next.dataUrl.startsWith('data:image/')) {
      next.storagePath = await uploadImageDataUrl(next.dataUrl, `${kindPrefix}-cropped`)
      delete next.dataUrl
    } else if (next.storagePath) {
      delete next.dataUrl
    }

    if (typeof next.originalDataUrl === 'string' && next.originalDataUrl.startsWith('data:image/')) {
      next.originalStoragePath = await uploadImageDataUrl(next.originalDataUrl, `${kindPrefix}-original`)
      delete next.originalDataUrl
    } else if (next.originalStoragePath) {
      delete next.originalDataUrl
    }

    return next
  }

  const ensureImageEntryPersisted = async (entry, kindPrefix = 'point') => {
    const normalized = normalizePointImageEntry(entry)
    if (normalized.length === 0) return null
    const persisted = []
    for (let i = 0; i < normalized.length; i++) {
      persisted.push(await ensureImagePersisted(normalized[i], `${kindPrefix}-${i}`))
    }
    return persisted.length === 1 ? persisted[0] : persisted
  }

  const prepareNotesPayloadForPersist = async (payload) => {
    const next = { ...payload }
    const rawPointImages = next._pointImages || {}
    const rawSectionImages = next._sectionImages || {}

    const persistedPointImages = {}
    for (const [key, value] of Object.entries(rawPointImages)) {
      const persisted = await ensureImageEntryPersisted(value, `point-${key}`)
      if (persisted) persistedPointImages[key] = persisted
    }

    const persistedSectionImages = {}
    for (const [key, value] of Object.entries(rawSectionImages)) {
      const persisted = await ensureImageEntryPersisted(value, `section-${key}`)
      if (persisted) persistedSectionImages[key] = persisted
    }

    next._pointImages = Object.keys(persistedPointImages).length > 0 ? persistedPointImages : undefined
    next._sectionImages = Object.keys(persistedSectionImages).length > 0 ? persistedSectionImages : undefined
    return next
  }

  const getSignedUrlsMap = async (paths) => {
    const now = Date.now()
    const uniquePaths = [...new Set((paths || []).filter(Boolean))]
    const urlsMap = {}
    const missingPaths = []

    uniquePaths.forEach((path) => {
      const cached = signedUrlCacheRef.current.get(path)
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
          signedUrlCacheRef.current.set(row.path, {
            url: row.signedUrl,
            expiresAt: now + (1000 * 60 * 60 * 24 * 6) // refresh before 7-day expiry
          })
        })
      }
    }

    return urlsMap
  }

  const hydrateImageForDisplay = (image, signedUrlsMap = {}) => {
    if (!image || typeof image !== 'object') return image
    const next = { ...image }

    if (!next.dataUrl && next.storagePath) {
      const signedUrl = signedUrlsMap[next.storagePath]
      if (signedUrl) next.dataUrl = signedUrl
    }
    if (!next.originalDataUrl && next.originalStoragePath) {
      const signedOriginalUrl = signedUrlsMap[next.originalStoragePath]
      if (signedOriginalUrl) next.originalDataUrl = signedOriginalUrl
    }
    return next
  }

  const hydrateImageEntryForDisplay = (entry, signedUrlsMap = {}) => {
    const normalized = normalizePointImageEntry(entry)
    if (normalized.length === 0) return null
    const hydrated = normalized.map((img) => hydrateImageForDisplay(img, signedUrlsMap))
    return hydrated.length === 1 ? hydrated[0] : hydrated
  }

  const hydrateImageMapsForDisplay = async (rawPointImages, rawSectionImages) => {
    const paths = []
    Object.values(rawPointImages || {}).forEach((entry) => {
      const normalized = normalizePointImageEntry(entry)
      normalized.forEach((img) => {
        if (img?.storagePath) paths.push(img.storagePath)
        if (img?.originalStoragePath) paths.push(img.originalStoragePath)
      })
    })
    Object.values(rawSectionImages || {}).forEach((img) => {
      const normalized = normalizeSectionImageEntry(img)
      normalized.forEach((sectionImg) => {
        if (sectionImg?.storagePath) paths.push(sectionImg.storagePath)
        if (sectionImg?.originalStoragePath) paths.push(sectionImg.originalStoragePath)
      })
    })
    const signedUrlsMap = await getSignedUrlsMap(paths)

    const point = {}
    for (const [key, value] of Object.entries(rawPointImages || {})) {
      const hydrated = hydrateImageEntryForDisplay(value, signedUrlsMap)
      if (hydrated) point[key] = hydrated
    }
    const section = {}
    for (const [key, value] of Object.entries(rawSectionImages || {})) {
      const hydrated = hydrateImageEntryForDisplay(value, signedUrlsMap)
      if (hydrated) section[key] = hydrated
    }
    return { point, section }
  }

  const openImagePickerOrExplain = (target) => {
    if (canInsertFromSlides) {
      setImagePickerOpen(target)
      return
    }
    toast.info(getImageInsertionUnavailableReason())
  }

  const getSectionPointLevels = (section) => {
    const pointsLength = section?.points?.length || 0
    const existing = Array.isArray(section?.pointLevels) ? section.pointLevels : []
    return Array.from({ length: pointsLength }, (_, idx) => {
      const raw = Number(existing[idx] ?? 0)
      return Number.isFinite(raw) ? Math.max(0, raw) : 0
    })
  }

  const getPointLevel = (sectionIndex, pointIndex) => {
    const section = notes?.notes?.[sectionIndex]
    if (!section) return 0
    return getSectionPointLevels(section)[pointIndex] || 0
  }

  // Sync local notes when lecture prop changes
  useEffect(() => {
    const normalizedNotes = normalizeNotesForDisplay(lecture.notes, lecture.title)

    setNotes(normalizedNotes)
    setHasChanges(false)

    // Clear cached PDF when lecture changes
    cachedPdfRef.current = null
    slideThumbnailCacheRef.current = new Map()

    // Load embedded image data if present
    const rawPointImages = lecture.notes?._pointImages ? normalizePointImagesMap(lecture.notes._pointImages) : {}
    const rawSectionImages = lecture.notes?._sectionImages ? normalizeSectionImagesMap(lecture.notes._sectionImages) : {}
    setPointImages(rawPointImages)
    setSectionImages(rawSectionImages)
    if (lecture.notes?._imageReferences) {
      setImageReferences(normalizeImageReferencesMap(lecture.notes._imageReferences))
    } else {
      setImageReferences({})
    }
    if (lecture.notes?._imageLayout) {
      setImageLayout(lecture.notes._imageLayout)
    } else {
      setImageLayout({})
    }
    if (lecture.notes?._flashcards) {
      setFlashcards(lecture.notes._flashcards)
    } else {
      setFlashcards([])
    }

    ;(async () => {
      const hydrated = await hydrateImageMapsForDisplay(rawPointImages, rawSectionImages)
      setPointImages(hydrated.point)
      setSectionImages(hydrated.section)
    })()
  }, [lecture.id])

  const buildNotesPayload = (baseNotes = notes, assetOverrides = {}) => {
    const nextPointImages = assetOverrides.pointImages ?? pointImages
    const nextSectionImages = assetOverrides.sectionImages ?? sectionImages
    const nextImageReferences = assetOverrides.imageReferences ?? imageReferences
    const nextImageLayout = assetOverrides.imageLayout ?? imageLayout

    return {
      ...baseNotes,
      _pointImages: Object.keys(nextPointImages).length > 0 ? nextPointImages : undefined,
      _sectionImages: Object.keys(nextSectionImages).length > 0 ? nextSectionImages : undefined,
      _imageReferences: Object.keys(nextImageReferences).length > 0 ? nextImageReferences : undefined,
      _imageLayout: Object.keys(nextImageLayout).length > 0 ? nextImageLayout : undefined,
    }
  }

  // Generate PDF thumbnails when lecture has a pdf_path
  useEffect(() => {
    const generateThumbnails = async () => {
      // Thumbnail generation check
      setThumbnailsError('')
      if (!lecture.pdf_path) {
        // No pdf_path found
        setPdfThumbnails([])
        setPdfPageCount(0)
        return
      }

      setThumbnailsLoading(true)
      try {
        // Download PDF from Supabase Storage
        const { data: pdfBlob, error: downloadError } = await supabase.storage
          .from('lecture-pdfs')
          .download(lecture.pdf_path)

        if (downloadError) {
          // Failed to download PDF
          setThumbnailsError('Could not load slides from storage.')
          return
        }

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const summary = await buildPdfThumbnails(arrayBuffer)
        setPdfThumbnails(summary.thumbnails)
        setPdfPageCount(summary.totalPages || 0)

        if (summary.thumbnails.length === 0) {
          setThumbnailsError('Could not process slides for image insertion.')
          return
        }

        if (summary.truncated || summary.failedPages > 0) {
          const notes = []
          if (summary.truncated) {
            notes.push(`Loaded ${summary.renderedPages} of ${summary.totalPages} slides for performance`)
          }
          if (summary.failedPages > 0) {
            notes.push(`${summary.failedPages} slide(s) could not be rendered`)
          }
          setThumbnailsError(`${notes.join('. ')}.`)
        }
      } catch (error) {
        // Thumbnail generation failed
        setThumbnailsError(`Could not process slides for image insertion (${error?.message || 'unknown error'}).`)
        // Keep picker usable with manual page selection when PDF is linked.
        if (lecture?.pdf_path) {
          try {
            const { data: pdfBlob } = await supabase.storage
              .from('lecture-pdfs')
              .download(lecture.pdf_path)
            if (pdfBlob) {
              const arrayBuffer = await pdfBlob.arrayBuffer()
              const pdfjsLib = await getPdfJsLib()
              const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, useSystemFonts: true, isEvalSupported: false }).promise
              cachedPdfRef.current = pdf
              setPdfPageCount(pdf.numPages || 0)
            }
          } catch {
            // Best-effort fallback only.
          }
        }
      } finally {
        setThumbnailsLoading(false)
      }
    }

    generateThumbnails()
  }, [lecture.id, lecture.pdf_path])

  // Preload Unicode PDF font in background.
  // Keep export click synchronous so browser download gesture is preserved.
  useEffect(() => {
    ensureUnicodePdfFont()
      .then(() => setUnicodeFontReady(true))
      .catch((error) => {
        // Font preload failed, using fallback
        setUnicodeFontReady(false)
      })
  }, [])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
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

        const preparedPayload = await prepareNotesPayloadForPersist(payload)
        const { error } = await supabase
          .from('lectures')
          .update({ notes: preparedPayload })
          .eq('id', lecture.id)

        if (error) throw error
      }

      if (isMountedRef.current) {
        setHasChanges(false)
        setSaveStatus('saved')
      }
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

  const enqueueNotesSave = (notesWithImages) => {
    if (isMountedRef.current) {
      setSaveStatus('saving')
    }
    pendingSavePayloadRef.current = notesWithImages
    const waitForFlush = new Promise((resolve, reject) => {
      saveWaitersRef.current.push({ resolve, reject })
    })
    flushQueuedSaves()
    return waitForFlush
  }

  const scheduleNotesSave = (notesWithImages, immediate = false) => {
    lastDebouncedPayloadRef.current = notesWithImages
    if (immediate) {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current)
        saveDebounceTimerRef.current = null
      }
      return enqueueNotesSave(notesWithImages)
    }
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current)
    }
    saveDebounceTimerRef.current = setTimeout(() => {
      const payload = lastDebouncedPayloadRef.current
      saveDebounceTimerRef.current = null
      if (payload) enqueueNotesSave(payload)
    }, 900)
    return Promise.resolve()
  }

  const waitForPendingSaves = async () => {
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current)
      saveDebounceTimerRef.current = null
      if (lastDebouncedPayloadRef.current) {
        await enqueueNotesSave(lastDebouncedPayloadRef.current)
      }
    }
    if (!saveInFlightRef.current && !pendingSavePayloadRef.current) return
    await new Promise((resolve, reject) => {
      saveWaitersRef.current.push({ resolve, reject })
    })
  }

  // Save notes to Supabase (including image data)
  const saveNotes = async () => {
    if (isMountedRef.current) {
      setSaving(true)
      setSaveStatus('saving')
    }
    const notesWithImages = buildNotesPayload(notes)
    try {
      await enqueueNotesSave(notesWithImages)
      if (isMountedRef.current) {
        setHasChanges(false)
        setSaveStatus('saved')
      }
    } catch {
      toast.error('Failed to save notes. Please try again.')
      if (isMountedRef.current) {
        setSaveStatus('error')
      }
    } finally {
      if (isMountedRef.current) {
        setSaving(false)
      }
    }
  }

  // Update notes locally and auto-save
  const updateNotes = async (newNotes, assetOverrides = {}) => {
    setNotes(newNotes)

    // Auto-save with debounce to avoid writing on every single small edit.
    const notesWithImages = buildNotesPayload(newNotes, assetOverrides)
    try {
      await scheduleNotesSave(notesWithImages, false)
      setHasChanges(true)
      if (isMountedRef.current) {
        setSaveStatus('saving')
      }
    } catch (error) {
      // Auto-save failed
      if (isMountedRef.current) {
        setSaveStatus('error')
      }
    }
  }

  const saveNotesAssets = async (assetOverrides) => {
    const notesWithImages = buildNotesPayload(notes, assetOverrides)
    try {
      if (isMountedRef.current) {
        setSaveStatus('saving')
      }
      await scheduleNotesSave(notesWithImages, true)
    } catch (error) {
      // Asset save failed
      if (isMountedRef.current) {
        setSaveStatus('error')
      }
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
      if (onBack) {
        await onBack()
      }
    } catch {
      toast.error('Could not save your changes. Please try again.')
      exitingRef.current = false
    } finally {
      if (isMountedRef.current) {
        setSaving(false)
      }
    }
  }

  // Copy handler
  const handleCopy = async () => {
    const text = notesToClipboardText(notes, learningObjectives)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Copy failed silently
    }
  }

  const handleGenerateFlashcards = async () => {
    if (!notes?.notes?.length) {
      toast.warn('Please generate notes first, then generate flashcards.')
      return
    }

    try {
      setGeneratingFlashcards(true)
      const generated = await generateFlashcardsFromNotes({
        notes,
        lectureTitle: notes.title || lecture.title,
        moduleAbbreviation: module?.abbreviation || '',
      })

      setFlashcards(generated)
      setHasChanges(true)
      toast.success(`Generated ${generated.length} flashcards`)
      if (onOpenFlashcards) {
        onOpenFlashcards()
      }
    } catch {
      toast.error('Failed to generate flashcards. Please try again.')
    } finally {
      setGeneratingFlashcards(false)
    }
  }

  const handleDeleteFlashcard = (index) => {
    setFlashcards((prev) => prev.filter((_, i) => i !== index))
    setHasChanges(true)
  }

  const handleFlashcardChange = (index, field, value) => {
    setFlashcards((prev) =>
      prev.map((card, i) => (i === index ? { ...card, [field]: value } : card))
    )
    setHasChanges(true)
  }

  const handleAddFlashcard = () => {
    if (!newCard.front.trim() || !newCard.back.trim()) return
    setFlashcards((prev) => [
      ...prev,
      {
        front: newCard.front.trim(),
        back: newCard.back.trim(),
        tags: '',
      },
    ])
    setNewCard({ front: '', back: '' })
    setShowAddCard(false)
    setHasChanges(true)
  }

  const parseCsvLine = (line) => {
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

  const handleImportFlashcardsCsv = async (e) => {
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

      if (!imported.length) {
        throw new Error('No valid flashcards found in CSV')
      }

      setFlashcards(imported)
      setHasChanges(true)
      toast.success(`Imported ${imported.length} flashcards from CSV`)
    } catch {
      toast.error('CSV import failed. Please check your file format.')
    } finally {
      e.target.value = ''
    }
  }

  const handleExportFlashcardsCSV = () => {
    if (!flashcards.length) return
    const csv =
      'Front,Back,Tags\n' +
      flashcards
        .map((card) => {
          const front = String(card.front || '').replace(/"/g, '""')
          const back = String(card.back || '').replace(/"/g, '""')
          const tags = String(card.tags || '').replace(/"/g, '""')
          return `"${front}","${back}","${tags}"`
        })
        .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(notes.title || lecture.title || 'lecture').replace(/[^a-zA-Z0-9]/g, '_')}_anki.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  // PDF Import handler - imports notes from a previously exported PDF
  const handleImportPDF = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Confirm replacement if notes already exist
    if (notes?.notes?.length > 0) {
      const confirmed = window.confirm('Import will replace all existing notes. Continue?')
      if (!confirmed) {
        e.target.value = ''
        return
      }
    }

    try {
      setImporting(true)

      const arrayBuffer = await file.arrayBuffer()
      const pdfjsLib = await getPdfJsLib()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      const startDelimiter = '[EMBEDDED_NOTES_DATA_START]'
      const endDelimiter = '[EMBEDDED_NOTES_DATA_END]'

      let importedNotes = null

      // First try to get from PDF metadata (new method - no blank pages)
      const metadata = await pdf.getMetadata()
      const keywords = metadata?.info?.Keywords || ''

      if (keywords.includes(startDelimiter)) {
        const startIndex = keywords.indexOf(startDelimiter)
        const endIndex = keywords.indexOf(endDelimiter)
        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
          const jsonStr = keywords.substring(startIndex + startDelimiter.length, endIndex).trim()
          importedNotes = JSON.parse(jsonStr)
        }
      }

      // Fall back to content extraction (old method for backwards compatibility)
      if (!importedNotes) {
        let allText = ''
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum)
          const textContent = await page.getTextContent()
          const pageText = textContent.items.map(item => item.str).join('')
          allText += pageText
        }

        const startIndex = allText.indexOf(startDelimiter)
        const endIndex = allText.indexOf(endDelimiter)

        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
          const jsonStr = allText.substring(startIndex + startDelimiter.length, endIndex).trim()
          importedNotes = JSON.parse(jsonStr)
        } else {
          throw new Error('NO_METADATA')
        }
      }

      // Validate structure
      if (!importedNotes || !importedNotes.title || !importedNotes.notes) {
        throw new Error('Invalid notes structure in PDF metadata')
      }

      // Clean up any image data (not supported in this version)
      const { _pointImages, _sectionImages, _imageReferences, ...cleanNotes } = importedNotes

      // Update local state
      setNotes(cleanNotes)
      setFlashcards(cleanNotes._flashcards || [])
      setHasChanges(true) // Mark as changed so user can save

      // Also update learning objectives if present
      if (importedNotes.learningObjectives && importedNotes.learningObjectives.length > 0) {
        // Convert to the format expected by the database
        const formattedObjectives = importedNotes.learningObjectives.map((lo, index) => ({
          id: crypto.randomUUID(),
          text: typeof lo === 'string' ? lo : lo.text,
          completed: false
        }))

        // Save learning objectives to database
        await supabase
          .from('lectures')
          .update({ learning_objectives: formattedObjectives })
          .eq('id', lecture.id)
      }

      toast.success(`Imported ${importedNotes.notes.length} sections. Click "Save Changes" to save.`)

    } catch (error) {
      if (error.message === 'NO_METADATA') {
        toast.error('This PDF cannot be imported. Only PDFs exported from this tool can be re-imported.')
      } else {
        toast.error('Import failed. Please ensure you\'re uploading a PDF exported from this tool.')
      }
    } finally {
      setImporting(false)
      e.target.value = '' // Reset file input
    }
  }

  // Legacy PDF Import handler - converts any PDF notes into structured format using AI
  const handleLegacyImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Confirm replacement if notes already exist
    if (notes?.notes?.length > 0) {
      const confirmed = window.confirm('This will replace all existing notes with AI-converted content. Continue?')
      if (!confirmed) {
        e.target.value = ''
        return
      }
    }

    try {
      setConvertingLegacy(true)

      // Refresh then get user session for auth
      await supabase.auth.refreshSession()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      const userId = sessionData?.session?.user?.id

      if (!accessToken || !userId) {
        throw new Error('Please sign in to convert notes')
      }

      // Upload the notes PDF to storage, then convert by storage path.
      const notesPath = `${userId}/${lecture.id}/notes-legacy-import.pdf`
      const { error: notesUploadError } = await supabase.storage
        .from('lecture-pdfs')
        .upload(notesPath, file, { upsert: true })

      if (notesUploadError) {
        throw new Error(`Failed to upload notes: ${notesUploadError.message}`)
      }

      // Call Edge Function to convert the PDF
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      const functionUrl = `${supabaseUrl}/functions/v1/convert-legacy-notes`

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          notes_path: notesPath,
        }),
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to convert notes')
      }

      // Update local state with converted notes
      const convertedNotes = {
        title: result.data.title || lecture.title,
        notes: result.data.notes || []
      }

      setNotes(convertedNotes)
      setFlashcards([])
      setHasChanges(true)

      // Also update learning objectives if present
      if (result.data.learning_objectives && result.data.learning_objectives.length > 0) {
        await supabase
          .from('lectures')
          .update({ learning_objectives: result.data.learning_objectives })
          .eq('id', lecture.id)
      }

      toast.success(`Converted ${convertedNotes.notes.length} sections. Click "Save Changes" to save.`)

    } catch {
      toast.error('Conversion failed. Please try again.')
    } finally {
      setConvertingLegacy(false)
      e.target.value = ''
    }
  }

  // Upload slides PDF for image insertion
  const handleSlidesUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setUploadingSlides(true)

      // Get user session
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id

      if (!userId) {
        throw new Error('Please sign in to upload slides')
      }

      // Upload to Supabase Storage
      const fileName = `${userId}/${lecture.id}/slides_${Date.now()}.pdf`
      const { error: uploadError } = await supabase.storage
        .from('lecture-pdfs')
        .upload(fileName, file)

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      // Update lecture with pdf_path
      const { error: updateError } = await supabase
        .from('lectures')
        .update({ pdf_path: fileName })
        .eq('id', lecture.id)

      if (updateError) {
        throw new Error(updateError.message)
      }

      // Generate thumbnails from the uploaded file
      setThumbnailsError('')
      const arrayBuffer = await file.arrayBuffer()
      const summary = await buildPdfThumbnails(arrayBuffer)
      setPdfThumbnails(summary.thumbnails)
      setPdfPageCount(summary.totalPages || 0)

      if (summary.thumbnails.length === 0) {
        throw new Error('Could not process slides for image insertion')
      }

      if (summary.truncated || summary.failedPages > 0) {
        const notes = []
        if (summary.truncated) {
          notes.push(`Loaded ${summary.renderedPages} of ${summary.totalPages} slides`)
        }
        if (summary.failedPages > 0) {
          notes.push(`${summary.failedPages} slide(s) could not be rendered`)
        }
        setThumbnailsError(`${notes.join('. ')}.`)
      }

      toast.success(`Uploaded ${summary.thumbnails.length} slides. You can now insert images.`)

    } catch (error) {
      setThumbnailsError(`Slides upload failed: ${error.message}`)
      setPdfPageCount(0)
      toast.error('Failed to upload slides. Please try again.')
    } finally {
      setUploadingSlides(false)
      e.target.value = ''
    }
  }

  // Handle image upload from device
  const handleImageUploadFiles = async (files) => {
    if (!files || files.length === 0) return

    setUploadingImages(true)

    try {
      const newImages = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]

        // Read file as data URL
        const reader = new FileReader()
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = (e) => resolve(e.target.result)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        newImages.push({
          id: `uploaded-${Date.now()}-${i}`,
          dataUrl,
          width: 0, // Will be set when image loads
          height: 0
        })
      }

      // Add images to pdfThumbnails so they appear in the image selector
      setPdfThumbnails(prev => [...prev, ...newImages])

      toast.success(`Added ${newImages.length} image${newImages.length !== 1 ? 's' : ''}. You can now insert them.`)

    } catch {
      toast.error('Failed to upload images. Please try again.')
    } finally {
      setUploadingImages(false)
    }
  }

  const handleImageUpload = async (e) => {
    const files = e.target.files
    await handleImageUploadFiles(files)
    e.target.value = ''
  }

  // PDF Export handler - exports notes as PDF with embedded metadata for re-importing
  const handleExportPDF = async () => {
    if (!notes || exportingPdf) return
    setExportingPdf(true)
    const pdfMake = await getPdfMake()
    const useUnicodeFont = normalizeUnicodePdfFont(pdfMake)
    const exportLectureTitle = String(lecture?.title || notes?.title || 'Lecture Notes')
    const exportFileBase = `${exportLectureTitle
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      || 'Lecture_Notes'}_notes`
    const exportFileName = `${exportFileBase}.pdf`

    const fetchImageAsDataUrl = async (src) => {
      if (!src || typeof src !== 'string') return null
      if (src.startsWith('data:image/')) return src
      if (!/^https?:\/\//i.test(src)) return null

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      let response
      try {
        response = await fetch(src, { signal: controller.signal })
      } finally {
        clearTimeout(timeoutId)
      }
      if (!response.ok) throw new Error(`Image fetch failed (${response.status})`)
      const blob = await response.blob()

      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => reject(new Error('Failed to convert image to data URL'))
        reader.readAsDataURL(blob)
      })
    }
    const fetchImageAsDataUrlCached = async (src) => {
      if (!src) return null
      if (!exportImageDataUrlCacheRef.current.has(src)) {
        exportImageDataUrlCacheRef.current.set(src, fetchImageAsDataUrl(src).catch(() => null))
      }
      return await exportImageDataUrlCacheRef.current.get(src)
    }

    // Helper function to parse text/HTML and keep line breaks + list structure for PDF
    const parseRawText = (text) => {
      if (!text) return ''
      let str = String(text)

      // Convert editable HTML into plain text while preserving list hierarchy and line breaks.
      // This mirrors how the legacy exporter treated contentEditable output.
      if (/<[a-z][\s\S]*>/i.test(str)) {
        const container = document.createElement('div')
        container.innerHTML = str

        const out = []
        const write = (value) => out.push(value)

        const walk = (node, listDepth = 0) => {
          if (node.nodeType === Node.TEXT_NODE) {
            write(node.textContent || '')
            return
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return

          const tag = node.tagName.toLowerCase()

          if (tag === 'br') {
            write('\n')
            return
          }

          if (tag === 'ul' || tag === 'ol') {
            Array.from(node.children).forEach((child) => walk(child, listDepth + 1))
            write('\n')
            return
          }

          if (tag === 'li') {
            const indent = '  '.repeat(Math.max(0, listDepth - 1))
            write(`\n${indent}• `)
            Array.from(node.childNodes).forEach((child) => walk(child, listDepth))
            return
          }

          if (tag === 'strong' || tag === 'b') {
            write('**')
            Array.from(node.childNodes).forEach((child) => walk(child, listDepth))
            write('**')
            return
          }

          if (tag === 'div' || tag === 'p' || tag === 'blockquote') {
            Array.from(node.childNodes).forEach((child) => walk(child, listDepth))
            write('\n')
            return
          }

          Array.from(node.childNodes).forEach((child) => walk(child, listDepth))
        }

        Array.from(container.childNodes).forEach((node) => walk(node, 0))
        str = out.join('')
      }

      // Decode common HTML entities and normalize spacing
      str = str
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      // Fallback symbol mapping only when Unicode font could not be loaded.
      if (!useUnicodeFont) {
        str = str
          .replace(/→/g, '->')
          .replace(/←/g, '<-')
          .replace(/↑/g, '^')
          .replace(/↓/g, 'v')
          .replace(/⇒/g, '=>')
          .replace(/⇐/g, '<=')
      }

      return str
    }

    const parseInlineText = (str) => {
      if (!str) return ''

      // Parse **bold** syntax into pdfmake text array
      const textArray = []
      const boldRegex = /\*\*(.+?)\*\*/g
      let lastIndex = 0
      let match

      while ((match = boldRegex.exec(str)) !== null) {
        if (match.index > lastIndex) {
          textArray.push({ text: str.substring(lastIndex, match.index) })
        }
        textArray.push({ text: match[1], bold: true })
        lastIndex = match.index + match[0].length
      }

      if (lastIndex < str.length) {
        textArray.push({ text: str.substring(lastIndex) })
      }

      return textArray.length > 0 ? textArray : str
    }

    const parseText = (text) => parseInlineText(parseRawText(text))

    const parsePointToBulletRows = (point, figRefs = [], pointLevel = 0) => {
      const raw = parseRawText(point)
      const lines = raw
        .split('\n')
        .map(line => line.replace(/\s+$/g, ''))
        .filter(line => line.trim().length > 0)

      const rows = []
      let figRefAttached = false
      const validFigRefs = Array.isArray(figRefs)
        ? figRefs.filter((n) => Number.isFinite(Number(n)))
        : []

      lines.forEach((line) => {
        const content = line.trim().replace(/^([•\-])\s+/, '')
        const marker = pointLevel > 0 ? '-' : '•'
        const parsed = parseInlineText(`${marker} ${content}`)
        let textValue = parsed
        if (validFigRefs.length > 0 && !figRefAttached) {
          const asArray = Array.isArray(parsed) ? parsed : [{ text: parsed }]
          const figRefText = validFigRefs.map((n) => `(Fig ${n})`).join(', ')
          asArray.push({ text: ` ${figRefText}`, fontSize: 9, color: '#6366F1' })
          textValue = asArray
          figRefAttached = true
        }

        rows.push({
          text: textValue,
          style: 'bullet',
          margin: [pointLevel * 16, 2, 0, 2]
        })
      })

      if (rows.length === 0) {
        const marker = pointLevel > 0 ? '-' : '•'
        const parsed = parseInlineText(`${marker} ${raw}`)
        const textValue = validFigRefs.length > 0
          ? [...(Array.isArray(parsed) ? parsed : [{ text: parsed }]), { text: ` ${validFigRefs.map((n) => `(Fig ${n})`).join(', ')}`, fontSize: 9, color: '#6366F1' }]
          : parsed
        rows.push({
          text: textValue,
          style: 'bullet',
          margin: [pointLevel * 16, 2, 0, 2]
        })
      }

      return rows
    }

    const buildFigureCaptionParts = (fig) => {
      const suffix = fig.image?.isUploaded
        ? 'Uploaded'
        : `Slide ${fig.image?.pageNum || '?'}`
      return [
        { text: `Fig ${fig.figNum}`, color: '#6366F1' },
        { text: ` (${suffix})`, color: '#6B7280' }
      ]
    }

    const buildPdfFigureStack = (fig, width, height) => {
      const roundedWidth = Math.round(width)
      const roundedHeight = Math.round(height)
          return {
            width: roundedWidth,
            alignment: 'center',
            stack: [
              { image: fig.image.dataUrl, width: roundedWidth, height: roundedHeight, alignment: 'center' },
              { text: buildFigureCaptionParts(fig), fontSize: 9, margin: [0, 2, 0, 0], alignment: 'center' }
            ]
          }
        }

    // Build learning objectives for embedding (just text strings)
    const loStrings = learningObjectives.map(lo =>
      typeof lo === 'string' ? lo : lo.text
    )
    // Build pdfmake document definition
    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      defaultStyle: {
        font: useUnicodeFont ? 'NotoSans' : 'Roboto',
        fontSize: 11
      },
      content: [],
      styles: {
        title: {
          fontSize: 18,
          bold: true,
          color: '#365F91',
          margin: [0, 0, 0, 12]
        },
        sectionHeader: {
          fontSize: 13,
          bold: true,
          color: '#4F81BD',
          margin: [0, 12, 0, 6]
        },
        objectivesHeader: {
          fontSize: 13,
          bold: true,
          color: '#4F81BD',
          margin: [0, 0, 0, 6]
        },
        bullet: {
          fontSize: 11,
          margin: [0, 2, 0, 2]
        }
      },
      info: {
        title: exportFileBase,
        author: 'Lecture Revision Tool',
        subject: 'Concise Lecture Notes'
      }
    }

    // Add title
    docDefinition.content.push({
      text: `${exportLectureTitle} (Concise Notes)`,
      style: 'title'
    })

    // Add learning objectives section
    if (loStrings.length > 0) {
      docDefinition.content.push({
        text: 'Learning Objectives',
        style: 'objectivesHeader'
      })

      docDefinition.content.push({
        ul: loStrings.map(obj => ({
          text: parseText(obj),
          margin: [0, 1, 0, 1]
        })),
        margin: [0, 0, 0, 8]
      })
    }

    const exportSectionImagesEntries = await Promise.allSettled(
      Object.entries(sectionImages || {}).map(async ([sectionKey, sectionImage]) => {
        if (!sectionImage) return null
        const resolvedDataUrl = await fetchImageAsDataUrlCached(sectionImage.dataUrl)
        if (!resolvedDataUrl) {
          // Failed to resolve section image
          return null
        }
        return [sectionKey, { ...sectionImage, dataUrl: resolvedDataUrl }]
      })
    )
    const exportSectionImages = Object.fromEntries(
      exportSectionImagesEntries
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => result.value)
    )

    const exportPointImagesEntries = await Promise.allSettled(
      Object.entries(pointImages || {}).map(async ([pointKey, pointImageEntry]) => {
        const normalizedImages = normalizePointImageEntry(pointImageEntry)
        if (!normalizedImages.length) return null

        const resolvedImages = (
          await Promise.all(
            normalizedImages.map(async (image) => {
              const resolvedDataUrl = await fetchImageAsDataUrlCached(image?.dataUrl)
              if (!resolvedDataUrl) return null
              return { ...image, dataUrl: resolvedDataUrl }
            })
          )
        ).filter(Boolean)

        if (resolvedImages.length === 0) return null
        if (resolvedImages.length === 1) return [pointKey, resolvedImages[0]]
        return [pointKey, resolvedImages]
      })
    )
    const exportPointImages = Object.fromEntries(
      exportPointImagesEntries
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => result.value)
    )

    // Add notes sections with images
    let figureCounter = 0

    if (notes.notes && notes.notes.length > 0) {
      notes.notes.forEach((section, sectionIndex) => {
        // Collect figures for this section
        const sectionFigures = []

        // Check for section image
        const sectionImg = exportSectionImages[sectionIndex]
        if (sectionImg && sectionImg.dataUrl) {
          figureCounter++
          sectionFigures.push({
            figNum: figureCounter,
            image: sectionImg,
            type: 'section',
            key: `section-${sectionIndex}`
          })
        }

        // Check for point images
        if (section.points) {
          section.points.forEach((_, pointIndex) => {
            const pointKey = getPointImageKey(sectionIndex, pointIndex)
            const pointImgList = normalizePointImageEntry(exportPointImages[pointKey])
            pointImgList.forEach((img, pointImageIndex) => {
              if (!img?.dataUrl) return
              figureCounter++
              sectionFigures.push({
                figNum: figureCounter,
                image: img,
                type: 'point',
                pointIndex,
                pointImageIndex,
                key: `${pointKey}::${pointImageIndex}`
              })
            })
          })
        }

        // Section header with figure reference if section has image
        const sectionFigure = sectionFigures.find(f => f.type === 'section')
        if (sectionFigure) {
          docDefinition.content.push({
            text: [
              ...( Array.isArray(parseText(section.section || `Section ${sectionIndex + 1}`))
                ? parseText(section.section || `Section ${sectionIndex + 1}`)
                : [{ text: parseText(section.section || `Section ${sectionIndex + 1}`) }]
              ),
              { text: ` (Fig ${sectionFigure.figNum})`, fontSize: 9, color: '#6366F1', bold: false }
            ],
            style: 'sectionHeader'
          })
        } else {
          docDefinition.content.push({
            text: parseText(section.section || `Section ${sectionIndex + 1}`),
            style: 'sectionHeader'
          })
        }

        // Section points as bullets with figure references
        if (section.points && section.points.length > 0) {
          const processedPointRows = []
          const sectionPointLevels = Array.isArray(section.pointLevels) ? section.pointLevels : []
          section.points.forEach((point, pointIndex) => {
            const figRefs = getPointFigureNumbers(sectionIndex, pointIndex)
            const level = Number(sectionPointLevels[pointIndex] ?? 0)
            processedPointRows.push(...parsePointToBulletRows(point, figRefs, Math.max(0, level)))
          })

          docDefinition.content.push({
            stack: processedPointRows,
            margin: [0, 0, 0, 6]
          })

          // After bullets, render image rows if there are figures in this section
          if (sectionFigures.length > 0) {
            const sectionLayout = imageLayout?.[sectionIndex]
            const { rows } = computeFigureRows(sectionFigures, sectionLayout, {
              maxRowWidth: 500,
              columnGap: 12,
              maxItemsPerRow: 4,
              minRowHeight: 90,
              maxRowHeight: 205,
              targetRowHeight: 128,
              singletonMinHeight: 118,
              singletonMaxHeight: 168,
              singletonTargetHeight: 145,
              autoSoloAspect: 3.8
            })

            rows.forEach((row, rowIndex) => {
              if (row.items.length === 1) {
                const item = row.items[0]
                docDefinition.content.push({
                  ...buildPdfFigureStack(item.fig, item.width, item.height),
                  margin: [0, rowIndex === 0 ? 6 : 4, 0, 4]
                })
                return
              }

              docDefinition.content.push({
                columns: row.items.map((item) => buildPdfFigureStack(item.fig, item.width, item.height)),
                columnGap: 12,
                margin: [0, rowIndex === 0 ? 6 : 3, 0, 3]
              })
            })

            docDefinition.content.push({ text: '', margin: [0, 0, 0, 4] })
          }
          }
        })
    }

    // Generate and download PDF
    try {
      const selectedFont = docDefinition.defaultStyle.font
      const selectedFontConfig = pdfMake.fonts?.[selectedFont]
      const selectedNormal = selectedFontConfig?.normal
      const selectedBold = selectedFontConfig?.bold || selectedNormal

      // Final safeguard against "File not found in virtual file system".
      if (!selectedNormal || !pdfMake.vfs?.[selectedNormal] || !selectedBold || !pdfMake.vfs?.[selectedBold]) {
        docDefinition.defaultStyle.font = 'Roboto'
      }
      pdfMake.createPdf(docDefinition).download(exportFileName)
    } catch (error) {
      // PDF generation failed
      toast.error('Failed to generate PDF. Please try again.')
    } finally {
      setExportingPdf(false)
    }
  }

  // ============ EDIT FUNCTIONS ============

  const ensureEditableLineBullets = (value) => {
    if (!value) return value
    return String(value)
      .split('\n')
      .map((line) => {
        if (!line.trim()) return line
        return /^\s*•\s+/.test(line) ? line : `• ${line}`
      })
      .join('\n')
  }

  const startEditPoint = (sectionIndex, pointIndex) => {
    const rawValue = String(notes.notes[sectionIndex].points[pointIndex]).replace(/<br\s*\/?>/gi, '\n')
    const formattedValue = markdownToHTML(rawValue)
    const value = /<(ul|ol|li)\b/i.test(formattedValue) ? formattedValue : ensureEditableLineBullets(formattedValue)
    setEditingNote({ type: 'point', sectionIndex, pointIndex, value })
  }

  const startEditSection = (sectionIndex) => {
    const value = markdownToHTML(String(notes.notes[sectionIndex].section).replace(/<br\s*\/?>/gi, '\n'))
    setEditingNote({ type: 'section', sectionIndex, value })
  }

  const startEditTitle = () => {
    setEditingNote({ type: 'title', value: markdownToHTML(notes.title || '') })
  }

  const saveNoteEdit = () => {
    if (!editingNote || !notes) return
    const updated = JSON.parse(JSON.stringify(notes))

    let processedValue = editingNote.value
    if (!processedValue.includes('<ul>') && !processedValue.includes('<ol>') && !processedValue.includes('<li>')) {
      processedValue = processedValue.replace(/\n/g, '<br>')
    }

    if (editingNote.type === 'point') {
      updated.notes[editingNote.sectionIndex].points[editingNote.pointIndex] = processedValue
    } else if (editingNote.type === 'section') {
      updated.notes[editingNote.sectionIndex].section = processedValue
    } else if (editingNote.type === 'title') {
      updated.title = processedValue
    }

    updateNotes(updated)
    setEditingNote(null)
  }

  const shiftPointKeyMapsForInsert = (currentPointImages, currentImageReferences, sectionIndex, insertIndex, insertCount = 1) => {
    const nextPointImages = {}
    Object.entries(currentPointImages || {}).forEach(([key, value]) => {
      const [si, pi] = String(key).split('-').map(Number)
      if (si !== sectionIndex || Number.isNaN(pi)) {
        nextPointImages[key] = value
        return
      }
      const nextIndex = pi >= insertIndex ? pi + insertCount : pi
      nextPointImages[`${si}-${nextIndex}`] = value
    })

    const remap = (key) => {
      const [si, pi] = String(key).split('-').map(Number)
      if (si !== sectionIndex || Number.isNaN(pi)) return key
      return `${si}-${pi >= insertIndex ? pi + insertCount : pi}`
    }
    const nextImageReferences = {}
    Object.entries(currentImageReferences || {}).forEach(([targetKey, sourceKey]) => {
      const nextTarget = remap(targetKey)
      const nextSource = remapReferenceValue(targetKey, sourceKey, remap)
      if (!nextTarget || !nextSource) return
      nextImageReferences[nextTarget] = nextSource
    })

    return { nextPointImages, nextImageReferences }
  }

  const shiftPointKeyMapsForDeleteRange = (currentPointImages, currentImageReferences, sectionIndex, startIndex, endIndexExclusive) => {
    const removedCount = endIndexExclusive - startIndex
    const nextPointImages = {}
    Object.entries(currentPointImages || {}).forEach(([key, value]) => {
      const [si, pi] = String(key).split('-').map(Number)
      if (si !== sectionIndex || Number.isNaN(pi)) {
        nextPointImages[key] = value
        return
      }
      if (pi >= startIndex && pi < endIndexExclusive) return
      const nextIndex = pi >= endIndexExclusive ? pi - removedCount : pi
      nextPointImages[`${si}-${nextIndex}`] = value
    })

    const remap = (key) => {
      const [si, pi] = String(key).split('-').map(Number)
      if (si !== sectionIndex || Number.isNaN(pi)) return key
      if (pi >= startIndex && pi < endIndexExclusive) return null
      const nextIndex = pi >= endIndexExclusive ? pi - removedCount : pi
      return `${si}-${nextIndex}`
    }

    const nextImageReferences = {}
    Object.entries(currentImageReferences || {}).forEach(([targetKey, sourceKey]) => {
      const nextTarget = remap(targetKey)
      const nextSource = remapReferenceValue(targetKey, sourceKey, remap)
      if (!nextTarget || !nextSource) return
      nextImageReferences[nextTarget] = nextSource
    })

    return { nextPointImages, nextImageReferences }
  }

  const deletePoint = (sectionIndex, pointIndex) => {
    const updated = JSON.parse(JSON.stringify(notes))
    const section = updated.notes[sectionIndex]
    const levels = getSectionPointLevels(section)
    const baseLevel = levels[pointIndex] || 0
    let endIndex = pointIndex + 1
    while (endIndex < levels.length && levels[endIndex] > baseLevel) {
      endIndex += 1
    }
    section.points.splice(pointIndex, endIndex - pointIndex)
    section.pointLevels = levels.filter((_, idx) => idx < pointIndex || idx >= endIndex)
    const { nextPointImages, nextImageReferences } = shiftPointKeyMapsForDeleteRange(
      pointImages,
      imageReferences,
      sectionIndex,
      pointIndex,
      endIndex
    )
    setPointImages(nextPointImages)
    setImageReferences(nextImageReferences)
    updateNotes(updated, {
      pointImages: nextPointImages,
      imageReferences: nextImageReferences,
    })
  }

  const addPoint = (sectionIndex) => {
    const updated = JSON.parse(JSON.stringify(notes))
    const section = updated.notes[sectionIndex]
    section.points.push('New point - click to edit')
    const levels = getSectionPointLevels(section)
    levels.push(0)
    section.pointLevels = levels
    const { nextPointImages, nextImageReferences } = shiftPointKeyMapsForInsert(
      pointImages,
      imageReferences,
      sectionIndex,
      section.points.length - 1,
      1
    )
    setPointImages(nextPointImages)
    setImageReferences(nextImageReferences)
    updateNotes(updated, {
      pointImages: nextPointImages,
      imageReferences: nextImageReferences,
    })
    setEditingNote({
      type: 'point',
      sectionIndex,
      pointIndex: section.points.length - 1,
      value: ''
    })
  }

  const addSubPoint = (sectionIndex, pointIndex) => {
    const updated = JSON.parse(JSON.stringify(notes))
    const section = updated.notes[sectionIndex]
    const levels = getSectionPointLevels(section)
    const parentLevel = levels[pointIndex] || 0

    let insertIndex = pointIndex + 1
    while (insertIndex < levels.length && levels[insertIndex] > parentLevel) {
      insertIndex += 1
    }

    section.points.splice(insertIndex, 0, 'New sub-point - click to edit')
    levels.splice(insertIndex, 0, parentLevel + 1)
    section.pointLevels = levels
    const { nextPointImages, nextImageReferences } = shiftPointKeyMapsForInsert(
      pointImages,
      imageReferences,
      sectionIndex,
      insertIndex,
      1
    )
    setPointImages(nextPointImages)
    setImageReferences(nextImageReferences)
    updateNotes(updated, {
      pointImages: nextPointImages,
      imageReferences: nextImageReferences,
    })
    setEditingNote({
      type: 'point',
      sectionIndex,
      pointIndex: insertIndex,
      value: ''
    })
  }

  const deleteSection = (sectionIndex) => {
    if (!confirm('Delete this entire section?')) return
    const updated = JSON.parse(JSON.stringify(notes))
    updated.notes.splice(sectionIndex, 1)
    // Renumber sections
    updated.notes = updated.notes.map((section, index) => {
      if (section.section) {
        const newSection = section.section.replace(/^\d+[\.\:\)\-]?\s*/, `${index + 1}. `)
        return { ...section, section: newSection }
      }
      return section
    })
    updateNotes(updated)
  }

  const addSection = () => {
    const updated = JSON.parse(JSON.stringify(notes))
    const newIndex = updated.notes.length + 1
    updated.notes.push({
      section: `${newIndex}. New Section`,
      points: ['New point - click to edit'],
      pointLevels: [0]
    })
    updateNotes(updated)
  }

  // ============ FORMATTING FUNCTIONS ============

  const insertFormatting = (command) => {
    if (!textareaRef.current) return

    isFormattingRef.current = true
    textareaRef.current.focus()

    const commandMap = {
      'bold': 'bold',
      'italic': 'italic',
      'underline': 'underline',
      'superscript': 'superscript',
      'subscript': 'subscript'
    }

    const execCmd = commandMap[command]
    if (execCmd) {
      const sel = window.getSelection()

      if (execCmd === 'superscript' || execCmd === 'subscript') {
        const oppositeCmd = execCmd === 'superscript' ? 'subscript' : 'superscript'
        const sameTag = execCmd === 'superscript' ? 'SUP' : 'SUB'
        const isCollapsed = sel.isCollapsed

        if (isCollapsed) {
          const wasActive = activeFormatting[execCmd]
          const newFormatting = { ...activeFormatting }
          newFormatting[oppositeCmd] = false
          newFormatting[execCmd] = !newFormatting[execCmd]
          setActiveFormatting(newFormatting)

          let isInsideTag = false
          let formattedNode = null

          if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0)
            const container = range.commonAncestorContainer
            let node = container.nodeType === Node.TEXT_NODE ? container.parentElement : container

            while (node && node !== textareaRef.current) {
              if (node.tagName === sameTag) {
                isInsideTag = true
                formattedNode = node
                break
              }
              node = node.parentElement
            }
          }

          if (!wasActive) {
            document.execCommand(execCmd, false, null)
          } else {
            if (isInsideTag && formattedNode) {
              const breakNode = document.createTextNode(' \u200B')
              formattedNode.parentNode.insertBefore(breakNode, formattedNode.nextSibling)
              const newRange = document.createRange()
              newRange.setStartAfter(breakNode)
              newRange.collapse(true)
              sel.removeAllRanges()
              sel.addRange(newRange)
            } else {
              document.execCommand('insertText', false, ' \u200B')
            }
          }
        } else {
          document.execCommand(execCmd, false, null)
        }
      } else {
        document.execCommand(execCmd, false, null)
      }

      const inputEvent = new Event('input', { bubbles: true })
      textareaRef.current.dispatchEvent(inputEvent)
    }

    setTimeout(() => {
      isFormattingRef.current = false
    }, 50)
  }

  const insertSymbol = (symbol) => {
    if (!textareaRef.current) return
    textareaRef.current.focus()
    document.execCommand('insertText', false, symbol)
    const inputEvent = new Event('input', { bubbles: true })
    textareaRef.current.dispatchEvent(inputEvent)
  }

  const insertBullet = () => {
    if (!textareaRef.current) return
    textareaRef.current.focus()
    document.execCommand('insertUnorderedList', false, null)
    const inputEvent = new Event('input', { bubbles: true })
    textareaRef.current.dispatchEvent(inputEvent)
  }

  // ============ DRAG AND DROP - POINTS ============

  const handleDragStart = (e, sectionIndex, pointIndex) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')
    setDraggedPoint({ sectionIndex, pointIndex })
  }

  const handlePointDragOver = (e, sectionIndex, pointIndex) => {
    e.preventDefault()
    if (draggedPoint) {
      setDropTargetPoint({ sectionIndex, pointIndex })
    }
  }

  const handleDragEnd = () => {
    setDraggedPoint(null)
    setDraggedSection(null)
    setDraggedFigureKey(null)
    setDropTargetPoint(null)
    setDropTargetSection(null)
  }

  const handleDragLeave = () => {
    setDropTargetPoint(null)
    setDropTargetSection(null)
  }

  const handleDrop = (targetSectionIndex, targetPointIndex) => {
    if (!draggedPoint) return
    if (draggedPoint.sectionIndex !== targetSectionIndex) {
      setDraggedPoint(null)
      setDropTargetPoint(null)
      return
    }

    const updated = JSON.parse(JSON.stringify(notes))
    const section = updated.notes[targetSectionIndex]
    const points = [...section.points]
    const levels = getSectionPointLevels(section)
    const getDirectParentIndex = (arr, idx) => {
      const lvl = arr[idx] || 0
      if (lvl <= 0) return null
      for (let i = idx - 1; i >= 0; i--) {
        if ((arr[i] || 0) === lvl - 1) return i
      }
      return null
    }

    const sourceIndex = draggedPoint.pointIndex
    if (sourceIndex === targetPointIndex) return

    const sourceLevel = levels[sourceIndex] || 0
    const sourceParentIndex = getDirectParentIndex(levels, sourceIndex)
    const targetLevelOriginal = levels[targetPointIndex] || 0
    const targetParentIndexOriginal = getDirectParentIndex(levels, targetPointIndex)
    let sourceEnd = sourceIndex + 1
    while (sourceEnd < levels.length && levels[sourceEnd] > sourceLevel) {
      sourceEnd += 1
    }

    // Ignore drops into own subtree.
    if (targetPointIndex >= sourceIndex && targetPointIndex < sourceEnd) return

    const movedPoints = points.slice(sourceIndex, sourceEnd)
    const movedLevels = levels.slice(sourceIndex, sourceEnd)
    points.splice(sourceIndex, sourceEnd - sourceIndex)
    levels.splice(sourceIndex, sourceEnd - sourceIndex)

    const targetIndexInReduced = targetPointIndex > sourceIndex ? targetPointIndex - (sourceEnd - sourceIndex) : targetPointIndex
    const targetLevel = levels[targetIndexInReduced] || 0

    // Place moved subtree after target subtree.
    let insertIndex = targetIndexInReduced + 1
    while (insertIndex < levels.length && levels[insertIndex] > targetLevel) {
      insertIndex += 1
    }

    // Keep sibling-level reorder only for same-level points sharing the same direct parent.
    // Otherwise, treat drop as nesting under the target.
    const isSiblingReorder = sourceLevel === targetLevelOriginal && sourceParentIndex === targetParentIndexOriginal
    const nestedToMain = sourceLevel > 0 && targetLevel === 0
    const nextRootLevel = isSiblingReorder
      ? sourceLevel
      : nestedToMain
        ? 1
        : targetLevel + 1
    const levelDelta = nextRootLevel - sourceLevel
    const normalizedMovedLevels = movedLevels.map((lvl) => Math.max(0, lvl + levelDelta))
    if (isSiblingReorder) {
      // For sibling reorder, insert before target so items can move to top of sibling lists.
      insertIndex = targetIndexInReduced
    }

    points.splice(insertIndex, 0, ...movedPoints)
    levels.splice(insertIndex, 0, ...normalizedMovedLevels)

    // Remap point-index keyed image maps within this section.
    const oldIndexOrder = Array.from({ length: section.points.length }, (_, idx) => idx)
    const movedOldIndices = oldIndexOrder.slice(sourceIndex, sourceEnd)
    oldIndexOrder.splice(sourceIndex, sourceEnd - sourceIndex)
    oldIndexOrder.splice(insertIndex, 0, ...movedOldIndices)
    const oldToNew = {}
    oldIndexOrder.forEach((oldIdx, newIdx) => { oldToNew[oldIdx] = newIdx })

    const remapPointKey = (key) => {
      const [si, pi] = String(key).split('-').map(Number)
      if (si !== targetSectionIndex || Number.isNaN(pi)) return key
      const nextPointIndex = oldToNew[pi]
      return nextPointIndex === undefined ? null : `${si}-${nextPointIndex}`
    }

    const nextPointImages = {}
    Object.entries(pointImages).forEach(([key, value]) => {
      const nextKey = remapPointKey(key)
      if (nextKey) nextPointImages[nextKey] = value
    })
    setPointImages(nextPointImages)

    const nextImageRefs = {}
    Object.entries(imageReferences).forEach(([targetKey, sourceKey]) => {
      const nextTargetKey = remapPointKey(targetKey)
      if (!nextTargetKey) return
      const nextSourceKey = remapReferenceValue(targetKey, sourceKey, (key) => remapPointKey(key) || key)
      if (!nextSourceKey) return
      nextImageRefs[nextTargetKey] = nextSourceKey
    })
    setImageReferences(nextImageRefs)

    section.points = points
    section.pointLevels = levels
    updateNotes(updated, {
      pointImages: nextPointImages,
      imageReferences: nextImageRefs,
      sectionImages,
      imageLayout,
    })
    setDraggedPoint(null)
    setDropTargetPoint(null)
  }

  // ============ DRAG AND DROP - SECTIONS ============

  const handleSectionDragStart = (e, sectionIndex) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')
    setDraggedSection(sectionIndex)
  }

  const handleSectionDragOver = (e, sectionIndex) => {
    e.preventDefault()
    if (draggedSection !== null) {
      setDropTargetSection(sectionIndex)
    }
  }

  const handleSectionDrop = (targetSectionIndex) => {
    if (draggedSection === null) return
    if (draggedSection === targetSectionIndex) return

    const updated = JSON.parse(JSON.stringify(notes))
    const originalSectionCount = updated.notes.length
    const [movedSection] = updated.notes.splice(draggedSection, 1)
    updated.notes.splice(targetSectionIndex, 0, movedSection)

    // Renumber sections
    updated.notes = updated.notes.map((section, index) => {
      if (section.section) {
        const newSection = section.section.replace(/^\d+[\.\:\)\-]?\s*/, `${index + 1}. `)
        return { ...section, section: newSection }
      }
      return section
    })

    const oldIndexOrder = Array.from({ length: originalSectionCount }, (_, idx) => idx)
    const [movedOldIndex] = oldIndexOrder.splice(draggedSection, 1)
    oldIndexOrder.splice(targetSectionIndex, 0, movedOldIndex)
    const oldToNewSectionIndex = {}
    oldIndexOrder.forEach((oldIdx, newIdx) => {
      oldToNewSectionIndex[oldIdx] = newIdx
    })

    const remapFigureKey = (key) => {
      if (!key) return key
      const value = String(key)

      if (value.startsWith('section-')) {
        const sectionPayload = value.replace('section-', '')
        const [sectionIndexRaw, sectionImageSuffix] = sectionPayload.split('::')
        const oldSectionIndex = Number(sectionIndexRaw)
        if (Number.isNaN(oldSectionIndex)) return value
        const newSectionIndex = oldToNewSectionIndex[oldSectionIndex]
        if (newSectionIndex === undefined) return null
        return sectionImageSuffix !== undefined
          ? `section-${newSectionIndex}::${sectionImageSuffix}`
          : `section-${newSectionIndex}`
      }

      const [pointBase, pointImageSuffix] = value.split('::')
      const [oldSectionIndex, pointIndex] = pointBase.split('-').map(Number)
      if (Number.isNaN(oldSectionIndex) || Number.isNaN(pointIndex)) return value
      const newSectionIndex = oldToNewSectionIndex[oldSectionIndex]
      if (newSectionIndex === undefined) return null
      return pointImageSuffix !== undefined
        ? `${newSectionIndex}-${pointIndex}::${pointImageSuffix}`
        : `${newSectionIndex}-${pointIndex}`
    }

    const nextPointImages = {}
    Object.entries(pointImages).forEach(([key, image]) => {
      const remappedKey = remapFigureKey(key)
      if (remappedKey) nextPointImages[remappedKey] = image
    })

    const nextSectionImages = {}
    Object.entries(sectionImages).forEach(([key, image]) => {
      const oldSectionIndex = Number(key)
      if (Number.isNaN(oldSectionIndex)) return
      const newSectionIndex = oldToNewSectionIndex[oldSectionIndex]
      if (newSectionIndex === undefined) return
      nextSectionImages[newSectionIndex] = image
    })

    const nextImageReferences = {}
    Object.entries(imageReferences).forEach(([targetKey, sourceKey]) => {
      const remappedTarget = remapFigureKey(targetKey)
      const remappedSource = remapReferenceValue(targetKey, sourceKey, remapFigureKey)
      if (!remappedTarget || !remappedSource) return
      nextImageReferences[remappedTarget] = remappedSource
    })

    const nextImageLayout = {}
    Object.entries(imageLayout || {}).forEach(([sectionKey, layout]) => {
      const oldSectionIndex = Number(sectionKey)
      if (Number.isNaN(oldSectionIndex)) return
      const newSectionIndex = oldToNewSectionIndex[oldSectionIndex]
      if (newSectionIndex === undefined) return

      const safeLayout = layout || {}
      const remappedOrder = Array.isArray(safeLayout.order)
        ? safeLayout.order.map((key) => remapFigureKey(key)).filter(Boolean)
        : []
      const remappedSizes = {}
      Object.entries(safeLayout.sizes || {}).forEach(([key, size]) => {
        const remappedKey = remapFigureKey(key)
        if (remappedKey) remappedSizes[remappedKey] = size
      })
      const remappedSolo = {}
      Object.entries(safeLayout.solo || {}).forEach(([key, enabled]) => {
        const remappedKey = remapFigureKey(key)
        if (remappedKey) remappedSolo[remappedKey] = enabled
      })

      nextImageLayout[newSectionIndex] = {
        ...safeLayout,
        order: remappedOrder,
        sizes: remappedSizes,
        solo: remappedSolo,
      }
    })

    setPointImages(nextPointImages)
    setSectionImages(nextSectionImages)
    setImageReferences(nextImageReferences)
    setImageLayout(nextImageLayout)
    setOpenLayoutControlsKey((prev) => remapFigureKey(prev) || null)

    updateNotes(updated, {
      pointImages: nextPointImages,
      sectionImages: nextSectionImages,
      imageReferences: nextImageReferences,
      imageLayout: nextImageLayout,
    })
    setDraggedSection(null)
    setDropTargetSection(null)
  }

  // ============ IMAGE HELPER FUNCTIONS ============

  // Generate a key for point images (e.g., "0-1" for section 0, point 1)
  const getPointImageKey = (sectionIndex, pointIndex) => `${sectionIndex}-${pointIndex}`
  const getReferenceSourceKeys = (targetKey) => normalizeReferenceKeyList(imageReferences[targetKey])
  const hasReferenceSourceKey = (targetKey, sourceKey) => getReferenceSourceKeys(targetKey).includes(sourceKey)
  const remapReferenceValue = (targetKey, sourceValue, remapFn) => {
    const remapped = normalizeReferenceKeyList(sourceValue)
      .map((key) => remapFn(key))
      .filter(Boolean)
    const unique = [...new Set(remapped)]
    if (unique.length === 0) return null
    return isSectionTitleReferenceTargetKey(targetKey) ? unique : unique[0]
  }

  const getPointImages = (sectionIndex, pointIndex) => {
    const key = getPointImageKey(sectionIndex, pointIndex)
    return normalizePointImageEntry(pointImages[key])
  }

  // Get direct image for a specific point (no reference resolution)
  const getPointImage = (sectionIndex, pointIndex) => {
    return getPointImages(sectionIndex, pointIndex)[0] || null
  }

  // Set image for a specific point
  const setPointImageData = (sectionIndex, pointIndex, imageData, options = {}) => {
    const { imageIndex = null, replace = false } = options
    const key = getPointImageKey(sectionIndex, pointIndex)
    const existing = normalizePointImageEntry(pointImages[key])
    let nextEntry = []
    if (replace && imageIndex !== null && imageIndex >= 0 && imageIndex < existing.length) {
      nextEntry = [...existing]
      nextEntry[imageIndex] = imageData
    } else if (existing.length === 0) {
      nextEntry = [imageData]
    } else {
      nextEntry = [...existing, imageData]
    }
    const valueToStore = nextEntry.length === 1 ? nextEntry[0] : nextEntry
    const nextPointImages = { ...pointImages, [key]: valueToStore }
    const nextImageReferences = { ...imageReferences }
    delete nextImageReferences[key]
    setPointImages(nextPointImages)
    setImageReferences(nextImageReferences)
    setHasChanges(true)
    saveNotesAssets({
      pointImages: nextPointImages,
      imageReferences: nextImageReferences,
      sectionImages,
      imageLayout,
    })
  }

  // Remove image from a specific point
  const removePointImage = (sectionIndex, pointIndex, imageIndex = null) => {
    const key = getPointImageKey(sectionIndex, pointIndex)
    const existing = normalizePointImageEntry(pointImages[key])
    const nextPointImages = { ...pointImages }
    if (imageIndex === null || existing.length <= 1) {
      delete nextPointImages[key]
    } else {
      const remaining = existing.filter((_, idx) => idx !== imageIndex)
      if (remaining.length === 0) {
        delete nextPointImages[key]
      } else {
        nextPointImages[key] = remaining.length === 1 ? remaining[0] : remaining
      }
    }
    const nextImageReferences = { ...imageReferences }
    if (imageIndex === null || existing.length <= 1) {
      delete nextImageReferences[key]
    }
    setPointImages(nextPointImages)
    setImageReferences(nextImageReferences)
    setHasChanges(true)
    saveNotesAssets({
      pointImages: nextPointImages,
      imageReferences: nextImageReferences,
      sectionImages,
      imageLayout,
    })
  }

  // Get section images
  const getSectionImages = (sectionIndex) => {
    return normalizeSectionImageEntry(sectionImages[sectionIndex])
  }

  const getSectionImage = (sectionIndex) => {
    return getSectionImages(sectionIndex)[0] || null
  }

  // Set section image
  const setSectionImageData = (sectionIndex, imageData, options = {}) => {
    const { imageIndex = null, replace = false } = options
    const existing = getSectionImages(sectionIndex)
    let nextEntry = []
    if (replace && imageIndex !== null && imageIndex >= 0 && imageIndex < existing.length) {
      nextEntry = [...existing]
      nextEntry[imageIndex] = imageData
    } else if (existing.length === 0) {
      nextEntry = [imageData]
    } else {
      nextEntry = [...existing, imageData]
    }
    const valueToStore = nextEntry.length === 1 ? nextEntry[0] : nextEntry
    const nextSectionImages = { ...sectionImages, [sectionIndex]: valueToStore }
    setSectionImages(nextSectionImages)
    setHasChanges(true)
    saveNotesAssets({
      pointImages,
      imageReferences,
      sectionImages: nextSectionImages,
      imageLayout,
    })
  }

  // Remove section image
  const removeSectionImage = (sectionIndex, imageIndex = null) => {
    const existing = getSectionImages(sectionIndex)
    const nextSectionImages = { ...sectionImages }
    if (imageIndex === null || existing.length <= 1) {
      delete nextSectionImages[sectionIndex]
    } else {
      const remaining = existing.filter((_, idx) => idx !== imageIndex)
      if (remaining.length === 0) {
        delete nextSectionImages[sectionIndex]
      } else {
        nextSectionImages[sectionIndex] = remaining.length === 1 ? remaining[0] : remaining
      }
    }
    setSectionImages(nextSectionImages)
    setHasChanges(true)
    saveNotesAssets({
      pointImages,
      imageReferences,
      sectionImages: nextSectionImages,
      imageLayout,
    })
  }

  // Build a global figure number map based on display order across all sections
  // Figure numbers follow the order figures appear in the document (respecting layout order within sections)
  const buildGlobalFigureNumberMap = () => {
    const figureNumberMap = new Map() // key -> figureNumber
    let figNum = 0

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si]
      // Collect all figures in this section (without figNum - we'll assign it)
      const sectionFigures = []
      const sectionImgs = getSectionImages(si)
      sectionImgs.forEach((_, sectionImageIndex) => {
        sectionFigures.push({ key: `section-${si}::${sectionImageIndex}` })
      })
      ;(section?.points || []).forEach((_, pointIndex) => {
        const pointImgs = getPointImages(si, pointIndex)
        pointImgs.forEach((_, pointImageIndex) => {
          sectionFigures.push({ key: `${getPointImageKey(si, pointIndex)}::${pointImageIndex}` })
        })
      })

      if (sectionFigures.length === 0) continue

      // Get the display order for this section's figures
      const sectionLayout = imageLayout?.[si]
      const figureKeys = new Set(sectionFigures.map((f) => f.key))
      const orderedKeys = []
      ;(sectionLayout?.order || []).forEach((key) => {
        if (figureKeys.has(key)) orderedKeys.push(key)
      })
      // Add any figures not in the explicit order
      sectionFigures.forEach((fig) => {
        if (!orderedKeys.includes(fig.key)) orderedKeys.push(fig.key)
      })

      // Assign figure numbers in display order
      orderedKeys.forEach((key) => {
        figNum++
        figureNumberMap.set(key, figNum)
      })
    }

    return figureNumberMap
  }

  // Memoize the figure number map to avoid recalculating on every render
  const figureNumberMap = buildGlobalFigureNumberMap()

  // Get figure number for a point or section image by key
  const getFigureNumberByKey = (key) => {
    if (!key) return null
    return figureNumberMap.get(key) || null
  }

  const getFigureNumber = (sectionIndex, pointIndex = null, pointImageIndex = 0) => {
    // Linked point: inherit source figure number only (do not create new figure).
    if (pointIndex !== null) {
      const targetKey = getPointImageKey(sectionIndex, pointIndex)
      const sourceKeys = getReferenceSourceKeys(targetKey)
      if (sourceKeys.length > 0) {
        return getFigureNumberByKey(sourceKeys[0])
      }
    }

    // Build the key for this figure
    let key
    if (pointIndex === null) {
      key = `section-${sectionIndex}::${pointImageIndex}`
    } else {
      key = `${getPointImageKey(sectionIndex, pointIndex)}::${pointImageIndex}`
    }

    return figureNumberMap.get(key) || null
  }

  const getPointFigureNumbers = (sectionIndex, pointIndex) => {
    const key = getPointImageKey(sectionIndex, pointIndex)
    const directImages = normalizePointImageEntry(pointImages[key])
    if (directImages.length > 0) {
      return directImages
        .map((_, idx) => getFigureNumber(sectionIndex, pointIndex, idx))
        .filter((n) => n !== null)
        .sort((a, b) => a - b)
    }

    const refKeys = getReferenceSourceKeys(key)
    if (refKeys.length === 0) return []
    return refKeys
      .map((refKey) => getFigureNumberByKey(refKey))
      .filter((n) => n !== null)
      .sort((a, b) => a - b)
  }

  const collectSectionFigures = (sectionIndex, section) => {
    const sectionFigures = []
    const sectionImgs = getSectionImages(sectionIndex)
    sectionImgs.forEach((sectionImg, sectionImageIndex) => {
      sectionFigures.push({
        type: 'section',
        image: sectionImg,
        figNum: getFigureNumber(sectionIndex, null, sectionImageIndex),
        sectionImageIndex,
        key: `section-${sectionIndex}::${sectionImageIndex}`
      })
    })

    ;(section?.points || []).forEach((_, pointIndex) => {
      const pointImgs = getPointImages(sectionIndex, pointIndex)
      pointImgs.forEach((pointImg, pointImageIndex) => {
        sectionFigures.push({
          type: 'point',
          image: pointImg,
          figNum: getFigureNumber(sectionIndex, pointIndex, pointImageIndex),
          pointIndex,
          pointImageIndex,
          key: `${getPointImageKey(sectionIndex, pointIndex)}::${pointImageIndex}`
        })
      })
    })

    return sectionFigures
  }

  const updateSectionImageLayout = (sectionIndex, updater) => {
    const current = imageLayout?.[sectionIndex] || { order: [], sizes: {}, solo: {} }
    const next = updater(current)
    const nextImageLayout = { ...(imageLayout || {}), [sectionIndex]: next }
    setImageLayout(nextImageLayout)
    setHasChanges(true)
    saveNotesAssets({
      pointImages,
      imageReferences,
      sectionImages,
      imageLayout: nextImageLayout,
    })
  }

  const moveSectionFigure = (sectionIndex, figureKeys, figureKey, direction) => {
    const fromIndex = figureKeys.indexOf(figureKey)
    if (fromIndex < 0) return
    const toIndex = fromIndex + direction
    if (toIndex < 0 || toIndex >= figureKeys.length) return

    const nextOrder = [...figureKeys]
    const [moved] = nextOrder.splice(fromIndex, 1)
    nextOrder.splice(toIndex, 0, moved)

    updateSectionImageLayout(sectionIndex, (current) => ({
      ...current,
      order: nextOrder
    }))
  }

  const setSectionFigureSize = (sectionIndex, figureKey, size) => {
    updateSectionImageLayout(sectionIndex, (current) => ({
      ...current,
      sizes: { ...(current.sizes || {}), [figureKey]: size }
    }))
  }

  const toggleSectionFigureSolo = (sectionIndex, figureKey) => {
    updateSectionImageLayout(sectionIndex, (current) => {
      const nextSolo = { ...(current.solo || {}) }
      if (nextSolo[figureKey]) {
        delete nextSolo[figureKey]
      } else {
        nextSolo[figureKey] = true
      }
      return { ...current, solo: nextSolo }
    })
  }

  const getPointDropId = (sectionIndex, pointIndex) => `point-drop-${sectionIndex}-${pointIndex}`
  const getSectionDropId = (sectionIndex) => `section-drop-${sectionIndex}`

  const parsePointDropId = (id) => {
    const match = String(id || '').match(/^point-drop-(\d+)-(\d+)$/)
    if (!match) return null
    return { sectionIndex: Number(match[1]), pointIndex: Number(match[2]) }
  }

  const parseSectionDropId = (id) => {
    const match = String(id || '').match(/^section-drop-(\d+)$/)
    if (!match) return null
    return { sectionIndex: Number(match[1]) }
  }

  const getPointBaseKeyFromFigureKey = (figureKey) => {
    if (!figureKey || String(figureKey).startsWith('section-')) return null
    const [pointBase] = String(figureKey).split('::')
    return pointBase || null
  }

  const reorderSectionFigureByKey = (sectionIndex, fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return

    const section = sections[sectionIndex]
    if (!section) return
    const figures = collectSectionFigures(sectionIndex, section)
    const normalized = normalizeSectionLayoutForFigures(figures, imageLayout?.[sectionIndex])
    const fromIndex = normalized.order.indexOf(fromKey)
    const toIndex = normalized.order.indexOf(toKey)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    const nextOrder = arrayMove(normalized.order, fromIndex, toIndex)
    updateSectionImageLayout(sectionIndex, (current) => ({
      ...current,
      order: nextOrder
    }))
  }

  const createImageReferenceToPointByKey = (targetSectionIndex, targetPointIndex, sourceFigureKey) => {
    if (!sourceFigureKey) return
    const targetKey = getPointImageKey(targetSectionIndex, targetPointIndex)
    const sourcePointBase = getPointBaseKeyFromFigureKey(sourceFigureKey)

    if (sourcePointBase && sourcePointBase === targetKey) {
      toast.info('Cannot link an image reference to the same bullet point.')
      return
    }

    if (hasReferenceSourceKey(targetKey, sourceFigureKey)) {
      toast.info('This bullet already references that image.')
      return
    }

    const directImages = normalizePointImageEntry(pointImages[targetKey])
    if (directImages.length > 0) {
      const confirmed = window.confirm('This bullet already has a direct image. Replace it with a linked image reference?')
      if (!confirmed) return
    }

    createImageReference(targetSectionIndex, targetPointIndex, sourceFigureKey)
    toast.success('Image linked to bullet point.')
  }

  // Create a reference from a section title to an image
  const createSectionImageReference = (targetSectionIndex, sourceFigureKey) => {
    if (!sourceFigureKey) return
    const targetKey = `section-title-${targetSectionIndex}`

    // Don't allow linking a section to its own section image
    if (sourceFigureKey === `section-${targetSectionIndex}` || String(sourceFigureKey).startsWith(`section-${targetSectionIndex}::`)) {
      toast.info('Cannot link a section to its own section image.')
      return
    }

    const existingSources = getReferenceSourceKeys(targetKey)
    if (existingSources.includes(sourceFigureKey)) {
      toast.info('This section already references that image.')
      return
    }

    const nextImageReferences = {
      ...imageReferences,
      [targetKey]: [...existingSources, sourceFigureKey]
    }
    setImageReferences(nextImageReferences)
    setHasChanges(true)
    saveNotesAssets({
      pointImages,
      imageReferences: nextImageReferences,
      sectionImages,
      imageLayout,
    })
    toast.success('Image linked to section title.')
  }

  // Remove section title image reference
  const removeSectionTitleImageReference = (sectionIndex, sourceFigureKey = null) => {
    const key = `section-title-${sectionIndex}`
    const existingSources = getReferenceSourceKeys(key)
    if (existingSources.length === 0) return

    const nextImageReferences = { ...imageReferences }
    if (!sourceFigureKey) {
      delete nextImageReferences[key]
    } else {
      const remaining = existingSources.filter((candidate) => candidate !== sourceFigureKey)
      if (remaining.length === 0) {
        delete nextImageReferences[key]
      } else {
        nextImageReferences[key] = remaining
      }
    }
    setImageReferences(nextImageReferences)
    setHasChanges(true)
    saveNotesAssets({
      pointImages,
      imageReferences: nextImageReferences,
      sectionImages,
      imageLayout,
    })
  }

  // Get figure number for a section title reference (if linked)
  const getSectionTitleFigureNumber = (sectionIndex) => {
    const key = `section-title-${sectionIndex}`
    const refKeys = getReferenceSourceKeys(key)
    if (refKeys.length === 0) return null
    return getFigureNumberByKey(refKeys[0])
  }

  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 140, tolerance: 8 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const figureCollisionDetection = useCallback((args) => {
    const pointerHits = pointerWithin(args)
    if (!pointerHits || pointerHits.length === 0) {
      return closestCenter(args)
    }

    const pointHits = pointerHits.filter((hit) => String(hit?.id || '').startsWith('point-drop-'))
    if (pointHits.length > 0) {
      return pointHits
    }

    return pointerHits
  }, [])

  const handleFigureDragStart = (event) => {
    const activeId = String(event?.active?.id || '')
    setDraggedFigureKey(activeId || null)
  }

  const handleFigureDragEnd = (event) => {
    const activeId = String(event?.active?.id || '')
    const overId = String(event?.over?.id || '')
    setDraggedFigureKey(null)
    if (!activeId || !overId || activeId === overId) return

    // Check if dropping on a point
    const overDropPoint = parsePointDropId(overId)
    if (overDropPoint) {
      createImageReferenceToPointByKey(overDropPoint.sectionIndex, overDropPoint.pointIndex, activeId)
      return
    }

    // Check if dropping on a section title
    const overDropSection = parseSectionDropId(overId)
    if (overDropSection) {
      createSectionImageReference(overDropSection.sectionIndex, activeId)
      return
    }

    const activeSection = event?.active?.data?.current?.sectionIndex
    const overSection = event?.over?.data?.current?.sectionIndex
    if (!Number.isInteger(activeSection) || !Number.isInteger(overSection)) return
    if (activeSection !== overSection) return

    reorderSectionFigureByKey(activeSection, activeId, overId)
  }

  const handleFigureDragCancel = () => {
    setDraggedFigureKey(null)
  }

  // Create a reference from one point to another point's image
  const createImageReference = (fromSectionIndex, fromPointIndex, toKey) => {
    const fromKey = getPointImageKey(fromSectionIndex, fromPointIndex)
    // Linking should not keep or create a second direct image at this point.
    const nextPointImages = { ...pointImages }
    delete nextPointImages[fromKey]
    const existingSources = getReferenceSourceKeys(fromKey)
    const nextSources = [...new Set([...existingSources, toKey])]
    const nextImageReferences = {
      ...imageReferences,
      [fromKey]: nextSources
    }
    setPointImages(nextPointImages)
    setImageReferences(nextImageReferences)
    setHasChanges(true)
    saveNotesAssets({
      pointImages: nextPointImages,
      imageReferences: nextImageReferences,
      sectionImages,
      imageLayout,
    })
  }

  const removePointImageReference = (sectionIndex, pointIndex, sourceKey = null) => {
    const key = getPointImageKey(sectionIndex, pointIndex)
    const existingSources = getReferenceSourceKeys(key)
    if (existingSources.length === 0) return

    const nextImageReferences = { ...imageReferences }
    if (!sourceKey) {
      delete nextImageReferences[key]
    } else {
      const remaining = existingSources.filter((candidate) => candidate !== sourceKey)
      if (remaining.length === 0) {
        delete nextImageReferences[key]
      } else {
        nextImageReferences[key] = remaining
      }
    }
    setImageReferences(nextImageReferences)
    setHasChanges(true)
    saveNotesAssets({
      pointImages,
      imageReferences: nextImageReferences,
      sectionImages,
      imageLayout,
    })
  }

  const removePointFigureAssociation = (sectionIndex, pointIndex, pointImageIndex) => {
    const pointKey = getPointImageKey(sectionIndex, pointIndex)
    const existingImages = normalizePointImageEntry(pointImages[pointKey])
    if (pointImageIndex < 0 || pointImageIndex >= existingImages.length) return

    const sourceKey = `${pointKey}::${pointImageIndex}`
    const referenceTargets = Object.entries(imageReferences)
      .filter(([, refSource]) => normalizeReferenceKeyList(refSource).includes(sourceKey))
      .map(([targetKey]) => targetKey)

    // No external references: removing association is equivalent to removing this image.
    if (referenceTargets.length === 0) {
      removePointImage(sectionIndex, pointIndex, pointImageIndex)
      return
    }

    const imageToRehome = existingImages[pointImageIndex]
    const nextPointImages = { ...pointImages }
    const nextImageReferences = { ...imageReferences }

    const remainingAtSource = existingImages.filter((_, idx) => idx !== pointImageIndex)
    if (remainingAtSource.length === 0) {
      delete nextPointImages[pointKey]
    } else {
      nextPointImages[pointKey] = remainingAtSource.length === 1 ? remainingAtSource[0] : remainingAtSource
    }

    // Promote one referenced bullet to become the new direct owner, then repoint all references.
    const newOwnerKey = referenceTargets[0]
    const ownerExisting = normalizePointImageEntry(nextPointImages[newOwnerKey])
    const newOwnerIndex = ownerExisting.length
    const ownerNext = [...ownerExisting, imageToRehome]
    nextPointImages[newOwnerKey] = ownerNext.length === 1 ? ownerNext[0] : ownerNext
    delete nextImageReferences[newOwnerKey]

    const newSourceKey = `${newOwnerKey}::${newOwnerIndex}`
    Object.entries(nextImageReferences).forEach(([targetKey, refSource]) => {
      const refs = normalizeReferenceKeyList(refSource)
      if (refs.length === 0 || !refs.includes(sourceKey)) return
      const replaced = refs.map((ref) => (ref === sourceKey ? newSourceKey : ref))
      const uniqueReplaced = [...new Set(replaced)]
      nextImageReferences[targetKey] = isSectionTitleReferenceTargetKey(targetKey) ? uniqueReplaced : uniqueReplaced[0]
    })

    setPointImages(nextPointImages)
    setImageReferences(nextImageReferences)
    setHasChanges(true)
    saveNotesAssets({
      pointImages: nextPointImages,
      imageReferences: nextImageReferences,
      sectionImages,
      imageLayout,
    })
  }

  // Handle slide selection from ImagePickerModal - fetch high-res version
  const handleSelectSlide = async (pageNum) => {
    if (!imagePickerOpen) return

    // Store the target info before closing picker
    const targetInfo = {
      targetKey: imagePickerOpen.pointIndex !== undefined
        ? getPointImageKey(imagePickerOpen.sectionIndex, imagePickerOpen.pointIndex)
        : null,
      targetType: imagePickerOpen.pointIndex !== undefined ? 'point' : 'section',
      sectionIndex: imagePickerOpen.sectionIndex,
      pointIndex: imagePickerOpen.pointIndex
    }
    setImagePickerOpen(null)

    // Check if this is an uploaded image (not from PDF slides)
    const thumbnailIndex = pageNum - 1
    const selectedThumbnail = pdfThumbnails[thumbnailIndex]

    if (selectedThumbnail && selectedThumbnail.id?.startsWith('uploaded-')) {
      // This is an uploaded image - use it directly without fetching from PDF
      // Create an image to get dimensions
      const img = new window.Image()
      img.src = selectedThumbnail.dataUrl
      await new Promise((resolve) => {
        img.onload = resolve
      })

      setCropModalOpen({
        pageNum: null, // No pageNum for uploaded images
        isUploaded: true, // Mark as uploaded
        dataUrl: selectedThumbnail.dataUrl,
        width: img.width,
        height: img.height,
        launchedFromPicker: true,
        ...targetInfo
      })
      return
    }

    // Show loading state while fetching high-res image from PDF
    setLoadingHighRes(true)

    try {
      // Fetch high-resolution version of the slide
      const highResImage = await getFullSizeSlideImage(pageNum)
      if (!highResImage) {
        toast.error('Failed to load high-resolution slide')
        return
      }

      // Open crop modal with the high-res slide
      setCropModalOpen({
        pageNum,
        dataUrl: highResImage.dataUrl,
        width: highResImage.width,
        height: highResImage.height,
        launchedFromPicker: true,
        ...targetInfo
      })
    } finally {
      setLoadingHighRes(false)
    }
  }

  // Handle existing image selection (creates a reference)
  const handleSelectExisting = (sourceKey) => {
    if (!imagePickerOpen || imagePickerOpen.pointIndex === undefined) return

    createImageReference(imagePickerOpen.sectionIndex, imagePickerOpen.pointIndex, sourceKey)
    setImagePickerOpen(null)
  }

  // Handle crop modal confirmation
  const handleCropConfirm = (imageData) => {
    if (!cropModalOpen) return

    if (cropModalOpen.targetType === 'point') {
      setPointImageData(cropModalOpen.sectionIndex, cropModalOpen.pointIndex, imageData, {
        imageIndex: cropModalOpen.pointImageIndex ?? null,
        replace: cropModalOpen.pointImageIndex !== undefined && cropModalOpen.pointImageIndex !== null
      })
    } else {
      setSectionImageData(cropModalOpen.sectionIndex, imageData, {
        imageIndex: cropModalOpen.pointImageIndex ?? null,
        replace: cropModalOpen.pointImageIndex !== undefined && cropModalOpen.pointImageIndex !== null
      })
    }

    setCropModalOpen(null)
  }

  const handleBackToImagePicker = () => {
    if (!cropModalOpen) return

    const pickerState = cropModalOpen.pointIndex !== undefined
      ? { sectionIndex: cropModalOpen.sectionIndex, pointIndex: cropModalOpen.pointIndex }
      : { sectionIndex: cropModalOpen.sectionIndex }

    setCropModalOpen(null)
    setImagePickerOpen(pickerState)
  }

  // Handle editing an existing image - opens crop modal with saved annotations
  const handleEditExistingImage = async (sectionIndex, pointIndex = null, pointImageIndex = null) => {
    const imageData = pointIndex !== null
      ? getPointImages(sectionIndex, pointIndex)[pointImageIndex ?? 0]
      : getSectionImages(sectionIndex)[pointImageIndex ?? 0]

    if (!imageData) return

    // If we have originalDataUrl (image was saved with edit data), use it directly
    if (imageData.originalDataUrl) {
      setCropModalOpen({
        pageNum: imageData.pageNum,
        isUploaded: imageData.isUploaded,
        dataUrl: imageData.originalDataUrl,
        width: imageData.originalWidth,
        height: imageData.originalHeight,
          targetType: pointIndex !== null ? 'point' : 'section',
          sectionIndex,
          pointIndex,
          pointImageIndex,
          initialAnnotations: imageData.annotations || [],
          initialCropArea: imageData.cropArea || null
        })
    } else if (imageData.pageNum) {
      // Legacy image without edit data - fetch the slide fresh
      setLoadingHighRes(true)
      try {
        const highResImage = await getFullSizeSlideImage(imageData.pageNum)
        if (highResImage) {
          setCropModalOpen({
            pageNum: imageData.pageNum,
            dataUrl: highResImage.dataUrl,
            width: highResImage.width,
            height: highResImage.height,
            targetType: pointIndex !== null ? 'point' : 'section',
            sectionIndex,
            pointIndex,
            pointImageIndex,
            initialAnnotations: [],
            initialCropArea: null
          })
        }
      } finally {
        setLoadingHighRes(false)
      }
    } else {
      // No pageNum - can't re-edit, open picker instead
      if (pointIndex !== null) {
        setImagePickerOpen({ sectionIndex, pointIndex })
      }
    }
  }

  // Get full-size image data for crop modal (re-render at higher resolution)
  const getFullSizeSlideImage = async (pageNum) => {
    try {
      // Use cached PDF if available (much faster!)
      let pdf = cachedPdfRef.current

      // If not cached, download and cache it
      if (!pdf && lecture.pdf_path) {
        const { data: pdfBlob, error } = await supabase.storage
          .from('lecture-pdfs')
          .download(lecture.pdf_path)

        if (error) {
          return null
        }

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const pdfjsLib = await getPdfJsLib()
        pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        cachedPdfRef.current = pdf
      }

      if (!pdf) {
        return null
      }

      const page = await pdf.getPage(pageNum)

      const mobileMode = isIOSLikeDevice()
      // Render at lower scale on iOS to avoid Safari memory spikes; keep desktop unchanged.
      let scale = mobileMode ? 1.35 : 2.0
      let viewport = page.getViewport({ scale })

      // Check if canvas would be too large.
      const maxDimension = mobileMode ? 2200 : 3000
      if (viewport.width > maxDimension || viewport.height > maxDimension) {
        const reductionFactor = Math.min(maxDimension / viewport.width, maxDimension / viewport.height)
        scale = scale * reductionFactor
        viewport = page.getViewport({ scale })
      }

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')

      await page.render({
        canvasContext: ctx,
        viewport
      }).promise

      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)

      return {
        dataUrl,
        pageNum,
        width: viewport.width,
        height: viewport.height
      }
    } catch {
      return null
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-divider">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                disabled={saving}
                className={`p-2 rounded-lg transition-colors ${saving ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-100'}`}
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
              <button
                onClick={handleExportPDF}
                disabled={exportingPdf}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
                title="Export as PDF (can be re-imported later)"
              >
                <Download className="w-4 h-4" />
                {exportingPdf ? 'Exporting...' : 'Export PDF'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="text-xs text-secondary">
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Save failed' : 'Saved'}
        </div>

        {/* Learning Objectives Card */}
        {learningObjectives.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="flex items-center mb-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-accent" />
                <h2 className="font-semibold text-accent">Learning Objectives</h2>
              </div>
            </div>
            <ul className="space-y-2">
              {learningObjectives.map((objective, index) => (
                <li key={objective.id || index}>
                  <div className="flex items-start gap-3 w-full text-left p-2 rounded-lg">
                    <Circle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <span className="text-sm leading-relaxed text-primary">
                      {objective.text}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes Sections */}
        <DndContext
          sensors={dndSensors}
          collisionDetection={figureCollisionDetection}
          onDragStart={handleFigureDragStart}
          onDragEnd={handleFigureDragEnd}
          onDragCancel={handleFigureDragCancel}
        >
        <div className="space-y-4">
          {sections.map((section, sectionIndex) => (
            <div
              key={sectionIndex}
              className={`bg-surface rounded-xl border border-divider overflow-hidden ${
                dropTargetSection === sectionIndex && draggedSection !== sectionIndex ? 'ring-2 ring-accent' : ''
              }`}
              onDragOver={(e) => handleSectionDragOver(e, sectionIndex)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleSectionDrop(sectionIndex)}
            >
              {/* Section Header */}
              <div className="px-5 py-4 border-b border-divider bg-gray-50/50 group flex items-center gap-3">
                <div
                  draggable={!editingNote}
                  onDragStart={(e) => handleSectionDragStart(e, sectionIndex)}
                  onDragEnd={handleDragEnd}
                  className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <GripVertical className="w-5 h-5 text-gray-400" />
                </div>

                {editingNote?.type === 'section' && editingNote.sectionIndex === sectionIndex ? (
                  <div className="flex-1 space-y-2 relative">
                    <SectionTitleDropTarget
                      id={getSectionDropId(sectionIndex)}
                      enabled={!!draggedFigureKey}
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editingNote.value}
                        onChange={(e) => setEditingNote(p => ({ ...p, value: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && saveNoteEdit()}
                        className="flex-1 font-semibold bg-white border border-divider rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                        autoFocus
                      />
                      <button onClick={saveNoteEdit} className="px-3 py-1 bg-accent hover:bg-blue-600 text-white rounded-lg text-sm">Save</button>
                      <button onClick={() => setEditingNote(null)} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-primary rounded-lg text-sm">Cancel</button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-secondary">Figure References</label>
                      <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-gray-50 border border-divider rounded-lg">
                        {(() => {
                          const sectionTitleRefKeys = getReferenceSourceKeys(`section-title-${sectionIndex}`)
                          const directSectionRefKeys = getSectionImages(sectionIndex).map((_, sectionImageIndex) => `section-${sectionIndex}::${sectionImageIndex}`)
                          if (sectionTitleRefKeys.length === 0 && directSectionRefKeys.length === 0) {
                            return (
                              <span className="text-xs text-secondary">
                                Drag figures onto this section title to link them.
                              </span>
                            )
                          }
                          return (
                            <>
                              {directSectionRefKeys.map((refKey, sectionImageIndex) => {
                                const figNum = getFigureNumberByKey(refKey)
                                if (!figNum) return null
                                return (
                                  <span key={refKey} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs rounded-full">
                                    Fig {figNum}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        removeSectionImage(sectionIndex, sectionImageIndex)
                                      }}
                                      className="w-3.5 h-3.5 flex items-center justify-center hover:bg-indigo-100 rounded-full"
                                      title="Remove figure reference"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                )
                              })}
                              {sectionTitleRefKeys.map((refKey) => {
                                const figNum = getFigureNumberByKey(refKey)
                                if (!figNum) return null
                                return (
                                  <span key={refKey} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs rounded-full">
                                    Fig {figNum}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        removeSectionTitleImageReference(sectionIndex, refKey)
                                      }}
                                      className="w-3.5 h-3.5 flex items-center justify-center hover:bg-indigo-100 rounded-full"
                                      title="Remove linked figure"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                )
                              })}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 flex items-center gap-2 relative">
                      <SectionTitleDropTarget
                        id={getSectionDropId(sectionIndex)}
                        enabled={!!draggedFigureKey}
                      />
                      <h3 className="font-semibold text-primary text-lg">
                        {section.section}
                      </h3>
                      {/* Section's own image figure references */}
                      {getSectionImages(sectionIndex).map((_, sectionImageIndex) => {
                        const directKey = `section-${sectionIndex}::${sectionImageIndex}`
                        const figNum = getFigureNumberByKey(directKey)
                        if (!figNum) return null
                        return (
                          <span key={directKey} className="text-indigo-500 text-xs font-medium">
                            (Fig {figNum})
                          </span>
                        )
                      })}
                      {/* Linked figure references for section title */}
                      {(() => {
                        const sectionTitleRefKeys = getReferenceSourceKeys(`section-title-${sectionIndex}`)
                        if (sectionTitleRefKeys.length === 0) return null
                        return (
                          <>
                            {sectionTitleRefKeys.map((refKey) => {
                              const figNum = getFigureNumberByKey(refKey)
                              if (!figNum) return null
                              return (
                                <span key={refKey} className="text-indigo-500 text-xs font-medium">
                                  (Fig {figNum})
                                </span>
                              )
                            })}
                          </>
                        )
                      })()}
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                      <button
                        onClick={() => startEditSection(sectionIndex)}
                        className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg"
                        title="Edit section title"
                      >
                        <Edit2 className="w-4 h-4 text-secondary" />
                      </button>
                      <button
                        onClick={() => addPoint(sectionIndex)}
                        className="p-1.5 bg-gray-100 hover:bg-blue-100 hover:text-accent rounded-lg"
                        title="Add point"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openImagePickerOrExplain({ sectionIndex })}
                        className={`p-1.5 rounded-lg ${
                          !canInsertFromSlides || thumbnailsLoading || uploadingSlides
                            ? 'bg-gray-100 text-gray-400 cursor-help'
                            : 'bg-gray-100 hover:bg-indigo-100 hover:text-indigo-600'
                        }`}
                        title={!canInsertFromSlides || thumbnailsLoading || uploadingSlides
                          ? getImageInsertionUnavailableReason()
                          : "Insert section image from slides"
                        }
                      >
                        <Image className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteSection(sectionIndex)}
                        className="p-1.5 bg-gray-100 hover:bg-red-100 hover:text-red-600 rounded-lg"
                        title="Delete section"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Section Points */}
              {section.points && section.points.length > 0 && (
                <div className="p-5">
                  <ul className="space-y-2">
                    {section.points.map((point, pointIndex) => (
                      (() => {
                        const pointLevel = getPointLevel(sectionIndex, pointIndex)
                        const pointKey = getPointImageKey(sectionIndex, pointIndex)
                        const imageReferenceKeys = getReferenceSourceKeys(pointKey)
                        const directPointImages = getPointImages(sectionIndex, pointIndex)
                        const directFigureBubbles = directPointImages
                          .map((_, imageIndex) => {
                            const figNum = getFigureNumber(sectionIndex, pointIndex, imageIndex)
                            if (!figNum) return null
                            const sourceKey = `${pointKey}::${imageIndex}`
                            const isShared = Object.values(imageReferences).some((refSource) => normalizeReferenceKeyList(refSource).includes(sourceKey))
                            return {
                              id: sourceKey,
                              label: `Fig ${figNum}`,
                              isShared,
                              onRemove: () => removePointFigureAssociation(sectionIndex, pointIndex, imageIndex)
                            }
                          })
                          .filter(Boolean)
                        const linkedFigureBubbles = imageReferenceKeys
                          .map((refKey) => {
                            const figNum = getFigureNumberByKey(refKey)
                            return figNum ? { id: refKey, label: `Fig ${figNum}`, figNum } : null
                          })
                          .filter(Boolean)
                          .sort((a, b) => a.figNum - b.figNum)
                        return (
                      <li
                        key={pointIndex}
                        className="relative text-sm text-primary border-l-2 border-accent/30 py-2 group flex items-start gap-2"
                        style={{ marginLeft: `${pointLevel * 18}px`, paddingLeft: '12px' }}
                        onDragOver={(e) => handlePointDragOver(e, sectionIndex, pointIndex)}
                        onDragLeave={handleDragLeave}
                        onDrop={() => handleDrop(sectionIndex, pointIndex)}
                      >
                        {dropTargetPoint?.sectionIndex === sectionIndex &&
                          dropTargetPoint?.pointIndex === pointIndex &&
                          !(draggedPoint?.sectionIndex === sectionIndex && draggedPoint?.pointIndex === pointIndex) && (
                            <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-accent rounded-full pointer-events-none" />
                          )}
                        <PointImageLinkDropTarget
                          id={getPointDropId(sectionIndex, pointIndex)}
                          enabled={!!draggedFigureKey}
                        />
                        {editingNote?.type === 'point' && editingNote.sectionIndex === sectionIndex && editingNote.pointIndex === pointIndex ? (
                          <div className="flex-1 space-y-2">
                            {/* Formatting Toolbar */}
                            <div
                              className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-lg border border-gray-200 mb-2"
                              onMouseDown={(e) => {
                                if (e.target instanceof Element && e.target.closest('button')) {
                                  e.preventDefault()
                                }
                              }}
                            >
                              <div className="text-xs text-secondary w-full mb-1">Format text:</div>
                              <button type="button" onClick={() => insertFormatting('bold')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs font-bold" title="Bold">B</button>
                              <button type="button" onClick={() => insertFormatting('italic')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs italic" title="Italic">I</button>
                              <button type="button" onClick={() => insertFormatting('underline')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs underline" title="Underline">U</button>
                              <button type="button" onClick={() => insertFormatting('superscript')} className={`px-2 py-1 rounded text-xs border ${activeFormatting.superscript ? 'bg-accent text-white border-accent' : 'bg-white hover:bg-gray-100 border-gray-200'}`} title="Superscript">X<sup>2</sup></button>
                              <button type="button" onClick={() => insertFormatting('subscript')} className={`px-2 py-1 rounded text-xs border ${activeFormatting.subscript ? 'bg-accent text-white border-accent' : 'bg-white hover:bg-gray-100 border-gray-200'}`} title="Subscript">X<sub>2</sub></button>
                              <button type="button" onClick={insertBullet} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="Bullet list">•</button>
                              <span className="border-l border-gray-300 mx-1"></span>
                              <button type="button" onClick={() => insertSymbol('α')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="alpha">α</button>
                              <button type="button" onClick={() => insertSymbol('β')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="beta">β</button>
                              <button type="button" onClick={() => insertSymbol('Δ')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="Delta">Δ</button>
                              <button type="button" onClick={() => insertSymbol('μ')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="mu">μ</button>
                              <button type="button" onClick={() => insertSymbol('→')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="right arrow">→</button>
                              <button type="button" onClick={() => insertSymbol('←')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="left arrow">←</button>
                              <button type="button" onClick={() => insertSymbol('↑')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="up arrow">↑</button>
                              <button type="button" onClick={() => insertSymbol('↓')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="down arrow">↓</button>
                              <button type="button" onClick={() => insertSymbol('≥')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="greater than or equal">≥</button>
                              <button type="button" onClick={() => insertSymbol('≤')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="less than or equal">≤</button>
                              <button type="button" onClick={() => insertSymbol('±')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="plus or minus">±</button>
                              <button type="button" onClick={() => insertSymbol('≈')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="approximately equal">≈</button>
                              <button type="button" onClick={() => insertSymbol('°')} className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded text-xs" title="degree">°</button>
                            </div>
                            {/* ContentEditable Editor */}
                            <div
                              ref={(el) => {
                                textareaRef.current = el
                                if (el && !isFormattingRef.current && el.innerHTML !== editingNote.value) {
                                  el.innerHTML = editingNote.value || ''
                                  // Set cursor at end
                                  const range = document.createRange()
                                  const sel = window.getSelection()
                                  if (el.childNodes.length > 0) {
                                    const lastChild = el.childNodes[el.childNodes.length - 1]
                                    const lastNode = lastChild.nodeType === Node.TEXT_NODE ? lastChild : lastChild.lastChild || lastChild
                                    try {
                                      range.setStart(lastNode, lastNode.textContent?.length || 0)
                                      range.collapse(true)
                                      sel.removeAllRanges()
                                      sel.addRange(range)
                                    } catch (e) {
                                      // Ignore if cursor positioning fails
                                    }
                                  }
                                }
                              }}
                              contentEditable
                              suppressContentEditableWarning
                              onInput={(e) => {
                                const html = e.currentTarget.innerHTML
                                setEditingNote(p => ({ ...p, value: html }))
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault()
                                  const html = e.currentTarget.innerHTML
                                  setEditingNote(p => ({ ...p, value: html }))
                                  saveNoteEdit()
                                }
                                if (e.key === 'Tab') {
                                  e.preventDefault()
                                  if (e.shiftKey) {
                                    document.execCommand('outdent')
                                  } else {
                                    document.execCommand('indent')
                                  }
                                }
                                if (e.key === 'Backspace') {
                                  const sel = window.getSelection()
                                  if (sel && sel.rangeCount > 0) {
                                    const range = sel.getRangeAt(0)
                                    if (range.collapsed) {
                                      let node = range.startContainer
                                      let blockquote = null

                                      while (node && node !== e.currentTarget) {
                                        if (node.nodeName === 'BLOCKQUOTE') {
                                          blockquote = node
                                          break
                                        }
                                        node = node.parentNode
                                      }

                                      if (blockquote) {
                                        let textBeforeCursor = ''
                                        if (range.startContainer.nodeType === Node.TEXT_NODE) {
                                          textBeforeCursor = range.startContainer.textContent.substring(0, range.startOffset)
                                        }

                                        if (textBeforeCursor.trim() === '') {
                                          e.preventDefault()
                                          document.execCommand('outdent')
                                        }
                                      }
                                    }
                                  }
                                }
                              }}
                              className="w-full notes-content bg-white border border-divider rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent min-h-[80px] max-h-[300px] overflow-y-auto"
                              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                            />
                            {(directFigureBubbles.length > 0 || linkedFigureBubbles.length > 0) && (
                              <div className="space-y-2">
                                <label className="text-xs text-secondary">Figure References</label>
                                <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-gray-50 border border-divider rounded-lg">
                                  {directFigureBubbles.map((bubble) => (
                                    <span
                                      key={bubble.id}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs rounded-full"
                                      title={bubble.isShared ? 'Shared figure. Removing here will keep the image linked elsewhere.' : 'Remove this figure from this bullet.'}
                                    >
                                      {bubble.label}
                                      <button
                                        type="button"
                                        onClick={bubble.onRemove}
                                        className="w-3.5 h-3.5 flex items-center justify-center hover:bg-indigo-100 rounded-full"
                                        title="Remove figure reference"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </span>
                                  ))}
                                  {linkedFigureBubbles.map((bubble) => (
                                    <span key={bubble.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs rounded-full">
                                      {bubble.label}
                                      <button
                                        type="button"
                                        onClick={() => removePointImageReference(sectionIndex, pointIndex, bubble.id)}
                                        className="w-3.5 h-3.5 flex items-center justify-center hover:bg-indigo-100 rounded-full"
                                        title="Remove figure reference"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button onClick={saveNoteEdit} className="px-3 py-1 bg-accent hover:bg-blue-600 text-white rounded-lg text-sm">Save</button>
                              <button onClick={() => setEditingNote(null)} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-primary rounded-lg text-sm">Cancel</button>
                              <span className="text-xs text-secondary ml-auto self-center">Ctrl+Enter to save</span>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span
                              draggable={!editingNote}
                              onDragStart={(e) => handleDragStart(e, sectionIndex, pointIndex)}
                              onDragEnd={handleDragEnd}
                              className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                            >
                              <GripVertical className="w-4 h-4 text-gray-400" />
                            </span>
                            <div className="flex-1">
                              <div
                                className="notes-content leading-relaxed"
                                dangerouslySetInnerHTML={{
                                  __html: buildPointHtmlWithFigureRefs(point, getPointFigureNumbers(sectionIndex, pointIndex), pointLevel),
                                }}
                              />
                            </div>
                            <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity flex-shrink-0">
                              <button
                                onClick={() => startEditPoint(sectionIndex, pointIndex)}
                                className="p-1 bg-gray-100 hover:bg-gray-200 rounded"
                                title="Edit point"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-secondary" />
                                </button>
                              <button
                                onClick={() => addSubPoint(sectionIndex, pointIndex)}
                                className="p-1 bg-gray-100 hover:bg-blue-100 hover:text-accent rounded"
                                title="Add sub-bullet point"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => openImagePickerOrExplain({ sectionIndex, pointIndex })}
                                className={`p-1 rounded ${
                                  !canInsertFromSlides || thumbnailsLoading || uploadingSlides
                                    ? 'bg-gray-100 text-gray-400 cursor-help'
                                    : 'bg-gray-100 hover:bg-indigo-100 hover:text-indigo-600'
                                }`}
                                title={!canInsertFromSlides || thumbnailsLoading || uploadingSlides
                                  ? getImageInsertionUnavailableReason()
                                  : "Insert image from slides"
                                }
                              >
                                <Image className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deletePoint(sectionIndex, pointIndex)}
                                className="p-1 bg-gray-100 hover:bg-red-100 hover:text-red-600 rounded"
                                title="Delete point"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </li>
                        )
                      })()
                    ))}
                  </ul>

                  {/* Section Images Layout - shared model with PDF export */}
                  {(() => {
                    const sectionFigures = collectSectionFigures(sectionIndex, section)
                    if (sectionFigures.length === 0) return null

                    const sectionLayout = imageLayout?.[sectionIndex]
                    const { rows, layout } = computeFigureRows(sectionFigures, sectionLayout, {
                      maxRowWidth: 780,
                      columnGap: 14,
                      maxItemsPerRow: 4,
                      minRowHeight: 95,
                      maxRowHeight: 250,
                      targetRowHeight: 140,
                      singletonMinHeight: 124,
                      singletonMaxHeight: 210,
                      singletonTargetHeight: 152,
                      autoSoloAspect: 3.8
                    })
                    const orderedKeys = layout.order

                    const renderFigureCard = (fig, width, height) => {
                      const currentSize = layout.sizes?.[fig.key] || IMAGE_LAYOUT_DEFAULT
                      const isSoloPinned = !!layout.solo?.[fig.key]
                      const itemIndex = orderedKeys.indexOf(fig.key)
                      const isFirst = itemIndex <= 0
                      const isLast = itemIndex === orderedKeys.length - 1
                      const controlsOpen = openLayoutControlsKey === fig.key

                      return (
                        <SortableFigureCard
                          key={fig.key}
                          id={fig.key}
                          sectionIndex={sectionIndex}
                          draggingEnabled={!editingNote}
                          className="relative group/img touch-none"
                        >
                          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                            <img
                              src={fig.image.dataUrl}
                              alt={`Figure ${fig.figNum}`}
                              style={{ width: `${Math.round(width)}px`, height: `${Math.round(height)}px`, maxWidth: '100%' }}
                              className="rounded shadow-sm mx-auto block object-contain"
                            />
                            <div className="text-center mt-2 text-xs text-indigo-600 font-medium">
                              Fig {fig.figNum}
                              {fig.image.isUploaded ? (
                                <span className="text-gray-500 ml-1">(Uploaded)</span>
                              ) : fig.image.pageNum && (
                                <span className="text-gray-500 ml-1">(Slide {fig.image.pageNum})</span>
                              )}
                            </div>
                          </div>
                          <div className="absolute top-4 right-4 opacity-0 group-hover/img:opacity-100 flex gap-1 justify-end transition-opacity">
                            <button
                              onClick={() => setOpenLayoutControlsKey((prev) => (prev === fig.key ? null : fig.key))}
                              className={`p-1.5 rounded-lg shadow-md border ${controlsOpen ? 'bg-indigo-50 border-indigo-200' : 'bg-white/95 border-gray-200 hover:bg-white'}`}
                              title="Layout controls"
                            >
                              <SlidersHorizontal className={`w-4 h-4 ${controlsOpen ? 'text-indigo-600' : 'text-gray-600'}`} />
                            </button>
                            <button
                              onClick={() => {
                                if (fig.type === 'point') {
                                  handleEditExistingImage(sectionIndex, fig.pointIndex, fig.pointImageIndex)
                                } else {
                                  handleEditExistingImage(sectionIndex, null, fig.sectionImageIndex)
                                }
                              }}
                              className="p-1.5 bg-white/95 hover:bg-white rounded-lg shadow-md border border-gray-200"
                              title="Edit image"
                            >
                              <Edit2 className="w-4 h-4 text-gray-600" />
                            </button>
                            <button
                              onClick={() => {
                                if (fig.type === 'point') {
                                  removePointImage(sectionIndex, fig.pointIndex, fig.pointImageIndex)
                                } else {
                                  removeSectionImage(sectionIndex, fig.sectionImageIndex)
                                }
                              }}
                              className="p-1.5 bg-white/95 hover:bg-red-50 rounded-lg shadow-md border border-gray-200"
                              title="Remove image"
                            >
                              <X className="w-4 h-4 text-red-500" />
                            </button>
                          </div>
                          {controlsOpen && (
                            <div className="absolute top-14 right-4 bg-white/95 border border-gray-200 rounded-lg shadow-md p-2 flex flex-wrap gap-1 z-10">
                              <button
                                onClick={() => moveSectionFigure(sectionIndex, orderedKeys, fig.key, -1)}
                                disabled={isFirst}
                                className="p-1.5 bg-white hover:bg-gray-50 rounded border border-gray-200 disabled:opacity-40"
                                title="Move earlier"
                              >
                                <ChevronLeft className="w-4 h-4 text-gray-600" />
                              </button>
                              <button
                                onClick={() => moveSectionFigure(sectionIndex, orderedKeys, fig.key, 1)}
                                disabled={isLast}
                                className="p-1.5 bg-white hover:bg-gray-50 rounded border border-gray-200 disabled:opacity-40"
                                title="Move later"
                              >
                                <ChevronRight className="w-4 h-4 text-gray-600" />
                              </button>
                              {['s', 'm', 'l'].map((sizeOption) => (
                                <button
                                  key={`${fig.key}-${sizeOption}`}
                                  onClick={() => setSectionFigureSize(sectionIndex, fig.key, sizeOption)}
                                  className={`px-2 py-1 text-xs rounded border ${currentSize === sizeOption ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                                  title={`Set size ${sizeOption.toUpperCase()}`}
                                >
                                  {sizeOption.toUpperCase()}
                                </button>
                              ))}
                              <button
                                onClick={() => toggleSectionFigureSolo(sectionIndex, fig.key)}
                                className={`px-2 py-1 text-xs rounded border ${isSoloPinned ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                                title="Toggle own row"
                              >
                                Solo
                              </button>
                            </div>
                          )}
                        </SortableFigureCard>
                      )
                    }

                    return (
                      <div className="mt-6 pt-4 border-t border-gray-100">
                        <SortableContext items={orderedKeys} strategy={rectSortingStrategy}>
                        <div className="space-y-4">
                          {rows.map((row, rowIndex) => (
                            <div
                              key={`row-${sectionIndex}-${rowIndex}`}
                              className={`flex gap-3 ${row.items.length === 1 ? 'justify-center' : 'items-start'}`}
                            >
                              {row.items.map((item) => renderFigureCard(item.fig, item.width, item.height))}
                            </div>
                          ))}
                        </div>
                        </SortableContext>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          ))}

          {/* Add Section Button */}
          <button
            onClick={addSection}
            className="w-full py-4 border-2 border-dashed border-gray-300 hover:border-accent hover:bg-blue-50/50 rounded-xl text-secondary hover:text-accent font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Section
          </button>
        </div>
        </DndContext>

        {/* Empty state */}
        {sections.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-2xl mb-4">
              <FileText className="w-8 h-8 text-secondary" />
            </div>
            <h2 className="text-xl font-semibold text-primary mb-2">No notes generated yet</h2>
            <p className="text-secondary">Upload a PDF to generate notes for this lecture.</p>
          </div>
        )}

        <div className="h-8" />
      </div>

      {/* Image Picker Modal */}
      <ImagePickerModal
        isOpen={!!imagePickerOpen}
        onClose={() => setImagePickerOpen(null)}
        thumbnails={pdfThumbnails}
        pdfPageCount={pdfPageCount}
        loadSlideThumbnail={loadSlideThumbnailByPage}
        thumbnailsLoading={thumbnailsLoading}
        existingImages={pointImages}
        onSelectSlide={handleSelectSlide}
        onSelectExisting={handleSelectExisting}
        onUploadImages={handleImageUploadFiles}
        uploadingImages={uploadingImages}
        currentKey={imagePickerOpen && imagePickerOpen.pointIndex !== undefined
          ? getPointImageKey(imagePickerOpen.sectionIndex, imagePickerOpen.pointIndex)
          : null}
        notes={notes}
        getSectionImage={getSectionImage}
        getPointImages={getPointImages}
        getPointImage={getPointImage}
        getPointImageKey={getPointImageKey}
        getFigureNumberByKey={getFigureNumberByKey}
      />

      {/* Loading overlay for high-res image fetch */}
      {loadingHighRes && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl px-8 py-6 flex items-center gap-4">
            <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
            <span className="text-gray-700 font-medium">Loading high-resolution slide...</span>
          </div>
        </div>
      )}

      {/* Crop Modal */}
      <CropModal
        isOpen={!!cropModalOpen}
        onClose={() => setCropModalOpen(null)}
        onBack={cropModalOpen?.launchedFromPicker ? handleBackToImagePicker : null}
        imageData={cropModalOpen ? { dataUrl: cropModalOpen.dataUrl, pageNum: cropModalOpen.pageNum, isUploaded: cropModalOpen.isUploaded } : null}
        onConfirm={handleCropConfirm}
        initialAnnotations={cropModalOpen?.initialAnnotations || null}
        initialCropArea={cropModalOpen?.initialCropArea || null}
      />
    </div>
  )
}

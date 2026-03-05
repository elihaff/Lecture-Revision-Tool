import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, BookOpen, CheckCircle2, Circle, Copy, Check, FileText, Trash2, GripVertical, Edit2, Plus, Save, X, Upload, Loader2, Download, FileUp, Image } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resetLectureNotes } from '../lib/lectureService'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import { ImagePickerModal } from './ImagePickerModal'
import { CropModal } from './CropModal'

// Initialize pdfmake with fonts
pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs
if (typeof pdfMake.addVirtualFileSystem === 'function') {
  pdfMake.addVirtualFileSystem(pdfMake.vfs || {})
}

let unicodeFontInitPromise = null

function hasFontFiles(fontDef, vfsMap) {
  if (!fontDef || !vfsMap) return false
  const normalFile = fontDef.normal
  const boldFile = fontDef.bold
  return !!(normalFile && boldFile && vfsMap[normalFile] && vfsMap[boldFile])
}

function hasUnicodePdfFont() {
  return hasFontFiles(pdfMake.fonts?.NotoSans, pdfMake.vfs)
}

function normalizeUnicodePdfFont() {
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

  return hasUnicodePdfFont()
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

async function probePdfFont(fontName) {
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
      console.error(`PDF font probe failed for ${fontName}:`, error)
      done(false)
    }
  })
}

async function ensureUnicodePdfFont() {
  if (normalizeUnicodePdfFont()) return true

  if (!unicodeFontInitPromise) {
    unicodeFontInitPromise = (async () => {
      const baseFonts = { ...(pdfMake.fonts || {}) }
      let unicodeVfs = null

      // Preferred path: direct TTF fetch + explicit registration.
      try {
        unicodeVfs = await loadDirectUnicodeFontVfs()
      } catch (directError) {
        console.warn('Direct Unicode TTF load failed, falling back to custom-fonts.js:', directError)
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

      if (!normalizeUnicodePdfFont()) {
        throw new Error('Unicode font verification failed after registration')
      }

      const canRenderUnicodeFont = await probePdfFont('NotoSans')
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

// Set worker path for pdf.js using Vite's URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Convert markdown-like syntax and symbols to HTML
function markdownToHTML(text) {
  if (!text) return ''
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\^([^^]+)\^/g, '<sup>$1</sup>')
    .replace(/~([^~]+)~/g, '<sub>$1</sub>')
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
        text += `${cleanPoint.trimStart().startsWith('•') ? cleanPoint : `• ${cleanPoint}`}\n`
      })
      text += '\n'
    })
  }
  return text
}

export function NotesView({ lecture, module, onBack, onObjectiveToggle, onReset }) {
  // Local state for editing
  const [notes, setNotes] = useState(lecture.notes || { title: lecture.title, notes: [] })
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [importing, setImporting] = useState(false)

  // Editing state
  const [editingNote, setEditingNote] = useState(null)
  const [convertingLegacy, setConvertingLegacy] = useState(false)
  const [uploadingSlides, setUploadingSlides] = useState(false)
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
  const slidesUploadRef = useRef(null)
  const cachedPdfRef = useRef(null) // Cache PDF document to avoid re-downloading

  // Drag and drop state
  const [draggedPoint, setDraggedPoint] = useState(null)
  const [draggedSection, setDraggedSection] = useState(null)
  const [dropTargetPoint, setDropTargetPoint] = useState(null)
  const [dropTargetSection, setDropTargetSection] = useState(null)

  // Image insertion state
  const [pdfThumbnails, setPdfThumbnails] = useState([])
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false)
  const [pointImages, setPointImages] = useState({})
  const [sectionImages, setSectionImages] = useState({})
  const [imageReferences, setImageReferences] = useState({})
  const [imagePickerOpen, setImagePickerOpen] = useState(null) // {sectionIndex, pointIndex} or {sectionIndex} for section images
  const [cropModalOpen, setCropModalOpen] = useState(null) // {pageNum, dataUrl, width, height, targetKey, targetType, sectionIndex, pointIndex, initialAnnotations, initialCropArea}
  const [loadingHighRes, setLoadingHighRes] = useState(false) // Loading state for high-res image fetch

  const learningObjectives = lecture.learning_objectives || []
  const completedObjectives = learningObjectives.filter(obj => obj.completed).length
  const sections = notes.notes || []

  // Sync local notes when lecture prop changes
  useEffect(() => {
    setNotes(lecture.notes || { title: lecture.title, notes: [] })
    setHasChanges(false)

    // Clear cached PDF when lecture changes
    cachedPdfRef.current = null

    // Load embedded image data if present
    if (lecture.notes?._pointImages) {
      setPointImages(lecture.notes._pointImages)
    } else {
      setPointImages({})
    }
    if (lecture.notes?._sectionImages) {
      setSectionImages(lecture.notes._sectionImages)
    } else {
      setSectionImages({})
    }
    if (lecture.notes?._imageReferences) {
      setImageReferences(lecture.notes._imageReferences)
    } else {
      setImageReferences({})
    }
    if (lecture.notes?._flashcards) {
      setFlashcards(lecture.notes._flashcards)
    } else {
      setFlashcards([])
    }
  }, [lecture.id])

  // Generate PDF thumbnails when lecture has a pdf_path
  useEffect(() => {
    const generateThumbnails = async () => {
      console.log('Thumbnail generation check - pdf_path:', lecture.pdf_path)
      if (!lecture.pdf_path) {
        console.log('No pdf_path found on lecture, skipping thumbnail generation')
        return
      }

      setThumbnailsLoading(true)
      try {
        // Download PDF from Supabase Storage
        const { data: pdfBlob, error: downloadError } = await supabase.storage
          .from('lecture-pdfs')
          .download(lecture.pdf_path)

        if (downloadError) {
          console.error('Failed to download PDF for thumbnails:', downloadError)
          return
        }

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

        // Cache the PDF document for later high-res rendering
        cachedPdfRef.current = pdf

        const thumbnails = []
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum)

          // Extract text for search filtering
          const textContent = await page.getTextContent()
          const pageText = textContent.items.map(item => item.str).join(' ').toLowerCase()

          // Render thumbnail at lower scale for performance
          const viewport = page.getViewport({ scale: 0.3 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')

          await page.render({
            canvasContext: ctx,
            viewport: viewport
          }).promise

          thumbnails.push({
            pageNum,
            dataUrl: canvas.toDataURL('image/jpeg', 0.7),
            text: pageText,
            width: viewport.width,
            height: viewport.height
          })
        }

        setPdfThumbnails(thumbnails)
        console.log(`Generated ${thumbnails.length} PDF thumbnails`)
      } catch (error) {
        console.error('Failed to generate PDF thumbnails:', error)
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
        console.error('Unicode font preload failed, using fallback glyph mapping:', error)
        setUnicodeFontReady(false)
      })
  }, [])

  // Save notes to Supabase (including image data)
  const saveNotes = async () => {
    setSaving(true)

    // Include image data with notes
    const notesWithImages = {
      ...notes,
      _pointImages: Object.keys(pointImages).length > 0 ? pointImages : undefined,
      _sectionImages: Object.keys(sectionImages).length > 0 ? sectionImages : undefined,
      _imageReferences: Object.keys(imageReferences).length > 0 ? imageReferences : undefined,
      _flashcards: flashcards.length > 0 ? flashcards : undefined,
    }

    const { error } = await supabase
      .from('lectures')
      .update({ notes: notesWithImages })
      .eq('id', lecture.id)

    if (error) {
      console.error('Failed to save notes:', error)
      alert('Failed to save: ' + error.message)
    } else {
      setHasChanges(false)
    }
    setSaving(false)
  }

  // Update notes locally and mark as changed
  const updateNotes = (newNotes) => {
    setNotes(newNotes)
    setHasChanges(true)
  }

  // Copy handler
  const handleCopy = async () => {
    const text = notesToClipboardText(notes, learningObjectives)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Reset handler
  const handleReset = async () => {
    setResetting(true)
    const result = await resetLectureNotes(lecture.id)
    if (result.success) {
      setShowResetConfirm(false)
      if (onReset) {
        onReset()
      } else {
        onBack()
      }
    } else {
      alert('Failed to reset: ' + result.error)
    }
    setResetting(false)
  }

  const handleGenerateFlashcards = async () => {
    if (!notes?.notes?.length) {
      alert('Please generate notes first, then generate flashcards.')
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
      alert(`Generated ${generated.length} flashcards`)
    } catch (error) {
      console.error('Failed to generate flashcards:', error)
      alert(`Failed to generate flashcards: ${error.message}`)
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

  const defaultFlashcardTags = () => {
    const source = (notes.title || lecture.title || 'Lecture')
      .split(/[\s_\-.]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')
    const modulePrefix = module?.abbreviation ? `${module.abbreviation}_` : ''
    return `Day2 ${modulePrefix}${source}`.trim()
  }

  const handleAddFlashcard = () => {
    if (!newCard.front.trim() || !newCard.back.trim()) return
    setFlashcards((prev) => [
      ...prev,
      {
        front: newCard.front.trim(),
        back: newCard.back.trim(),
        tags: defaultFlashcardTags(),
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
        const tags = String(cells[2] || defaultFlashcardTags()).trim()
        if (!front || !back) continue
        imported.push({ front, back, tags })
      }

      if (!imported.length) {
        throw new Error('No valid flashcards found in CSV')
      }

      setFlashcards(imported)
      setHasChanges(true)
      alert(`Imported ${imported.length} flashcards from CSV`)
    } catch (error) {
      console.error('CSV import failed:', error)
      alert(`CSV import failed: ${error.message}`)
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
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      console.log('PDF loaded, pages:', pdf.numPages)

      const startDelimiter = '[EMBEDDED_NOTES_DATA_START]'
      const endDelimiter = '[EMBEDDED_NOTES_DATA_END]'

      let importedNotes = null

      // First try to get from PDF metadata (new method - no blank pages)
      const metadata = await pdf.getMetadata()
      const keywords = metadata?.info?.Keywords || ''
      console.log('PDF Keywords metadata length:', keywords.length)

      if (keywords.includes(startDelimiter)) {
        console.log('Found embedded JSON in PDF metadata (keywords)')
        const startIndex = keywords.indexOf(startDelimiter)
        const endIndex = keywords.indexOf(endDelimiter)
        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
          const jsonStr = keywords.substring(startIndex + startDelimiter.length, endIndex).trim()
          importedNotes = JSON.parse(jsonStr)
        }
      }

      // Fall back to content extraction (old method for backwards compatibility)
      if (!importedNotes) {
        console.log('Trying content extraction fallback...')
        let allText = ''
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum)
          const textContent = await page.getTextContent()
          const pageText = textContent.items.map(item => item.str).join('')
          allText += pageText
        }

        console.log('Total text length:', allText.length)

        const startIndex = allText.indexOf(startDelimiter)
        const endIndex = allText.indexOf(endDelimiter)

        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
          console.log('Found embedded JSON in PDF content')
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

      console.log('Importing notes:', importedNotes.title, '- Sections:', importedNotes.notes.length)

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

      alert(`Imported successfully: ${importedNotes.notes.length} sections. Click "Save Changes" to save.`)

    } catch (error) {
      console.error('PDF import error:', error)

      if (error.message === 'NO_METADATA') {
        alert('This PDF cannot be imported.\n\nThis PDF doesn\'t contain embedded metadata. Only PDFs exported from the notes tool can be imported.')
      } else {
        alert(`Import failed: ${error.message}\n\nPlease ensure you're uploading a PDF that was previously exported from this tool.`)
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

      // Convert PDF to base64
      const arrayBuffer = await file.arrayBuffer()
      const base64Data = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      // Get user session for auth
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token

      if (!accessToken) {
        throw new Error('Please sign in to convert notes')
      }

      // Call Edge Function to convert the PDF
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const functionUrl = `${supabaseUrl}/functions/v1/convert-legacy-notes`

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          pdf_base64: base64Data,
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

      alert(`Converted successfully: ${convertedNotes.notes.length} sections. Click "Save Changes" to save.`)

    } catch (error) {
      console.error('Legacy import error:', error)
      alert(`Conversion failed: ${error.message}`)
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
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      const thumbnails = []
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map(item => item.str).join(' ').toLowerCase()

        const viewport = page.getViewport({ scale: 0.3 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')

        await page.render({
          canvasContext: ctx,
          viewport: viewport
        }).promise

        thumbnails.push({
          pageNum,
          dataUrl: canvas.toDataURL('image/jpeg', 0.7),
          text: pageText,
          width: viewport.width,
          height: viewport.height
        })
      }

      setPdfThumbnails(thumbnails)
      alert(`Uploaded ${thumbnails.length} slides. You can now insert images from slides into your notes.`)

    } catch (error) {
      console.error('Slides upload error:', error)
      alert(`Failed to upload slides: ${error.message}`)
    } finally {
      setUploadingSlides(false)
      e.target.value = ''
    }
  }

  // PDF Export handler - exports notes as PDF with embedded metadata for re-importing
  const handleExportPDF = () => {
    if (!notes) return
    const useUnicodeFont = normalizeUnicodePdfFont()

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

    const parsePointToBulletRows = (point, figRef = null) => {
      const raw = parseRawText(point)
      const lines = raw
        .split('\n')
        .map(line => line.replace(/\s+$/g, ''))
        .filter(line => line.trim().length > 0)

      const rows = []
      let figRefAttached = false

      lines.forEach((line) => {
        const bulletMatch = line.match(/^(\s*)•\s+(.+)$/)
        let depth = 0
        let content = line.trim()

        if (bulletMatch) {
          const leadingSpaces = bulletMatch[1] || ''
          depth = Math.floor(leadingSpaces.length / 2)
          content = bulletMatch[2]
        }

        const parsed = parseInlineText(`• ${content}`)
        let textValue = parsed
        if (figRef && !figRefAttached) {
          const asArray = Array.isArray(parsed) ? parsed : [{ text: parsed }]
          asArray.push({ text: ` (Fig ${figRef})`, fontSize: 9, color: '#8B5CF6' })
          textValue = asArray
          figRefAttached = true
        }

        rows.push({
          text: textValue,
          style: 'bullet',
          margin: [depth * 16, 2, 0, 2]
        })
      })

      if (rows.length === 0) {
        const parsed = parseInlineText(`• ${raw}`)
        const textValue = figRef
          ? [...(Array.isArray(parsed) ? parsed : [{ text: parsed }]), { text: ` (Fig ${figRef})`, fontSize: 9, color: '#8B5CF6' }]
          : parsed
        rows.push({
          text: textValue,
          style: 'bullet',
          margin: [0, 2, 0, 2]
        })
      }

      return rows
    }

    const isTextHeavyImage = (image) => {
      const extractedText = String(image?.text || '').trim()
      return extractedText.length > 900
    }

    // Helper to calculate image dimensions for export.
    // Text-heavy figures are rendered larger for readability.
    const calcGridImageSize = (image, large = false) => {
      const maxW = large ? 420 : 240
      const maxH = large ? 320 : 195
      let w = image.width || maxW
      let h = image.height || maxH
      if (w > maxW) { const s = maxW / w; w = maxW; h = h * s }
      if (h > maxH) { const s = maxH / h; h = maxH; w = w * s }
      return { width: w, height: h }
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
        title: notes.title || 'Lecture Notes',
        author: 'Lecture Revision Tool',
        subject: 'Concise Lecture Notes'
      }
    }

    // Add title
    docDefinition.content.push({
      text: (notes.title || 'Lecture Notes') + ' (Concise Notes)',
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

    // Add notes sections with images
    let figureCounter = 0

    if (notes.notes && notes.notes.length > 0) {
      notes.notes.forEach((section, sectionIndex) => {
        // Collect figures for this section
        const sectionFigures = []

        // Check for section image
        const sectionImg = sectionImages[sectionIndex]
        if (sectionImg && sectionImg.dataUrl) {
          figureCounter++
          sectionFigures.push({ figNum: figureCounter, image: sectionImg, type: 'section' })
        }

        // Check for point images
        if (section.points) {
          section.points.forEach((_, pointIndex) => {
            const pointKey = getPointImageKey(sectionIndex, pointIndex)
            const img = pointImages[pointKey]
            if (img && img.dataUrl) {
              figureCounter++
              sectionFigures.push({ figNum: figureCounter, image: img, type: 'point', pointIndex })
            }
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
              { text: ` (Fig ${sectionFigure.figNum})`, fontSize: 9, color: '#8B5CF6', bold: false }
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
          section.points.forEach((point, pointIndex) => {
            const pointFigure = sectionFigures.find(f => f.type === 'point' && f.pointIndex === pointIndex)

            // Check if this point references another image
            const pointKey = getPointImageKey(sectionIndex, pointIndex)
            const refKey = imageReferences[pointKey]
            let figRef = null

            if (pointFigure) {
              figRef = pointFigure.figNum
            } else if (refKey && pointImages[refKey]) {
              // Find the figure number for the referenced image
              const [refS, refP] = refKey.split('-').map(Number)
              const refFigNum = getFigureNumber(refS, refP)
              if (refFigNum) figRef = refFigNum
            }
            processedPointRows.push(...parsePointToBulletRows(point, figRef))
          })

          docDefinition.content.push({
            stack: processedPointRows,
            margin: [0, 0, 0, 6]
          })

          // After bullets, render image grid if there are figures in this section
          if (sectionFigures.length > 0) {
            const imageRows = []
            for (let fi = 0; fi < sectionFigures.length;) {
              const fig1 = sectionFigures[fi]
              const fig1TextHeavy = isTextHeavyImage(fig1.image)
              const slideNum1 = fig1.image.pageNum || '?'

              // Render text-heavy figures in a larger single-column row for readability.
              if (fig1TextHeavy) {
                const size1 = calcGridImageSize(fig1.image, true)
                imageRows.push({
                  stack: [
                    { image: fig1.image.dataUrl, width: size1.width, height: size1.height, alignment: 'center' },
                    { text: `Fig ${fig1.figNum}, Slide ${slideNum1}`, fontSize: 9, color: '#8B5CF6', margin: [0, 2, 0, 0], alignment: 'center' }
                  ],
                  margin: [0, 6, 0, 8]
                })
                fi += 1
                continue
              }

              const row = []
              const size1 = calcGridImageSize(fig1.image)
              row.push({
                stack: [
                  { image: fig1.image.dataUrl, width: size1.width, height: size1.height },
                  { text: `Fig ${fig1.figNum}, Slide ${slideNum1}`, fontSize: 9, color: '#8B5CF6', margin: [0, 2, 0, 0], alignment: 'center' }
                ],
                width: '*'
              })

              // Pair normal figures two-per-row when possible.
              const fig2 = sectionFigures[fi + 1]
              if (fig2 && !isTextHeavyImage(fig2.image)) {
                const size2 = calcGridImageSize(fig2.image)
                const slideNum2 = fig2.image.pageNum || '?'
                row.push({
                  stack: [
                    { image: fig2.image.dataUrl, width: size2.width, height: size2.height },
                    { text: `Fig ${fig2.figNum}, Slide ${slideNum2}`, fontSize: 9, color: '#8B5CF6', margin: [0, 2, 0, 0], alignment: 'center' }
                  ],
                  width: '*'
                })
                fi += 2
              } else {
                row.push({ text: '', width: '*' })
                fi += 1
              }

              imageRows.push({
                columns: row,
                columnGap: 15,
                margin: [0, 5, 0, 5]
              })
            }

            docDefinition.content.push({
              stack: imageRows,
              unbreakable: sectionFigures.length <= 4,
              margin: [0, 8, 0, 12]
            })
          }
        }
      })
    }

    // Build notes object for embedding (compatible with old format, including images)
    const notesForExport = {
      title: notes.title,
      learningObjectives: loStrings,
      notes: notes.notes,
      _pointImages: Object.keys(pointImages).length > 0 ? pointImages : undefined,
      _sectionImages: Object.keys(sectionImages).length > 0 ? sectionImages : undefined,
      _imageReferences: Object.keys(imageReferences).length > 0 ? imageReferences : undefined,
      _flashcards: flashcards.length > 0 ? flashcards : undefined
    }

    // CRITICAL: Embed JSON data in PDF metadata for lossless import
    docDefinition.info.keywords = `[EMBEDDED_NOTES_DATA_START]${JSON.stringify(notesForExport)}[EMBEDDED_NOTES_DATA_END]`

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

      pdfMake.createPdf(docDefinition).open()
    } catch (error) {
      console.error('PDF generation failed:', error)
      alert('Failed to generate PDF: ' + error.message)
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
    const value = /<(ul|ol|li)\b/i.test(rawValue) ? rawValue : ensureEditableLineBullets(rawValue)
    setEditingNote({ type: 'point', sectionIndex, pointIndex, value })
  }

  const startEditSection = (sectionIndex) => {
    const value = String(notes.notes[sectionIndex].section).replace(/<br\s*\/?>/gi, '\n')
    setEditingNote({ type: 'section', sectionIndex, value })
  }

  const startEditTitle = () => {
    setEditingNote({ type: 'title', value: notes.title || '' })
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

  const deletePoint = (sectionIndex, pointIndex) => {
    const updated = JSON.parse(JSON.stringify(notes))
    updated.notes[sectionIndex].points.splice(pointIndex, 1)
    updateNotes(updated)
  }

  const addPoint = (sectionIndex) => {
    const updated = JSON.parse(JSON.stringify(notes))
    updated.notes[sectionIndex].points.push('New point - click to edit')
    updateNotes(updated)
    setEditingNote({
      type: 'point',
      sectionIndex,
      pointIndex: updated.notes[sectionIndex].points.length - 1,
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
      points: ['New point - click to edit']
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
    setDropTargetPoint(null)
    setDropTargetSection(null)
  }

  const handleDragLeave = () => {
    setDropTargetPoint(null)
    setDropTargetSection(null)
  }

  const handleDrop = (targetSectionIndex, targetPointIndex) => {
    if (!draggedPoint) return
    if (draggedPoint.sectionIndex === targetSectionIndex && draggedPoint.pointIndex === targetPointIndex) return

    const updated = JSON.parse(JSON.stringify(notes))
    const sourceSection = updated.notes[draggedPoint.sectionIndex]
    const targetSection = updated.notes[targetSectionIndex]

    const [movedPoint] = sourceSection.points.splice(draggedPoint.pointIndex, 1)

    let adjustedTargetIndex = targetPointIndex
    if (draggedPoint.sectionIndex === targetSectionIndex && draggedPoint.pointIndex < targetPointIndex) {
      adjustedTargetIndex = targetPointIndex
    }
    targetSection.points.splice(adjustedTargetIndex, 0, movedPoint)

    updateNotes(updated)
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

    updateNotes(updated)
    setDraggedSection(null)
    setDropTargetSection(null)
  }

  // ============ IMAGE HELPER FUNCTIONS ============

  // Generate a key for point images (e.g., "0-1" for section 0, point 1)
  const getPointImageKey = (sectionIndex, pointIndex) => `${sectionIndex}-${pointIndex}`

  // Get image for a specific point (returns image data or null)
  const getPointImage = (sectionIndex, pointIndex) => {
    const key = getPointImageKey(sectionIndex, pointIndex)
    // Check if it's a reference to another image
    if (imageReferences[key]) {
      const refKey = imageReferences[key]
      return pointImages[refKey] || null
    }
    return pointImages[key] || null
  }

  // Set image for a specific point
  const setPointImageData = (sectionIndex, pointIndex, imageData) => {
    const key = getPointImageKey(sectionIndex, pointIndex)
    setPointImages(prev => ({ ...prev, [key]: imageData }))
    setHasChanges(true)
  }

  // Remove image from a specific point
  const removePointImage = (sectionIndex, pointIndex) => {
    const key = getPointImageKey(sectionIndex, pointIndex)
    setPointImages(prev => {
      const updated = { ...prev }
      delete updated[key]
      return updated
    })
    // Also remove any reference
    setImageReferences(prev => {
      const updated = { ...prev }
      delete updated[key]
      return updated
    })
    setHasChanges(true)
  }

  // Get section image
  const getSectionImage = (sectionIndex) => {
    return sectionImages[sectionIndex] || null
  }

  // Set section image
  const setSectionImageData = (sectionIndex, imageData) => {
    setSectionImages(prev => ({ ...prev, [sectionIndex]: imageData }))
    setHasChanges(true)
  }

  // Remove section image
  const removeSectionImage = (sectionIndex) => {
    setSectionImages(prev => {
      const updated = { ...prev }
      delete updated[sectionIndex]
      return updated
    })
    setHasChanges(true)
  }

  // Get figure number for a point or section image
  const getFigureNumber = (sectionIndex, pointIndex = null) => {
    let figNum = 0

    // Count section images first (in order)
    for (let si = 0; si < sections.length; si++) {
      if (sectionImages[si]) {
        figNum++
        if (pointIndex === null && si === sectionIndex) {
          return figNum
        }
      }

      // Count point images for this section
      if (si < sectionIndex || (si === sectionIndex && pointIndex !== null)) {
        const sectionPoints = sections[si]?.points || []
        for (let pi = 0; pi < sectionPoints.length; pi++) {
          if (si === sectionIndex && pi >= pointIndex) break
          const key = getPointImageKey(si, pi)
          if (pointImages[key] || imageReferences[key]) {
            figNum++
          }
        }
      }
    }

    // If we're looking for a point image
    if (pointIndex !== null) {
      const key = getPointImageKey(sectionIndex, pointIndex)
      if (pointImages[key] || imageReferences[key]) {
        figNum++
        return figNum
      }
    }

    return null
  }

  // Create a reference from one point to another point's image
  const createImageReference = (fromSectionIndex, fromPointIndex, toKey) => {
    const fromKey = getPointImageKey(fromSectionIndex, fromPointIndex)
    setImageReferences(prev => ({ ...prev, [fromKey]: toKey }))
    setHasChanges(true)
  }

  // Handle slide selection from ImagePickerModal - fetch high-res version
  const handleSelectSlide = async (pageNum) => {
    console.log('handleSelectSlide called, pageNum:', pageNum, 'imagePickerOpen:', imagePickerOpen)
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

    // Show loading state while fetching high-res image
    setLoadingHighRes(true)
    console.log('Starting high-res fetch...')

    try {
      // Fetch high-resolution version of the slide
      const highResImage = await getFullSizeSlideImage(pageNum)
      console.log('High-res result:', highResImage ? 'success' : 'null')
      if (!highResImage) {
        alert('Failed to load high-resolution slide')
        return
      }

      // Open crop modal with the high-res slide
      console.log('Opening crop modal...')
      setCropModalOpen({
        pageNum,
        dataUrl: highResImage.dataUrl,
        width: highResImage.width,
        height: highResImage.height,
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
      setPointImageData(cropModalOpen.sectionIndex, cropModalOpen.pointIndex, imageData)
    } else {
      setSectionImageData(cropModalOpen.sectionIndex, imageData)
    }

    setCropModalOpen(null)
  }

  // Handle editing an existing image - opens crop modal with saved annotations
  const handleEditExistingImage = async (sectionIndex, pointIndex = null) => {
    const imageData = pointIndex !== null
      ? getPointImage(sectionIndex, pointIndex)
      : getSectionImage(sectionIndex)

    if (!imageData) return

    // If we have originalDataUrl (image was saved with edit data), use it directly
    if (imageData.originalDataUrl) {
      setCropModalOpen({
        pageNum: imageData.pageNum,
        dataUrl: imageData.originalDataUrl,
        width: imageData.originalWidth,
        height: imageData.originalHeight,
        targetType: pointIndex !== null ? 'point' : 'section',
        sectionIndex,
        pointIndex,
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
    console.log('getFullSizeSlideImage called for page:', pageNum)
    try {
      // Use cached PDF if available (much faster!)
      let pdf = cachedPdfRef.current
      console.log('Cached PDF:', pdf ? 'yes' : 'no')

      // If not cached, download and cache it
      if (!pdf && lecture.pdf_path) {
        console.log('PDF not cached, downloading from:', lecture.pdf_path)
        const { data: pdfBlob, error } = await supabase.storage
          .from('lecture-pdfs')
          .download(lecture.pdf_path)

        if (error) {
          console.error('Failed to download PDF:', error)
          return null
        }
        console.log('PDF downloaded, size:', pdfBlob.size)

        const arrayBuffer = await pdfBlob.arrayBuffer()
        console.log('Converting to PDF document...')
        pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        cachedPdfRef.current = pdf
        console.log('PDF document created, pages:', pdf.numPages)
      }

      if (!pdf) {
        console.error('No PDF available - pdf_path:', lecture.pdf_path)
        return null
      }

      console.log('Getting page', pageNum)
      const page = await pdf.getPage(pageNum)
      console.log('Page retrieved')

      // Render at high scale for crisp text (2.0x for good quality)
      let scale = 2.0
      let viewport = page.getViewport({ scale })
      console.log('Initial viewport size:', viewport.width, 'x', viewport.height)

      // Check if canvas would be too large (limit to ~3000px to avoid memory issues)
      const maxDimension = 3000
      if (viewport.width > maxDimension || viewport.height > maxDimension) {
        const reductionFactor = Math.min(maxDimension / viewport.width, maxDimension / viewport.height)
        scale = scale * reductionFactor
        viewport = page.getViewport({ scale })
        console.log('Reduced viewport size:', viewport.width, 'x', viewport.height)
      }

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')

      console.log('Starting page render...')
      await page.render({
        canvasContext: ctx,
        viewport
      }).promise
      console.log('Page rendered')

      console.log('Converting to data URL...')
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      console.log('Data URL created, length:', dataUrl.length)

      return {
        dataUrl,
        pageNum,
        width: viewport.width,
        height: viewport.height
      }
    } catch (error) {
      console.error('Failed to get full-size slide:', error)
      return null
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-divider">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-secondary hover:text-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to lecture
            </button>

            <div className="flex items-center gap-2">
              {hasChanges && (
                <button
                  onClick={saveNotes}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              )}
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
                title="Export as PDF (can be re-imported later)"
              >
                <Download className="w-4 h-4" />
                Export PDF
              </button>
              {pdfThumbnails.length === 0 && (
                <>
                  <button
                    onClick={() => slidesUploadRef.current?.click()}
                    disabled={uploadingSlides}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    title="Upload lecture slides for image insertion"
                  >
                    {uploadingSlides ? <Loader2 className="w-4 h-4 animate-spin" /> : <Image className="w-4 h-4" />}
                    {uploadingSlides ? 'Uploading...' : 'Upload Slides'}
                  </button>
                  <input
                    type="file"
                    ref={slidesUploadRef}
                    onChange={handleSlidesUpload}
                    accept=".pdf"
                    className="hidden"
                  />
                </>
              )}
              {pdfThumbnails.length > 0 && (
                <span className="flex items-center gap-1 px-3 py-2 text-xs text-green-700 bg-green-50 rounded-lg">
                  <Image className="w-3.5 h-3.5" />
                  {pdfThumbnails.length} slides
                </span>
              )}
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-secondary rounded-lg text-sm transition-colors"
                title="Remove notes and start fresh"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-primary mb-2">Remove Notes?</h3>
            <p className="text-secondary text-sm mb-6">
              This will remove all generated notes and learning objectives. You'll need to upload a PDF again.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-lg transition-colors"
              >
                {resetting ? 'Removing...' : 'Yes, Remove'}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Title Section */}
        <div className="flex items-start gap-4 group">
          {module && (
            <div
              className="flex-shrink-0 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
              style={{ backgroundColor: `${module.color}15`, color: module.color }}
            >
              {module.abbreviation}
            </div>
          )}
          <div className="flex-1">
            {editingNote?.type === 'title' ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editingNote.value}
                  onChange={(e) => setEditingNote(p => ({ ...p, value: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && saveNoteEdit()}
                  className="flex-1 text-2xl font-bold bg-white border border-divider rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                  autoFocus
                />
                <button onClick={saveNoteEdit} className="px-3 py-1 bg-accent hover:bg-blue-600 text-white rounded-lg text-sm">Save</button>
                <button onClick={() => setEditingNote(null)} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-primary rounded-lg text-sm">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-primary">{notes.title || lecture.title}</h1>
                <button
                  onClick={startEditTitle}
                  className="opacity-0 group-hover:opacity-100 p-1 bg-gray-100 hover:bg-gray-200 rounded transition-opacity"
                >
                  <Edit2 className="w-4 h-4 text-secondary" />
                </button>
              </div>
            )}
            {lecture.processed_at && (
              <p className="text-sm text-secondary mt-1">
                Generated {new Date(lecture.processed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        {/* Learning Objectives Card */}
        {learningObjectives.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-accent" />
                <h2 className="font-semibold text-accent">Learning Objectives</h2>
              </div>
              <span className="text-sm text-accent/70">
                {completedObjectives}/{learningObjectives.length} completed
              </span>
            </div>
            <ul className="space-y-2">
              {learningObjectives.map((objective, index) => (
                <li key={objective.id || index}>
                  <button
                    onClick={() => onObjectiveToggle && onObjectiveToggle(objective.id, objective.completed)}
                    className="flex items-start gap-3 w-full text-left p-2 rounded-lg hover:bg-blue-100/50 transition-colors group"
                  >
                    {objective.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="w-5 h-5 text-blue-400 group-hover:text-blue-500 flex-shrink-0 mt-0.5" />
                    )}
                    <span className={`text-sm leading-relaxed ${objective.completed ? 'text-secondary line-through' : 'text-primary'}`}>
                      {objective.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes Sections */}
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
                  <div className="flex-1 flex gap-2">
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
                ) : (
                  <>
                    <h3 className="font-semibold text-primary text-lg flex-1">{section.section}</h3>
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
                      <li
                        key={pointIndex}
                        className={`text-sm text-primary pl-4 border-l-2 border-accent/30 py-2 group flex items-start gap-2 ${
                          dropTargetPoint?.sectionIndex === sectionIndex && dropTargetPoint?.pointIndex === pointIndex &&
                          !(draggedPoint?.sectionIndex === sectionIndex && draggedPoint?.pointIndex === pointIndex)
                            ? 'bg-blue-50 border-l-accent' : ''
                        }`}
                        onDragOver={(e) => handlePointDragOver(e, sectionIndex, pointIndex)}
                        onDragLeave={handleDragLeave}
                        onDrop={() => handleDrop(sectionIndex, pointIndex)}
                      >
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
                              <div className="flex items-start gap-2">
                            <div
                              className="flex-1 notes-content leading-relaxed"
                              dangerouslySetInnerHTML={{
                                __html: /<(ul|ol|li)\b/i.test(point || '')
                                  || String(point || '').trimStart().startsWith('•')
                                  ? markdownToHTML(point)
                                  : `• ${markdownToHTML(point)}`,
                              }}
                            />
                                {getFigureNumber(sectionIndex, pointIndex) && (
                                  <span className="text-indigo-500 text-xs font-medium">
                                    (Fig {getFigureNumber(sectionIndex, pointIndex)})
                                  </span>
                                )}
                              </div>
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
                                onClick={() => {
                                  if (pdfThumbnails.length === 0 && Object.keys(pointImages).length === 0) {
                                    alert('No slides available for image insertion.\n\nTo use this feature, you need to upload a slides PDF using the "Convert Existing Notes" option, which stores both the slides and notes PDFs.')
                                  } else {
                                    setImagePickerOpen({ sectionIndex, pointIndex })
                                  }
                                }}
                                className={`p-1 rounded ${
                                  pdfThumbnails.length === 0 && Object.keys(pointImages).length === 0
                                    ? 'bg-gray-100 text-gray-400 cursor-help'
                                    : 'bg-gray-100 hover:bg-indigo-100 hover:text-indigo-600'
                                }`}
                                title={pdfThumbnails.length === 0 && Object.keys(pointImages).length === 0
                                  ? "No slides available - use 'Convert Existing Notes' to upload slides"
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
                    ))}
                  </ul>

                  {/* Section Images Grid - displayed below all bullet points */}
                  {(() => {
                    // Collect all figures for this section
                    const sectionFigures = []

                    // Check for section image
                    const sectionImg = getSectionImage(sectionIndex)
                    if (sectionImg) {
                      sectionFigures.push({
                        type: 'section',
                        image: sectionImg,
                        figNum: getFigureNumber(sectionIndex, null),
                        key: `section-${sectionIndex}`
                      })
                    }

                    // Check for point images
                    section.points.forEach((_, pointIndex) => {
                      const pointImg = getPointImage(sectionIndex, pointIndex)
                      if (pointImg) {
                        sectionFigures.push({
                          type: 'point',
                          image: pointImg,
                          figNum: getFigureNumber(sectionIndex, pointIndex),
                          pointIndex,
                          key: getPointImageKey(sectionIndex, pointIndex)
                        })
                      }
                    })

                    if (sectionFigures.length === 0) return null

                    return (
                      <div className="mt-6 pt-4 border-t border-gray-100">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {sectionFigures.map((fig) => (
                            <div key={fig.key} className="relative group/img">
                              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                <img
                                  src={fig.image.dataUrl}
                                  alt={`Figure ${fig.figNum}`}
                                  className="max-w-full w-auto max-h-[400px] rounded shadow-sm mx-auto block"
                                />
                                <div className="text-center mt-2 text-xs text-indigo-600 font-medium">
                                  Fig {fig.figNum}
                                  {fig.image.pageNum && (
                                    <span className="text-gray-500 ml-1">
                                      (Slide {fig.image.pageNum})
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="absolute top-4 right-4 opacity-0 group-hover/img:opacity-100 flex gap-1 transition-opacity">
                                <button
                                  onClick={() => {
                                    if (fig.type === 'point') {
                                      handleEditExistingImage(sectionIndex, fig.pointIndex)
                                    } else {
                                      handleEditExistingImage(sectionIndex, null)
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
                                      removePointImage(sectionIndex, fig.pointIndex)
                                    } else {
                                      removeSectionImage(sectionIndex)
                                    }
                                  }}
                                  className="p-1.5 bg-white/95 hover:bg-red-50 rounded-lg shadow-md border border-gray-200"
                                  title="Remove image"
                                >
                                  <X className="w-4 h-4 text-red-500" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
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
        thumbnailsLoading={thumbnailsLoading}
        existingImages={pointImages}
        onSelectSlide={handleSelectSlide}
        onSelectExisting={handleSelectExisting}
        currentKey={imagePickerOpen ? getPointImageKey(imagePickerOpen.sectionIndex, imagePickerOpen.pointIndex) : null}
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
        imageData={cropModalOpen ? { dataUrl: cropModalOpen.dataUrl, pageNum: cropModalOpen.pageNum } : null}
        onConfirm={handleCropConfirm}
        initialAnnotations={cropModalOpen?.initialAnnotations || null}
        initialCropArea={cropModalOpen?.initialCropArea || null}
      />
    </div>
  )
}

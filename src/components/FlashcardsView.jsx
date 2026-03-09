import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Save, Plus, Upload, Download, Trash2, Edit2, Check, X, Loader2, EyeOff, MessageSquare, Image, Type } from 'lucide-react'
import { supabase } from '../lib/supabase'

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

export function FlashcardsView({ lecture, module, onBack, onSaved }) {
  const [flashcards, setFlashcards] = useState(Array.isArray(lecture.notes?._flashcards) ? lecture.notes._flashcards : [])
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAddCard, setShowAddCard] = useState(false)
  const [newCard, setNewCard] = useState({ front: '', back: '', tags: '' })
  const [expandedCards, setExpandedCards] = useState({})
  const [editingCard, setEditingCard] = useState(null) // {index, front, back, tags}
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
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

  const essentialSymbols = [
    { symbol: 'α' }, { symbol: 'β' }, { symbol: 'Δ' }, { symbol: 'μ' },
    { symbol: '→' }, { symbol: '←' }, { symbol: '↑' }, { symbol: '↓' },
  ]

  const getSectionTitle = (sectionIndex) => {
    const section = lecture?.notes?.notes?.[sectionIndex]
    return String(section?.section || `Section ${sectionIndex + 1}`)
  }

  // Get all images from notes for occlusion/attachment
  const getAllNotesImages = () => {
    const images = []
    if (!lecture.notes) return images

    // Check for _pointImages object at the root level
    if (lecture.notes._pointImages) {
      Object.entries(lecture.notes._pointImages).forEach(([key, imageData]) => {
        // Key format is typically "sectionIdx-pointIdx"
        const [sectionIdx, pointIdx] = key.split('-').map(Number)
        const safeSectionIdx = Number.isNaN(sectionIdx) ? 0 : sectionIdx

        images.push({
          type: 'point-image',
          sectionIndex: safeSectionIdx,
          sectionKey: `section-${safeSectionIdx}`,
          sectionTitle: getSectionTitle(safeSectionIdx),
          pointIndex: pointIdx || 0,
          image: imageData,
          label: `Section ${safeSectionIdx + 1}, Point ${(pointIdx || 0) + 1}`
        })
      })
    }

    if (lecture.notes._sectionImages) {
      Object.entries(lecture.notes._sectionImages).forEach(([sectionIndexRaw, imageData]) => {
        const sectionIndex = Number(sectionIndexRaw)
        if (Number.isNaN(sectionIndex)) return
        images.push({
          type: 'section-image',
          sectionIndex,
          sectionKey: `section-${sectionIndex}`,
          sectionTitle: getSectionTitle(sectionIndex),
          image: imageData,
          label: `Section ${sectionIndex + 1}`
        })
      })
    }

    // Also check for images embedded in HTML content
    if (lecture.notes.notes) {
      lecture.notes.notes.forEach((section, sIdx) => {
        // Check for images embedded in section content as HTML
        if (section.section) {
          const sectionHtml = String(section.section)
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g
          let match
          while ((match = imgRegex.exec(sectionHtml)) !== null) {
            images.push({
              type: 'section-html',
              sectionIndex: sIdx,
              sectionKey: `section-${sIdx}`,
              sectionTitle: getSectionTitle(sIdx),
              image: { dataUrl: match[1] },
              label: section.section.replace(/<[^>]+>/g, '').substring(0, 50)
            })
          }
        }

        // Check point images in HTML
        if (section.points) {
          section.points.forEach((point, pIdx) => {
            const pointHtml = String(point)
            const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g
            let match
            while ((match = imgRegex.exec(pointHtml)) !== null) {
              images.push({
                type: 'point-html',
                sectionIndex: sIdx,
                sectionKey: `section-${sIdx}`,
                sectionTitle: getSectionTitle(sIdx),
                pointIndex: pIdx,
                image: { dataUrl: match[1] },
                label: pointHtml.replace(/<[^>]+>/g, '').substring(0, 50)
              })
            }
          })
        }
      })
    }

    return images
  }

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

    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: updatedFlashcards.length > 0 ? updatedFlashcards : undefined,
      }
      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)
      if (error) throw new Error(error.message)
      if (onSaved) onSaved()
    } catch (error) {
      console.error('Attach image failed:', error)
      alert(`Failed to attach image: ${error.message}`)
    }
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
    const cards = Array.isArray(lecture.notes?._flashcards) ? lecture.notes._flashcards : []
    setFlashcards(inferCardsSectionMetadata(cards, lecture.notes))
    setHasChanges(false)
  }, [lecture.id])

  const defaultTags = () => {
    const modulePart = module?.abbreviation ? `${module.abbreviation}_` : ''
    return `Day2 ${modulePart}${titleTag(lecture.title)}`.trim()
  }

  const saveFlashcards = async () => {
    setSaving(true)
    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: flashcards.length > 0 ? flashcards : undefined,
      }

      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)

      if (error) {
        throw new Error(error.message)
      }

      setHasChanges(false)
      if (onSaved) onSaved()
    } catch (error) {
      console.error('Save flashcards failed:', error)
      alert(`Failed to save flashcards: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAllFlashcards = async () => {
    setDeleting(true)
    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: undefined,
      }

      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)

      if (error) {
        throw new Error(error.message)
      }

      setFlashcards([])
      setHasChanges(false)
      setShowDeleteConfirm(false)
      if (onSaved) onSaved()
    } catch (error) {
      console.error('Delete flashcards failed:', error)
      alert(`Failed to delete flashcards: ${error.message}`)
    } finally {
      setDeleting(false)
    }
  }

  const exportCsv = () => {
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
    const a = document.createElement('a')
    a.href = url
    a.download = `${titleTag(lecture.title)}_anki.csv`
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
        const tags = String(cells[2] || defaultTags()).trim()
        if (!front || !back) continue
        imported.push({ front, back, tags })
      }

      if (!imported.length) throw new Error('No valid flashcards found in CSV')

      setFlashcards(imported)
      setHasChanges(true)
      setEditingCard(null)
      alert(`Imported ${imported.length} flashcards`)
    } catch (error) {
      console.error('CSV import failed:', error)
      alert(`CSV import failed: ${error.message}`)
    } finally {
      e.target.value = ''
    }
  }

  const addCard = async () => {
    if (!newCard.front.trim() || !newCard.back.trim()) return
    const updatedFlashcards = [
      ...flashcards,
      {
        front: newCard.front.trim(),
        back: newCard.back.trim(),
        tags: (newCard.tags || defaultTags()).trim(),
      },
    ]

    setFlashcards(updatedFlashcards)
    setNewCard({ front: '', back: '', tags: '' })
    setShowAddCard(false)

    // Save immediately
    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: updatedFlashcards,
      }

      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)

      if (error) throw new Error(error.message)

      if (onSaved) onSaved()
    } catch (error) {
      console.error('Save flashcard failed:', error)
      alert(`Failed to save: ${error.message}`)
    }
  }

  const startEditCard = (index) => {
    const card = flashcards[index]

    // Check if this is an occlusion card
    if (card.occlusionData) {
      setEditingOcclusionCard({
        index,
        originalImage: card.occlusionData.originalImage,
        label: { ...card.occlusionData.label },
        questionText: card.occlusionData.questionText || 'What is the masked structure?'
      })
      setOcclusionModalOpen(true)
      setOcclusionStep('edit-card')
    } else {
      setEditingCard({
        index,
        front: card.front || '',
        back: card.back || '',
        tags: card.tags || defaultTags(),
      })
      setActiveEditableImage(null)
      setExpandedCards((prev) => ({ ...prev, [index]: true }))
    }
  }

  const saveEditCard = async () => {
    if (!editingCard) return
    const { index, front, back, tags } = editingCard
    const updatedFlashcards = flashcards.map((card, i) => {
      if (i !== index) return card
      const nextBack = back.trim()
      const existingAnswerImages = Array.isArray(card.answerImages) ? card.answerImages : []
      const syncedAnswerImages = existingAnswerImages.filter((img) => nextBack.includes(img.dataUrl))
      return {
        ...card,
        front: front.trim(),
        back: nextBack,
        tags: tags.trim(),
        answerImages: syncedAnswerImages.length > 0 ? syncedAnswerImages : undefined
      }
    })

    setFlashcards(updatedFlashcards)
    setEditingCard(null)
    setActiveEditableImage(null)

    // Save immediately
    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: updatedFlashcards.length > 0 ? updatedFlashcards : undefined,
      }

      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)

      if (error) throw new Error(error.message)

      setHasChanges(false)
      if (onSaved) onSaved()
    } catch (error) {
      console.error('Save flashcard failed:', error)
      alert(`Failed to save: ${error.message}`)
    }
  }

  const deleteCard = async (index) => {
    const updatedFlashcards = flashcards.filter((_, i) => i !== index)
    setFlashcards(updatedFlashcards)

    // Save immediately
    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: updatedFlashcards.length > 0 ? updatedFlashcards : undefined,
      }

      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)

      if (error) throw new Error(error.message)

      if (onSaved) onSaved()
    } catch (error) {
      console.error('Delete flashcard failed:', error)
      alert(`Failed to delete: ${error.message}`)
    }
  }

  // Create masked image with one label covered
  const createMaskedImage = (imageDataUrl, labelToMask) => {
    return new Promise((resolve) => {
      const img = new Image()
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
      img.src = imageDataUrl
    })
  }

  // Generate occlusion cards
  const generateOcclusionCards = async () => {
    if (!selectedOcclusionImage || detectedLabels.length === 0) return

    const enabledLabels = detectedLabels.filter(l => l.enabled)
    if (enabledLabels.length === 0) {
      alert('Please enable at least one label to generate cards.')
      return
    }

    setOcclusionProcessing(true)
    setOcclusionStep('generating')

    try {
      // Generate cards - one per enabled label (no AI explanations)
      const newCards = []
      for (const label of enabledLabels) {
        const maskedDataUrl = await createMaskedImage(selectedOcclusionImage.image.dataUrl, label)

        newCards.push({
          front: `<img src="${maskedDataUrl}" style="max-width:400px;"><br><br>What is the masked structure?`,
          back: `<b>${label.text}</b><br><br><img src="${selectedOcclusionImage.image.dataUrl}" style="max-width:300px;">`,
          sectionIndex: selectedOcclusionImage.sectionIndex,
          sectionKey: selectedOcclusionImage.sectionKey,
          sectionTitle: selectedOcclusionImage.sectionTitle,
          occlusionData: {
            originalImage: selectedOcclusionImage.image.dataUrl,
            label: { x: label.x, y: label.y, width: label.width, height: label.height, text: label.text },
            questionText: 'What is the masked structure?'
          }
        })
      }

      setFlashcards(prev => [...prev, ...newCards])
      setHasChanges(true)

      // Close modal
      setOcclusionModalOpen(false)
      setOcclusionStep('select')
      setSelectedOcclusionImage(null)
      setDetectedLabels([])

      alert(`Generated ${newCards.length} occlusion cards!`)
    } catch (error) {
      console.error('Error generating occlusion cards:', error)
      alert('Failed to generate cards: ' + error.message)
    } finally {
      setOcclusionProcessing(false)
    }
  }

  // Save edited occlusion card
  const saveOcclusionCardEdit = async () => {
    if (!editingOcclusionCard) return
    const { index, originalImage, label, questionText } = editingOcclusionCard

    const maskedDataUrl = await createMaskedImage(originalImage, label)

    const updated = [...flashcards]
    updated[index] = {
      ...updated[index],
      front: `<img src="${maskedDataUrl}" style="max-width:400px;"><br><br>${questionText}`,
      back: `<b>${label.text}</b><br><br><img src="${originalImage}" style="max-width:300px;">`,
      occlusionData: {
        originalImage,
        label: { ...label },
        questionText
      }
    }
    setFlashcards(updated)
    setEditingOcclusionCard(null)

    // Save immediately
    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: updated,
      }

      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)

      if (error) throw new Error(error.message)

      if (onSaved) onSaved()
    } catch (error) {
      console.error('Save occlusion card failed:', error)
      alert(`Failed to save: ${error.message}`)
    }
  }

  // Generate interpretation card from selected image
  const generateInterpretationCard = async (imageData) => {
    if (!imageData) {
      console.error('No image data provided')
      return
    }

    setInterpretationProcessing(true)
    setInterpretationStep('generating')

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token

      if (!accessToken) {
        throw new Error('Please sign in')
      }

      console.log('Calling generate-interpretation edge function...')
      console.log('Access token:', accessToken ? 'Present' : 'Missing')

      // Extract media type from data URL (e.g., "data:image/png;base64,...")
      const dataUrl = imageData.image.dataUrl
      const mediaTypeMatch = dataUrl.match(/^data:(image\/[a-z]+);base64,/)
      const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : 'image/jpeg'
      const base64Data = dataUrl.split(',')[1]

      console.log('Detected media type:', mediaType)

      // Primary path: Supabase client invoke
      const { data: result, error } = await supabase.functions.invoke('generate-interpretation', {
        body: {
          image_base64: base64Data,
          media_type: mediaType
        }
      })

      console.log('Primary invoke response:', { result, error })

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

      // Fallback path: direct fetch (same pattern used by flashcards generation)
      console.log('Primary failed, trying fallback fetch...')
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
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
          media_type: mediaType
        }),
      })

      const fallbackResult = await response.json().catch(() => ({}))
      console.log('Fallback response:', { fallbackResult, status: response.status })

      if (!response.ok || !fallbackResult?.question) {
        const baseError =
          fallbackResult?.error ||
          error?.message ||
          `Edge Function request failed (${response.status})`
        throw new Error(baseError)
      }

      setInterpretationCard({
        question: fallbackResult.question,
        answer: fallbackResult.answer,
        imageDataUrl: imageData.image.dataUrl
      })
      setInterpretationStep('confirm')
    } catch (error) {
      console.error('Error generating interpretation card:', error)
      alert('Failed to generate card: ' + (error.message || JSON.stringify(error)))
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

    const updatedFlashcards = [...flashcards, newCard]
    setFlashcards(updatedFlashcards)

    // Reset modal
    setInterpretationModalOpen(false)
    setInterpretationStep('select')
    setSelectedInterpretationImage(null)
    setInterpretationCard(null)

    // Save immediately
    try {
      const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
      const updatedNotes = {
        ...baseNotes,
        _flashcards: updatedFlashcards,
      }

      const { error } = await supabase
        .from('lectures')
        .update({ notes: updatedNotes })
        .eq('id', lecture.id)

      if (error) throw new Error(error.message)

      if (onSaved) onSaved()
    } catch (error) {
      console.error('Save interpretation card failed:', error)
      alert(`Failed to save: ${error.message}`)
    }
  }

  const openOcclusionFromMenu = () => {
    const imageCount = getAllNotesImages().length
    if (imageCount === 0) {
      alert('No images found in your notes. Images must be added to your lecture notes before creating image-based flashcards.')
      return
    }
    setAddCardMenuOpen(false)
    setOcclusionModalOpen(true)
    setOcclusionStep('select')
  }

  const openInterpretationFromMenu = () => {
    const imageCount = getAllNotesImages().length
    if (imageCount === 0) {
      alert('No images found in your notes. Images must be added to your lecture notes before creating image-based flashcards.')
      return
    }
    setAddCardMenuOpen(false)
    setInterpretationModalOpen(true)
    setInterpretationStep('select')
  }

  const pickerCard = imagePickerCardIndex !== null ? flashcards[imagePickerCardIndex] : null
  const pickerImages = pickerCard ? getSuggestedImagesForCard(pickerCard) : []

  return (
    <div className="min-h-screen bg-background">
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
              {flashcards.length > 0 ? (
                <>
                  <button
                    onClick={exportCsv}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export CSV
                  </button>

                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 rounded-lg text-secondary text-sm transition-colors"
                    title="Delete all flashcards"
                  >
                    <Trash2 className="w-4 h-4" />
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
                placeholder={`Tags (default: ${defaultTags()})`}
                className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowAddCard(false)
                    setNewCard({ front: '', back: '', tags: '' })
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

          {flashcards.length === 0 ? (
            <p className="text-sm text-secondary py-8 text-center">No flashcards yet. Generate or import from the lecture screen.</p>
          ) : (
            <div className="space-y-3">
              {flashcards.map((card, index) => (
                <div key={index} className="border border-divider rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedCards((prev) => ({ ...prev, [index]: !prev[index] }))}
                    className="w-full px-4 py-3 flex justify-between items-center text-left bg-gray-50 hover:bg-gray-100"
                  >
                    <span className="text-sm text-primary truncate pr-3">
                      #{index + 1} {card.front.replace(/<[^>]+>/g, '').substring(0, 100)}
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
                          <input
                            type="text"
                            value={editingCard.tags}
                            onChange={(e) => setEditingCard((prev) => ({ ...prev, tags: e.target.value }))}
                            className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm"
                            placeholder="Tags"
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
                            <div className="text-sm text-primary" dangerouslySetInnerHTML={{ __html: card.front }} />
                          </div>
                          <div>
                            <p className="text-xs text-secondary mb-1">A:</p>
                            <p className="text-sm text-primary" dangerouslySetInnerHTML={{ __html: card.back }} />
                          </div>
                          <div className="flex justify-between items-center mt-3">
                            <p className="text-xs text-secondary">Tags: {card.tags || '-'}</p>
                            <div className="flex gap-2">
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
                                <Image className="w-3.5 h-3.5" />
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-divider p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-primary mb-2">Delete All Flashcards?</h3>
            <p className="text-sm text-secondary mb-6">
              This will permanently delete all {flashcards.length} flashcard{flashcards.length !== 1 ? 's' : ''}. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-primary rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAllFlashcards}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete All
                  </>
                )}
              </button>
            </div>
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

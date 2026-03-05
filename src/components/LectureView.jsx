import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, BookOpen, Target, TrendingUp, FileText, CheckCircle2, Circle, Upload, Loader2, AlertCircle, Eye, X, Trash2, FileUp, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { updateObjectiveCompletion, resetLectureNotes } from '../lib/lectureService'
import { generateAndSaveNotes } from '../lib/notesGenerator'
import { generateFlashcardsFromNotes } from '../lib/flashcardsGenerator'
import { NotesView } from './NotesView'
import { FlashcardsView } from './FlashcardsView'

export function LectureView({ lecture: initialLecture, module, user, onBack }) {
  const [lecture, setLecture] = useState(initialLecture)
  const [loading, setLoading] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [showFlashcards, setShowFlashcards] = useState(false)
  const [uploadState, setUploadState] = useState('idle') // idle, uploading, processing, complete, error
  const [uploadError, setUploadError] = useState(null)
  const [progressMessage, setProgressMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [userLearningObjectives, setUserLearningObjectives] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [uploadMode, setUploadMode] = useState('slides') // 'slides' or 'existing'
  const [slidesFile, setSlidesFile] = useState(null) // For existing mode: original slides PDF
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false)
  const [importingFlashcards, setImportingFlashcards] = useState(false)
  const fileInputRef = useRef(null)
  const slidesInputRef = useRef(null)
  const flashcardsCsvInputRef = useRef(null)

  useEffect(() => {
    fetchLectureData()
  }, [initialLecture.id])

  const fetchLectureData = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('lectures')
      .select('*')
      .eq('id', initialLecture.id)
      .single()

    if (error) {
      console.error('Error fetching lecture:', error)
    } else {
      setLecture(data)
    }
    setLoading(false)
  }

  const getPhaseDisplay = (phase) => {
    switch (phase) {
      case 'learn':
        return { label: 'Learn', colour: 'text-accent', bgColour: 'bg-blue-50' }
      case 'memorise':
        return { label: 'Memorise', colour: 'text-purple-600', bgColour: 'bg-purple-50' }
      case 'complete':
        return { label: 'Complete', colour: 'text-success', bgColour: 'bg-green-50' }
      default:
        return { label: 'Not Started', colour: 'text-secondary', bgColour: 'bg-gray-50' }
    }
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

  const phaseInfo = getPhaseDisplay(lecture.phase)
  const learningObjectives = lecture.learning_objectives || []
  const completedObjectives = learningObjectives.filter(obj => obj.completed).length
  const progress = lecture.progress || 0
  const flashcardsCount = Array.isArray(lecture.notes?._flashcards) ? lecture.notes._flashcards.length : 0

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
    }
  }

  const handleSlidesFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setSlidesFile(file)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleStartProcessing = () => {
    if (selectedFile) {
      if (uploadMode === 'existing') {
        // In existing mode, we need both the notes PDF and the slides PDF
        if (!slidesFile) {
          setUploadError('Please also upload the original lecture slides PDF for image extraction')
          return
        }
        handleConvertExistingNotes(selectedFile, slidesFile)
      } else {
        handleGenerateNotes(selectedFile)
      }
    }
  }

  const handleGenerateNotes = async (file) => {
    setUploadState('processing')
    setUploadError(null)
    setProgressMessage('Uploading slides for image extraction...')

    try {
      // Get user session
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id

      if (!userId) {
        throw new Error('Please sign in to generate notes')
      }

      // Upload the PDF to storage for image extraction later
      const slidesPath = `${userId}/${lecture.id}/slides_${Date.now()}.pdf`
      const { error: uploadError } = await supabase.storage
        .from('lecture-pdfs')
        .upload(slidesPath, file)

      if (uploadError) {
        console.error('Failed to upload slides for storage:', uploadError)
        // Don't fail - continue without storing (image insertion won't work but notes will)
      } else {
        // Save the pdf_path to the lecture
        await supabase
          .from('lectures')
          .update({ pdf_path: slidesPath })
          .eq('id', lecture.id)
      }

      setProgressMessage('AI is generating notes from slides...')

      const result = await generateAndSaveNotes(
        file,
        lecture.id,
        userLearningObjectives,
        (progress) => {
          setProgressMessage(progress.message)
        }
      )

      if (result.success) {
        setUploadState('complete')
        // Reset form state
        setSelectedFile(null)
        setUserLearningObjectives('')
        // Refresh lecture data
        await fetchLectureData()
        // Navigate to notes view
        setShowNotes(true)
      } else {
        setUploadError(result.error)
        setUploadState('error')
      }
    } catch (error) {
      setUploadError(error.message)
      setUploadState('error')
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleConvertExistingNotes = async (notesFile, slidesFile) => {
    setUploadState('processing')
    setUploadError(null)
    setProgressMessage('Uploading files...')

    try {
      // Refresh session to ensure valid token
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) {
        console.error('Session refresh error:', refreshError)
      }

      // Get user session for auth
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      const userId = sessionData?.session?.user?.id

      if (!accessToken || !userId) {
        throw new Error('Please sign in to convert notes')
      }

      console.log('Using token:', accessToken?.substring(0, 20) + '...')

      // Upload the slides PDF to storage for image extraction
      const slidesPath = `${userId}/${lecture.id}/slides.pdf`
      const { error: slidesUploadError } = await supabase.storage
        .from('lecture-pdfs')
        .upload(slidesPath, slidesFile, { upsert: true })

      if (slidesUploadError) {
        throw new Error(`Failed to upload slides: ${slidesUploadError.message}`)
      }

      // Upload the notes PDF to storage (to avoid body size limits)
      setProgressMessage('Uploading notes PDF...')
      const notesPath = `${userId}/${lecture.id}/notes-to-convert.pdf`
      const { error: notesUploadError } = await supabase.storage
        .from('lecture-pdfs')
        .upload(notesPath, notesFile, { upsert: true })

      if (notesUploadError) {
        throw new Error(`Failed to upload notes: ${notesUploadError.message}`)
      }

      // Call Edge Function to convert the PDF (pass storage path instead of base64)
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const functionUrl = `${supabaseUrl}/functions/v1/convert-legacy-notes`

      setProgressMessage('AI is parsing your notes...')

      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
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

      console.log('Response status:', response.status)
      const responseText = await response.text()
      console.log('Response body:', responseText)

      let result
      try {
        result = JSON.parse(responseText)
      } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`)
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to convert notes')
      }

      setProgressMessage('Saving converted notes...')

      // Save the converted notes to the database
      const notesData = {
        title: result.data.title || lecture.title,
        notes: result.data.notes || []
      }

      const { error: updateError } = await supabase
        .from('lectures')
        .update({
          learning_objectives: result.data.learning_objectives || [],
          notes: notesData,
          notes_generated: true,
          processed_at: new Date().toISOString(),
          phase: 'learn',
          pdf_path: slidesPath // Store the slides path for image extraction
        })
        .eq('id', lecture.id)

      if (updateError) {
        throw new Error(`Failed to save: ${updateError.message}`)
      }

      setUploadState('complete')
      setSelectedFile(null)
      setSlidesFile(null)
      await fetchLectureData()
      setShowNotes(true)

    } catch (error) {
      console.error('Convert notes error:', error)
      setUploadError(error.message)
      setUploadState('error')
    }

    // Reset file inputs
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    if (slidesInputRef.current) {
      slidesInputRef.current.value = ''
    }
  }

  const handleObjectiveToggle = async (objectiveId, currentCompleted) => {
    const result = await updateObjectiveCompletion(lecture.id, objectiveId, !currentCompleted)
    if (result.success) {
      // Refresh lecture data to get updated progress
      await fetchLectureData()
    }
  }

  const handleResetNotes = async () => {
    setResetting(true)
    const result = await resetLectureNotes(lecture.id)
    if (result.success) {
      setShowResetConfirm(false)
      setShowNotes(false)
      await fetchLectureData()
    } else {
      alert('Failed to reset: ' + result.error)
    }
    setResetting(false)
  }

  const upsertFlashcards = async (cards) => {
    const baseNotes = lecture.notes || { title: lecture.title, notes: [] }
    const updatedNotes = {
      ...baseNotes,
      _flashcards: cards.length > 0 ? cards : undefined
    }

    const { error } = await supabase
      .from('lectures')
      .update({ notes: updatedNotes })
      .eq('id', lecture.id)

    if (error) {
      throw new Error(`Failed to save flashcards: ${error.message}`)
    }

    await fetchLectureData()
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

  const handleGenerateFlashcards = async () => {
    if (!lecture.notes_generated || !lecture.notes?.notes?.length) {
      alert('Please generate notes first, then generate flashcards.')
      return
    }

    try {
      setGeneratingFlashcards(true)
      const cards = await generateFlashcardsFromNotes({
        notes: lecture.notes,
        lectureTitle: lecture.title,
        moduleAbbreviation: module?.abbreviation || '',
      })
      await upsertFlashcards(cards)
      alert(`Generated ${cards.length} flashcards`)
    } catch (error) {
      console.error('Flashcard generation failed:', error)
      alert(`Failed to generate flashcards: ${error.message}`)
    } finally {
      setGeneratingFlashcards(false)
    }
  }

  const handleImportFlashcardsCsv = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setImportingFlashcards(true)
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

      const sourceTitle = (lecture.title || 'Lecture')
        .split(/[\s_\-.]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('')
      const defaultTags = `Day2 ${module?.abbreviation ? `${module.abbreviation}_` : ''}${sourceTitle}`.trim()

      const imported = []
      for (let i = startIndex; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i])
        const front = String(cells[0] || '').trim()
        const back = String(cells[1] || '').trim()
        const tags = String(cells[2] || defaultTags).trim()
        if (!front || !back) continue
        imported.push({ front, back, tags })
      }

      if (!imported.length) {
        throw new Error('No valid flashcards found in CSV')
      }

      await upsertFlashcards(imported)
      alert(`Imported ${imported.length} flashcards`)
    } catch (error) {
      console.error('CSV import failed:', error)
      alert(`CSV import failed: ${error.message}`)
    } finally {
      setImportingFlashcards(false)
      e.target.value = ''
    }
  }

  // Show NotesView if notes are being viewed
  if (showNotes) {
    return (
      <NotesView
        lecture={lecture}
        module={module}
        onBack={() => setShowNotes(false)}
        onObjectiveToggle={async (objectiveId, currentCompleted) => {
          await handleObjectiveToggle(objectiveId, currentCompleted)
        }}
        onReset={async () => {
          setShowNotes(false)
          await fetchLectureData()
        }}
      />
    )
  }

  if (showFlashcards) {
    return (
      <FlashcardsView
        lecture={lecture}
        module={module}
        onBack={() => setShowFlashcards(false)}
        onSaved={fetchLectureData}
      />
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-secondary hover:text-primary mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {module.name}
        </button>

        <div className="flex items-center gap-4">
          <div
            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
            style={{ backgroundColor: `${module.color}15`, color: module.color }}
          >
            {module.abbreviation}
          </div>
          <h1 className="text-2xl font-bold text-primary">{lecture.title}</h1>
        </div>
      </div>

      {/* Factfile Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top Row: Phase and Progress */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Phase Card */}
            <div className="bg-surface rounded-xl border border-divider p-6">
              <div className="flex items-center gap-2 text-secondary text-sm font-medium mb-4">
                <Target className="w-4 h-4" />
                Phase
              </div>
              <div className="space-y-3">
                {['not_started', 'learn', 'memorise', 'complete'].map((phase) => {
                  const info = getPhaseDisplay(phase)
                  const isActive = lecture.phase === phase
                  const isPast = ['not_started', 'learn', 'memorise', 'complete'].indexOf(lecture.phase) >
                                 ['not_started', 'learn', 'memorise', 'complete'].indexOf(phase)

                  return (
                    <div key={phase} className="flex items-center gap-3">
                      {isActive ? (
                        <div className={`w-5 h-5 rounded-full ${info.bgColour} flex items-center justify-center`}>
                          <div className={`w-2.5 h-2.5 rounded-full bg-current ${info.colour}`} />
                        </div>
                      ) : isPast ? (
                        <CheckCircle2 className="w-5 h-5 text-success" />
                      ) : (
                        <Circle className="w-5 h-5 text-gray-300" />
                      )}
                      <span className={`text-sm ${isActive ? info.colour + ' font-medium' : isPast ? 'text-secondary' : 'text-gray-400'}`}>
                        {info.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Progress Card */}
            <div className="bg-surface rounded-xl border border-divider p-6">
              <div className="flex items-center gap-2 text-secondary text-sm font-medium mb-4">
                <TrendingUp className="w-4 h-4" />
                Progress
              </div>
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-primary">{progress}</span>
                  <span className="text-xl text-secondary mb-1">%</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-secondary">
                  {progress === 0 ? 'Not yet started' :
                   progress === 100 ? 'Fully covered' :
                   'In progress'}
                </p>
              </div>
            </div>
          </div>

          {/* Learning Objectives Card */}
          <div className="bg-surface rounded-xl border border-divider p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-secondary text-sm font-medium">
                <BookOpen className="w-4 h-4" />
                Learning Objectives
              </div>
              {learningObjectives.length > 0 && (
                <span className="text-sm text-secondary">
                  {completedObjectives}/{learningObjectives.length} completed
                </span>
              )}
            </div>

            {learningObjectives.length === 0 ? (
              <div className="py-8 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl mb-3">
                  <BookOpen className="w-6 h-6 text-secondary" />
                </div>
                <p className="text-secondary text-sm">
                  Learning objectives will appear here once the lecture is processed
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {learningObjectives.map((objective, index) => (
                  <button
                    key={objective.id || index}
                    onClick={() => handleObjectiveToggle(objective.id, objective.completed)}
                    className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors w-full text-left"
                  >
                    {objective.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-300 flex-shrink-0 mt-0.5" />
                    )}
                    <span className={`text-sm leading-relaxed ${objective.completed ? 'text-secondary line-through' : 'text-primary'}`}>
                      {objective.text}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Upload Section - shown when notes not generated */}
          {!lecture.notes_generated && (
            <div className="bg-surface rounded-xl border border-divider p-6">
              <div className="flex items-center gap-2 text-secondary text-sm font-medium mb-4">
                <Upload className="w-4 h-4" />
                Generate Notes
              </div>

              {uploadState === 'idle' && (
                <div className="space-y-6">
                  {/* Mode Toggle */}
                  <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                    <button
                      onClick={() => {
                        setUploadMode('slides')
                        setSlidesFile(null)
                        setUploadError(null)
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        uploadMode === 'slides'
                          ? 'bg-white text-primary shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <Upload className="w-4 h-4" />
                      Generate from Slides
                    </button>
                    <button
                      onClick={() => {
                        setUploadMode('existing')
                        setUploadError(null)
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        uploadMode === 'existing'
                          ? 'bg-white text-primary shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <FileUp className="w-4 h-4" />
                      Convert Existing Notes
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-secondary">
                    {uploadMode === 'slides'
                      ? 'Upload your lecture slides PDF and AI will generate concise revision notes.'
                      : 'Upload your existing notes PDF to convert to editable format, plus the original lecture slides for image extraction.'}
                  </p>

                  {/* Learning Objectives Input - only for slides mode */}
                  {uploadMode === 'slides' && (
                    <div>
                      <label className="block text-sm font-medium text-primary mb-2">
                        Learning Objectives (Optional)
                      </label>
                      <textarea
                        value={userLearningObjectives}
                        onChange={(e) => setUserLearningObjectives(e.target.value)}
                        placeholder="Enter learning objectives, one per line. Leave blank to auto-extract from the PDF."
                        className="w-full h-32 px-4 py-3 bg-background border border-divider rounded-xl text-primary placeholder:text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent resize-none"
                      />
                      <p className="text-xs text-secondary mt-1">
                        If provided, these will be used instead of AI-extracted objectives.
                      </p>
                    </div>
                  )}

                  {/* PDF Upload Area */}
                  <div className="space-y-4">
                    {/* Notes/Slides PDF (primary file) */}
                    <div>
                      <label className="block text-sm font-medium text-primary mb-2">
                        {uploadMode === 'slides' ? 'Lecture Slides PDF' : '1. Existing Notes PDF'}
                      </label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        onChange={handleFileSelect}
                        className="hidden"
                      />

                      {!selectedFile ? (
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          onDrop={handleDrop}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                            isDragOver
                              ? 'border-accent bg-blue-50'
                              : 'border-divider hover:border-accent hover:bg-gray-50'
                          }`}
                        >
                          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-xl mb-3">
                            <Upload className="w-6 h-6 text-accent" />
                          </div>
                          <p className="text-primary font-medium mb-1">
                            {uploadMode === 'slides'
                              ? 'Drop your PDF here or click to browse'
                              : 'Upload your existing notes PDF'}
                          </p>
                          <p className="text-secondary text-sm">
                            Supports PDF files up to 10MB
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-divider">
                          <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                            <FileText className="w-5 h-5 text-red-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-primary truncate">
                              {selectedFile.name}
                            </p>
                            <p className="text-xs text-secondary">
                              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedFile(null)
                              if (fileInputRef.current) {
                                fileInputRef.current.value = ''
                              }
                            }}
                            className="p-2 text-secondary hover:text-error hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Slides PDF - only shown in 'existing' mode */}
                    {uploadMode === 'existing' && (
                      <div>
                        <label className="block text-sm font-medium text-primary mb-2">
                          2. Original Lecture Slides PDF
                          <span className="text-secondary font-normal ml-2">(for image extraction)</span>
                        </label>
                        <input
                          ref={slidesInputRef}
                          type="file"
                          accept=".pdf"
                          onChange={handleSlidesFileSelect}
                          className="hidden"
                        />

                        {!slidesFile ? (
                          <div
                            onClick={() => slidesInputRef.current?.click()}
                            className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors border-divider hover:border-orange-400 hover:bg-orange-50"
                          >
                            <div className="inline-flex items-center justify-center w-10 h-10 bg-orange-50 rounded-xl mb-2">
                              <FileUp className="w-5 h-5 text-orange-500" />
                            </div>
                            <p className="text-primary font-medium mb-1 text-sm">
                              Upload original lecture slides
                            </p>
                            <p className="text-secondary text-xs">
                              Required for inserting images from slides
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 p-4 bg-orange-50 rounded-xl border border-orange-200">
                            <div className="flex-shrink-0 w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                              <FileText className="w-5 h-5 text-orange-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-primary truncate">
                                {slidesFile.name}
                              </p>
                              <p className="text-xs text-secondary">
                                {(slidesFile.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setSlidesFile(null)
                                if (slidesInputRef.current) {
                                  slidesInputRef.current.value = ''
                                }
                              }}
                              className="p-2 text-secondary hover:text-error hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline Error Display */}
                  {uploadError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {uploadError}
                    </div>
                  )}

                  {/* Generate Button */}
                  <button
                    onClick={handleStartProcessing}
                    disabled={!selectedFile || (uploadMode === 'existing' && !slidesFile)}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
                  >
                    <FileText className="w-5 h-5" />
                    {uploadMode === 'slides' ? 'Generate Notes' : 'Convert Notes'}
                  </button>
                </div>
              )}

              {uploadState === 'processing' && (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl mb-4">
                    <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  </div>
                  <h3 className="text-lg font-medium text-primary mb-2">
                    Generating Notes...
                  </h3>
                  <p className="text-secondary text-sm">
                    {progressMessage || 'AI is analysing your lecture content'}
                  </p>
                  <p className="text-xs text-secondary mt-4">
                    This may take up to a minute depending on the PDF size
                  </p>
                </div>
              )}

              {uploadState === 'error' && (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-2xl mb-4">
                    <AlertCircle className="w-8 h-8 text-error" />
                  </div>
                  <h3 className="text-lg font-medium text-primary mb-2">Processing Failed</h3>
                  <p className="text-error text-sm mb-6">{uploadError}</p>
                  <button
                    onClick={() => {
                      setUploadState('idle')
                      setUploadError(null)
                      setSelectedFile(null)
                      setSlidesFile(null)
                    }}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-blue-600 rounded-xl font-medium text-white transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Bottom Row: Metadata Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Flashcards Card */}
            <div className="bg-surface rounded-xl border border-divider p-6">
              <div className="flex items-center gap-2 text-secondary text-sm font-medium mb-2">
                <Layers className="w-4 h-4" />
                Flashcards
              </div>
              <p className={`text-lg font-medium ${flashcardsCount > 0 ? 'text-success' : 'text-secondary'}`}>
                {flashcardsCount > 0 ? 'Generated' : 'Not yet generated'}
              </p>
              {flashcardsCount > 0 && lecture.processed_at && (
                <p className="text-sm text-secondary mt-1">
                  Processed {formatDate(lecture.processed_at)}
                </p>
              )}
              {flashcardsCount > 0 ? (
                <div className="mt-4 space-y-3">
                  <button
                    onClick={() => setShowFlashcards(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-blue-600 rounded-lg font-medium text-white text-sm transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    View Flashcards
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={handleGenerateFlashcards}
                      disabled={!lecture.notes_generated || generatingFlashcards}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg font-medium text-white text-sm transition-colors"
                    >
                      {generatingFlashcards ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                      {generatingFlashcards ? 'Generating...' : 'Generate'}
                    </button>
                    <button
                      onClick={() => flashcardsCsvInputRef.current?.click()}
                      disabled={importingFlashcards}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg font-medium text-white text-sm transition-colors"
                    >
                      {importingFlashcards ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {importingFlashcards ? 'Importing...' : 'Import CSV'}
                    </button>
                    <input
                      ref={flashcardsCsvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleImportFlashcardsCsv}
                      className="hidden"
                    />
                  </div>
                  {!lecture.notes_generated && (
                    <p className="text-xs text-secondary mt-2">
                      Generate requires notes first. CSV import works anytime.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Notes Status Card */}
            <div className="bg-surface rounded-xl border border-divider p-6">
              <div className="flex items-center gap-2 text-secondary text-sm font-medium mb-2">
                <FileText className="w-4 h-4" />
                Notes
              </div>
              <p className={`text-lg font-medium ${lecture.notes_generated ? 'text-success' : 'text-secondary'}`}>
                {lecture.notes_generated ? 'Generated' : 'Not yet generated'}
              </p>
              {lecture.processed_at && (
                <p className="text-sm text-secondary mt-1">
                  Processed {formatDate(lecture.processed_at)}
                </p>
              )}
              {lecture.notes_generated && (
                <div className="mt-4 space-y-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowNotes(true)}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-blue-600 rounded-lg font-medium text-white text-sm transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      View Notes
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(true)}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 rounded-lg text-secondary text-sm transition-colors"
                      title="Remove notes and start fresh"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Reset Confirmation */}
                  {showResetConfirm && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800 mb-3">
                        Remove all notes and learning objectives for this lecture?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleResetNotes}
                          disabled={resetting}
                          className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {resetting ? 'Removing...' : 'Yes, Remove'}
                        </button>
                        <button
                          onClick={() => setShowResetConfirm(false)}
                          disabled={resetting}
                          className="flex-1 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-primary text-sm font-medium rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

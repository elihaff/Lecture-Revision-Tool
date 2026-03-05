import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Save, Plus, Upload, Download, Trash2, Edit2, Check, X, Loader2 } from 'lucide-react'
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

  const essentialSymbols = [
    { symbol: 'α' }, { symbol: 'β' }, { symbol: 'Δ' }, { symbol: 'μ' },
    { symbol: '→' }, { symbol: '←' }, { symbol: '↑' }, { symbol: '↓' },
  ]

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
    setFlashcards(Array.isArray(lecture.notes?._flashcards) ? lecture.notes._flashcards : [])
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

  const addCard = () => {
    if (!newCard.front.trim() || !newCard.back.trim()) return
    setFlashcards((prev) => [
      ...prev,
      {
        front: newCard.front.trim(),
        back: newCard.back.trim(),
        tags: (newCard.tags || defaultTags()).trim(),
      },
    ])
    setNewCard({ front: '', back: '', tags: '' })
    setShowAddCard(false)
    setHasChanges(true)
  }

  const startEditCard = (index) => {
    const card = flashcards[index]
    setEditingCard({
      index,
      front: card.front || '',
      back: card.back || '',
      tags: card.tags || defaultTags(),
    })
    setExpandedCards((prev) => ({ ...prev, [index]: true }))
  }

  const saveEditCard = () => {
    if (!editingCard) return
    const { index, front, back, tags } = editingCard
    setFlashcards((prev) =>
      prev.map((card, i) => (i === index ? { ...card, front: front.trim(), back: back.trim(), tags: tags.trim() } : card))
    )
    setEditingCard(null)
    setHasChanges(true)
  }

  const deleteCard = (index) => {
    setFlashcards((prev) => prev.filter((_, i) => i !== index))
    setHasChanges(true)
  }

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
                  {/* Status tile - Generated */}
                  <div className="flex items-center gap-3 bg-surface border border-divider rounded-lg px-4 py-2">
                    <div>
                      <p className="text-lg font-medium text-success">Generated</p>
                      {lecture.processed_at && (
                        <p className="text-xs text-secondary">Processed {formatDate(lecture.processed_at)}</p>
                      )}
                    </div>
                  </div>

                  {hasChanges && (
                    <button
                      onClick={saveFlashcards}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  )}

                  <button
                    onClick={exportCsv}
                    className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors"
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
                  {hasChanges && (
                    <button
                      onClick={saveFlashcards}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowAddCard((prev) => !prev)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Card
                  </button>
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
                    className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white rounded-lg text-sm font-medium transition-colors"
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
                    <span className="text-sm text-primary truncate pr-3">#{index + 1} {card.front}</span>
                    <span className="text-xs text-secondary">{expandedCards[index] ? '▲' : '▼'}</span>
                  </button>

                  {expandedCards[index] && (
                    <div className="px-4 py-3 border-t border-divider">
                      {editingCard?.index === index ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editingCard.front}
                            onChange={(e) => setEditingCard((prev) => ({ ...prev, front: e.target.value }))}
                            className="w-full bg-white border border-divider rounded-lg px-3 py-2 text-sm"
                            placeholder="Front"
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
                            onInput={(e) => {
                              const html = e.currentTarget.innerHTML
                              setEditingCard(p => ({ ...p, back: html }))
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
                            <p className="text-sm text-primary">{card.front}</p>
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
                                className="px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm flex items-center gap-1"
                              >
                                <Edit2 className="w-3.5 h-3.5" />Edit
                              </button>
                              <button
                                onClick={() => deleteCard(index)}
                                className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded text-sm flex items-center gap-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />Delete
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
    </div>
  )
}

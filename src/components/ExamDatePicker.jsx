import { useState } from 'react'
import { Calendar, X, Check, Loader2 } from 'lucide-react'
import { calculateDaysUntilExam } from '../lib/userSettingsService'

/**
 * Compact exam date picker for Dashboard header
 */
export function ExamDatePicker({ examDate, onSave, loading }) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState(examDate || '')

  const daysUntil = calculateDaysUntilExam(examDate)

  const handleSave = async () => {
    await onSave(inputValue || null)
    setIsEditing(false)
  }

  const handleClear = async () => {
    setInputValue('')
    await onSave(null)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setInputValue(examDate || '')
    setIsEditing(false)
  }

  // Format date for display
  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return null
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin text-secondary" />
        <span className="text-sm text-secondary">Loading...</span>
      </div>
    )
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          min={new Date().toISOString().split('T')[0]}
          className="px-2 py-1 text-sm border border-divider rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={handleSave}
          disabled={loading}
          className="p-1.5 bg-green-100 hover:bg-green-200 rounded-lg transition-colors"
          title="Save"
        >
          <Check className="w-4 h-4 text-green-600" />
        </button>
        {examDate && (
          <button
            onClick={handleClear}
            disabled={loading}
            className="p-1.5 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
            title="Clear exam date"
          >
            <X className="w-4 h-4 text-red-600" />
          </button>
        )}
        <button
          onClick={handleCancel}
          className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          title="Cancel"
        >
          <X className="w-4 h-4 text-gray-600" />
        </button>
      </div>
    )
  }

  // Display mode
  if (examDate && daysUntil) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
        title="Click to edit exam date"
      >
        <Calendar className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-medium text-blue-700">
          {formatDisplayDate(examDate)}
        </span>
        <span className="text-xs text-blue-500">
          ({daysUntil}d)
        </span>
      </button>
    )
  }

  // No exam date set
  return (
    <button
      onClick={() => setIsEditing(true)}
      className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
      title="Set exam date for adaptive scheduling"
    >
      <Calendar className="w-4 h-4 text-secondary" />
      <span className="text-sm text-secondary">Set exam date</span>
    </button>
  )
}

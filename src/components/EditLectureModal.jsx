import { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'

export function EditLectureModal({ lecture, onClose, onSave }) {
  const [title, setTitle] = useState(lecture.title)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await onSave({ title })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="bg-surface rounded-2xl w-full max-w-md border border-divider shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-divider">
          <h2 className="text-xl font-semibold text-primary">Edit Lecture</h2>
          <button
            onClick={onClose}
            className="p-2 text-secondary hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Lecture Title */}
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
              Lecture Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Introduction to Cardiology"
              required
              autoFocus
              className="w-full px-4 py-3 bg-gray-50 border border-divider rounded-xl text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-error text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title}
              className="flex-1 py-3 bg-accent hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
              ) : (
                'Save'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

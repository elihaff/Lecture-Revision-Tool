import { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'

const COLORS = [
  '#007AFF', // blue (accent)
  '#5856D6', // purple
  '#AF52DE', // violet
  '#FF2D55', // pink
  '#FF3B30', // red
  '#FF9500', // orange
  '#FFCC00', // yellow
  '#34C759', // green
  '#00C7BE', // teal
]

export function CreateModuleModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [abbreviation, setAbbreviation] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await onCreate({ name, abbreviation, color })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  // Auto-generate abbreviation from name
  const handleNameChange = (value) => {
    setName(value)
    if (!abbreviation || abbreviation === generateAbbrev(name)) {
      setAbbreviation(generateAbbrev(value))
    }
  }

  const generateAbbrev = (text) => {
    return text
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase())
      .join('')
      .slice(0, 4)
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="bg-surface rounded-2xl w-full max-w-md border border-divider shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-divider">
          <h2 className="text-xl font-semibold text-primary">Create Module</h2>
          <button
            onClick={onClose}
            className="p-2 text-secondary hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Module Name */}
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
              Module Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g., Cardiorespiratory"
              required
              className="w-full px-4 py-3 bg-gray-50 border border-divider rounded-xl text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          {/* Abbreviation */}
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
              Abbreviation
            </label>
            <input
              type="text"
              value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value.toUpperCase())}
              placeholder="e.g., CR2"
              required
              maxLength={6}
              className="w-full px-4 py-3 bg-gray-50 border border-divider rounded-xl text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent uppercase"
            />
            <p className="mt-1.5 text-xs text-secondary">
              Used for tagging flashcards
            </p>
          </div>

          {/* Colour */}
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
              Colour
            </label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-all ${
                    color === c
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface'
                      : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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
              disabled={loading || !name || !abbreviation}
              className="flex-1 py-3 bg-accent hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
              ) : (
                'Create'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

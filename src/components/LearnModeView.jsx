import { useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, BookOpen } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { recomputeLectureProgress } from '../lib/lectureService'
import { useToast } from './Toast'

export function LearnModeView({ lecture, module, onBack, onComplete }) {
  const toast = useToast()
  const notes = lecture.notes || { notes: [] }
  const sections = notes.notes || []
  const [currentSectionIndex, setCurrentSectionIndex] = useState(lecture.learn_progress || 0)
  const [understood, setUnderstood] = useState(false)
  const [completing, setCompleting] = useState(false)

  // Convert markdown bold **text** to HTML <strong>text</strong>
  const formatBoldText = (text) => {
    if (!text) return ''
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  }

  const currentSection = sections[currentSectionIndex]
  const isLastSection = currentSectionIndex === sections.length - 1
  const progress = ((currentSectionIndex + 1) / sections.length) * 100

  // Save progress to database when section changes
  const saveProgress = async (sectionIndex) => {
    try {
      await supabase
        .from('lectures')
        .update({ learn_progress: sectionIndex })
        .eq('id', lecture.id)
    } catch {
      // Progress save failed silently - non-critical
    }
  }

  const handleNext = async () => {
    if (currentSectionIndex < sections.length - 1) {
      const nextIndex = currentSectionIndex + 1
      setCurrentSectionIndex(nextIndex)
      setUnderstood(false) // Reset checkbox for next section
      await saveProgress(nextIndex)
    }
  }

  const handleComplete = async () => {
    setCompleting(true)
    try {
      // Mark Learn Mode completion and reset local section tracker.
      const { error } = await supabase
        .from('lectures')
        .update({
          learn_progress: 0  // Reset progress when completed
        })
        .eq('id', lecture.id)

      if (error) {
        toast.error('Failed to update progress. Please try again.')
      } else {
        await recomputeLectureProgress(lecture.id, { markLearnCompleted: true })
        if (onComplete) onComplete()
        onBack()
      }
    } catch {
      toast.error('An error occurred. Please try again.')
    } finally {
      setCompleting(false)
    }
  }

  const getSectionPointLevels = (section) => {
    if (!section || !Array.isArray(section.pointLevels)) {
      return Array(section?.points?.length || 0).fill(0)
    }
    return section.pointLevels
  }

  const getIndentClass = (level) => {
    const indents = [
      'ml-0',
      'ml-6',
      'ml-12',
      'ml-18',
      'ml-24',
      'ml-30',
      'ml-36'
    ]
    return indents[Math.min(level, 6)] || 'ml-0'
  }

  const getBulletStyle = (level) => {
    const styles = [
      'list-disc',
      'list-circle',
      'list-square'
    ]
    return styles[Math.min(level, 2)]
  }

  if (sections.length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-20">
          <p className="text-secondary">No notes available for this lecture.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-divider sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-secondary hover:text-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back to Lecture</span>
            </button>

            <div className="flex items-center gap-4">
              <div
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: `${module.color}15`, color: module.color }}
              >
                {module.abbreviation}
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-secondary" />
                <span className="text-sm font-medium text-primary">Learn Mode</span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-secondary">
                Section {currentSectionIndex + 1} of {sections.length}
              </span>
              <span className="text-xs text-secondary">
                {Math.round(progress)}% complete
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-accent rounded-full h-2 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-surface rounded-2xl p-8 shadow-sm border border-divider">
          {/* Section Title */}
          <h2 className="text-2xl font-bold text-primary mb-6">
            {currentSection.section}
          </h2>

          {/* Section Content */}
          <div className="prose prose-sm max-w-none mb-8">
            <ul className="space-y-3">
              {(currentSection.points || []).map((point, idx) => {
                const level = getSectionPointLevels(currentSection)[idx] || 0
                return (
                  <li
                    key={idx}
                    className={`${getIndentClass(level)} ${getBulletStyle(level)} leading-relaxed text-primary`}
                  >
                    <span
                      className="notes-content"
                      dangerouslySetInnerHTML={{ __html: formatBoldText(point) }}
                    />
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Understanding Checkbox */}
          <div className="border-t border-divider pt-6 mb-6">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => setUnderstood(!understood)}
                className="flex items-center justify-center w-6 h-6 rounded border-2 border-accent transition-colors hover:bg-accent/10"
              >
                {understood && <CheckCircle2 className="w-5 h-5 text-accent" />}
                {!understood && <Circle className="w-5 h-5 text-gray-300" />}
              </div>
              <span className="text-primary font-medium group-hover:text-accent transition-colors">
                I understand this section
              </span>
            </label>
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between">
            <button
              onClick={async () => {
                if (currentSectionIndex > 0) {
                  const prevIndex = currentSectionIndex - 1
                  setCurrentSectionIndex(prevIndex)
                  setUnderstood(false)
                  await saveProgress(prevIndex)
                }
              }}
              disabled={currentSectionIndex === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                currentSectionIndex === 0
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 hover:bg-gray-200 text-primary'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              Previous
            </button>

            {!isLastSection ? (
              <button
                onClick={handleNext}
                disabled={!understood}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors ${
                  !understood
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-accent hover:bg-blue-600 text-white'
                }`}
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={!understood || completing}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors ${
                  !understood || completing
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {completing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Completing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Complete Learning
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Section Navigator */}
        <div className="mt-6 bg-surface rounded-xl p-4 border border-divider">
          <h3 className="text-sm font-medium text-secondary mb-3">All Sections</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {sections.map((section, idx) => (
              <button
                key={idx}
                onClick={async () => {
                  setCurrentSectionIndex(idx)
                  setUnderstood(false)
                  await saveProgress(idx)
                }}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  idx === currentSectionIndex
                    ? 'bg-accent text-white'
                    : idx < currentSectionIndex
                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                    : 'bg-gray-100 text-secondary hover:bg-gray-200'
                }`}
              >
                {idx + 1}. {section.section?.replace(/^\d+\.\s*/, '').substring(0, 20)}
                {section.section?.length > 20 ? '...' : ''}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

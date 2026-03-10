import { useState, useEffect } from 'react'
import { ArrowLeft, Check, RotateCcw, BookOpen, Loader2, Zap, AlertCircle, MinusCircle, RefreshCw } from 'lucide-react'
import { getLectureReviewQueue, recordReview } from '../lib/flashcardService'
import { RATING, getNextIntervals, shuffle } from '../lib/srsAlgorithmV2'
import { resetFlashcard, getFlashcardsByLecture } from '../lib/flashcardService'

export function FlashcardReviewView({ lecture, module, onBack }) {
  // State
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reviewQueue, setReviewQueue] = useState([]) // Cards to review this session
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [reviewedCardIds, setReviewedCardIds] = useState(new Set())
  const [sessionStats, setSessionStats] = useState({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  })
  const [saving, setSaving] = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [reviewStartTime, setReviewStartTime] = useState(null)
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Load review queue on mount
  useEffect(() => {
    loadReviewQueue()
  }, [lecture.id])

  const loadReviewQueue = async () => {
    setLoading(true)
    setError(null)

    try {
      // Get due cards + new cards for this lecture
      const { dueCards, newCards, total, error: queueError } = await getLectureReviewQueue(lecture.id)

      if (queueError) throw queueError

      if (total === 0) {
        setSessionComplete(true)
        setLoading(false)
        return
      }

      // Combine and shuffle cards
      // Show due cards first, then new cards
      const combined = [...dueCards, ...newCards]
      const shuffled = shuffle(combined)

      setReviewQueue(shuffled)
      setLoading(false)
    } catch (err) {
      console.error('Failed to load review queue:', err)
      setError(err.message)
      setLoading(false)
    }
  }

  const currentCard = reviewQueue[currentIndex]
  const remainingCards = reviewQueue.length - reviewedCardIds.size
  const progress = reviewQueue.length > 0 ? (reviewedCardIds.size / reviewQueue.length) * 100 : 0

  // Calculate next intervals for button labels
  const nextIntervals = currentCard && isFlipped ? getNextIntervals(currentCard) : {}

  const handleFlip = () => {
    if (!isFlipped) {
      setReviewStartTime(Date.now())
    }
    setIsFlipped(!isFlipped)
  }

  const handleRating = async (rating) => {
    if (!currentCard || saving) return

    setSaving(true)

    try {
      // Calculate review time
      const timeMs = reviewStartTime ? Date.now() - reviewStartTime : null

      // Record review in database
      const { error: reviewError } = await recordReview(currentCard.id, rating, timeMs)

      if (reviewError) {
        throw reviewError
      }

      // Update session stats
      const ratingKey = Object.keys(RATING).find(key => RATING[key] === rating).toLowerCase()
      setSessionStats(prev => ({
        ...prev,
        [ratingKey]: prev[ratingKey] + 1,
      }))

      // Mark card as reviewed
      setReviewedCardIds(prev => new Set([...prev, currentCard.id]))

      // Handle "Again" cards - add back to queue for same session
      if (rating === RATING.AGAIN) {
        // Fetch updated card state from database
        const { data: updatedCard } = await recordReview(currentCard.id, rating, timeMs)

        // Add card back to queue (3-5 cards ahead)
        const insertPosition = Math.min(
          currentIndex + 3 + Math.floor(Math.random() * 3),
          reviewQueue.length
        )

        const newQueue = [...reviewQueue]
        newQueue.splice(insertPosition, 0, updatedCard || currentCard)
        setReviewQueue(newQueue)
      }

      // Move to next card or finish
      if (currentIndex < reviewQueue.length - 1) {
        setCurrentIndex(currentIndex + 1)
        setIsFlipped(false)
        setReviewStartTime(null)
        setSaving(false)
      } else {
        // Check if there are more cards (from Again cycling)
        if (reviewedCardIds.size < reviewQueue.length) {
          setCurrentIndex(currentIndex + 1)
          setIsFlipped(false)
          setReviewStartTime(null)
          setSaving(false)
        } else {
          setSessionComplete(true)
          setSaving(false)
        }
      }
    } catch (err) {
      console.error('Failed to record review:', err)
      alert('Failed to save review: ' + err.message)
      setSaving(false)
    }
  }

  const handleResetProgress = async () => {
    setResetting(true)

    try {
      // Get all flashcards for this lecture
      const { data: cards, error: fetchError } = await getFlashcardsByLecture(lecture.id)

      if (fetchError) throw fetchError

      // Reset each card
      for (const card of cards) {
        await resetFlashcard(card.id)
      }

      // Reload review queue
      await loadReviewQueue()

      // Reset UI state
      setCurrentIndex(0)
      setIsFlipped(false)
      setReviewedCardIds(new Set())
      setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 })
      setSessionComplete(false)
      setShowResetModal(false)
      setResetting(false)
    } catch (err) {
      console.error('Failed to reset progress:', err)
      alert('Failed to reset progress: ' + err.message)
      setResetting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-accent animate-spin mx-auto mb-4" />
          <p className="text-secondary">Loading review queue...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background p-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-secondary hover:text-primary mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Lecture
        </button>
        <div className="max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900 mb-1">Failed to load review queue</h3>
              <p className="text-sm text-red-700">{error}</p>
              <button
                onClick={loadReviewQueue}
                className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Session complete
  if (sessionComplete) {
    const totalReviewed = sessionStats.again + sessionStats.hard + sessionStats.good + sessionStats.easy

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
                  <span className="text-sm font-medium text-primary">Review Complete</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Summary */}
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-surface rounded-2xl p-8 shadow-sm border border-divider text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-2xl mb-4">
              <Check className="w-8 h-8 text-green-600" />
            </div>

            <h2 className="text-2xl font-bold text-primary mb-2">Session Complete!</h2>
            <p className="text-secondary mb-8">
              You reviewed {totalReviewed} card{totalReviewed !== 1 ? 's' : ''}
              {reviewQueue.length === 0 && ' - All caught up!'}
            </p>

            {/* Stats */}
            {totalReviewed > 0 && (
              <div className="grid grid-cols-4 gap-3 mb-8">
                <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                  <div className="text-2xl font-bold text-red-600 mb-1">{sessionStats.again}</div>
                  <p className="text-xs text-red-700">Again</p>
                </div>

                <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                  <div className="text-2xl font-bold text-orange-600 mb-1">{sessionStats.hard}</div>
                  <p className="text-xs text-orange-700">Hard</p>
                </div>

                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <div className="text-2xl font-bold text-blue-600 mb-1">{sessionStats.good}</div>
                  <p className="text-xs text-blue-700">Good</p>
                </div>

                <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                  <div className="text-2xl font-bold text-green-600 mb-1">{sessionStats.easy}</div>
                  <p className="text-xs text-green-700">Easy</p>
                </div>
              </div>
            )}

            {/* No cards message */}
            {reviewQueue.length === 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
                <p className="text-blue-900 font-medium mb-2">All caught up!</p>
                <p className="text-sm text-blue-700">
                  No cards are due for review right now. Come back later to continue learning.
                </p>
              </div>
            )}

            {/* Actions */}
            <button
              onClick={onBack}
              className="w-full px-6 py-3 bg-accent hover:bg-blue-600 rounded-xl font-medium text-white transition-colors"
            >
              Back to Lecture
            </button>
          </div>
        </main>
      </div>
    )
  }

  // No current card (shouldn't happen)
  if (!currentCard) {
    return (
      <div className="min-h-screen bg-background p-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-secondary hover:text-primary mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Lecture
        </button>
        <div className="flex items-center justify-center py-20">
          <p className="text-secondary">No cards to review</p>
        </div>
      </div>
    )
  }

  // Active review interface
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
              <button
                onClick={() => setShowResetModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-secondary hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
                title="Reset all progress for this lecture"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="text-sm">Reset Progress</span>
              </button>
              <div
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: `${module.color}15`, color: module.color }}
              >
                {module.abbreviation}
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-secondary" />
                <span className="text-sm font-medium text-primary">Review Session</span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-secondary">
                Card {reviewedCardIds.size + 1} of {reviewQueue.length}
              </span>
              <span className="text-xs text-secondary">
                {remainingCards} remaining
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

      {/* Flashcard */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Card State Badge */}
          <div className="flex items-center justify-center gap-2">
            <span className="inline-block px-3 py-1 bg-gray-100 rounded-full text-xs text-secondary">
              {currentCard.state === 'new' && '✨ New Card'}
              {currentCard.state === 'learning' && '📚 Learning'}
              {currentCard.state === 'review' && '🔄 Review'}
              {currentCard.state === 'relearning' && '🔁 Relearning'}
            </span>
            {currentCard.lapse_count > 0 && (
              <span className="inline-block px-3 py-1 bg-orange-100 rounded-full text-xs text-orange-700">
                Lapses: {currentCard.lapse_count}
              </span>
            )}
          </div>

          {/* Card */}
          <div
            onClick={handleFlip}
            className="bg-surface rounded-2xl p-12 shadow-sm border border-divider cursor-pointer hover:shadow-md transition-shadow min-h-[400px] flex items-center justify-center"
          >
            <div className="text-center w-full">
              {!isFlipped ? (
                <>
                  <p className="text-sm text-secondary mb-4 uppercase tracking-wide">Question</p>
                  <div
                    className="text-2xl text-primary font-medium leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: currentCard.front }}
                  />
                  <p className="text-sm text-secondary mt-8">Click to reveal answer</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-secondary mb-4 uppercase tracking-wide">Answer</p>
                  <div
                    className="text-2xl text-primary font-medium leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: currentCard.back }}
                  />
                </>
              )}
            </div>
          </div>

          {/* Action Buttons - 4-button SRS system */}
          {isFlipped && (
            <div className="grid grid-cols-4 gap-3">
              <button
                onClick={() => handleRating(RATING.AGAIN)}
                disabled={saving}
                className="flex flex-col items-center justify-center gap-2 px-4 py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
              >
                <RotateCcw className="w-5 h-5" />
                <span className="text-sm">Again</span>
                <span className="text-xs opacity-75">{nextIntervals.again || '?'}</span>
              </button>

              <button
                onClick={() => handleRating(RATING.HARD)}
                disabled={saving}
                className="flex flex-col items-center justify-center gap-2 px-4 py-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
              >
                <MinusCircle className="w-5 h-5" />
                <span className="text-sm">Hard</span>
                <span className="text-xs opacity-75">{nextIntervals.hard || '?'}</span>
              </button>

              <button
                onClick={() => handleRating(RATING.GOOD)}
                disabled={saving}
                className="flex flex-col items-center justify-center gap-2 px-4 py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
              >
                <Check className="w-5 h-5" />
                <span className="text-sm">Good</span>
                <span className="text-xs opacity-75">{nextIntervals.good || '?'}</span>
              </button>

              <button
                onClick={() => handleRating(RATING.EASY)}
                disabled={saving}
                className="flex flex-col items-center justify-center gap-2 px-4 py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
              >
                <Zap className="w-5 h-5" />
                <span className="text-sm">Easy</span>
                <span className="text-xs opacity-75">{nextIntervals.easy || '?'}</span>
              </button>
            </div>
          )}

          {/* Keyboard shortcuts hint */}
          {isFlipped && (
            <div className="text-center">
              <p className="text-xs text-secondary">
                Tip: Use keyboard shortcuts 1, 2, 3, 4 for faster reviews
              </p>
            </div>
          )}

          {/* Tags */}
          {currentCard.tags && (
            <div className="text-center">
              <span className="inline-block px-3 py-1 bg-gray-100 rounded-full text-xs text-secondary">
                {currentCard.tags}
              </span>
            </div>
          )}
        </div>
      </main>

      {/* Reset Progress Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full shadow-xl border border-divider">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-xl">
                <AlertCircle className="w-6 h-6 text-orange-600" />
              </div>
              <h2 className="text-xl font-bold text-primary">Reset Progress?</h2>
            </div>

            <p className="text-secondary mb-6">
              This will reset all {reviewQueue.length} flashcards in this lecture back to "new" state.
              All progress, intervals, and ease factors will be lost. This cannot be undone.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                disabled={resetting}
                className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetProgress}
                disabled={resetting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2"
              >
                {resetting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  'Reset All'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

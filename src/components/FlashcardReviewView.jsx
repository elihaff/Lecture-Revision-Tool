import { useState } from 'react'
import { ArrowLeft, Check, X, RotateCcw, BookOpen } from 'lucide-react'

export function FlashcardReviewView({ lecture, module, onBack }) {
  const flashcards = lecture.notes?._flashcards || []
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [reviewedCards, setReviewedCards] = useState([]) // { index, mastered: boolean }
  const [sessionComplete, setSessionComplete] = useState(false)
  const [reviewingDifficult, setReviewingDifficult] = useState(false)

  const currentCard = flashcards[currentIndex]
  const progress = ((reviewedCards.length) / flashcards.length) * 100
  const remainingCards = flashcards.length - reviewedCards.length

  const handleFlip = () => {
    setIsFlipped(!isFlipped)
  }

  const handleResponse = (mastered) => {
    // Record this card's result
    const newReviewed = [...reviewedCards, { index: currentIndex, mastered }]
    setReviewedCards(newReviewed)

    // Move to next card or end session
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setIsFlipped(false)
    } else {
      setSessionComplete(true)
    }
  }

  const handleReviewDifficult = () => {
    // Get all cards marked as "need review"
    const difficultIndices = reviewedCards
      .filter(r => !r.mastered)
      .map(r => r.index)

    if (difficultIndices.length === 0) {
      onBack()
      return
    }

    // Reset to review only difficult cards
    setReviewingDifficult(true)
    setCurrentIndex(difficultIndices[0])
    setReviewedCards([])
    setSessionComplete(false)
    setIsFlipped(false)
  }

  const handleFinish = () => {
    onBack()
  }

  if (flashcards.length === 0) {
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
          <p className="text-secondary">No flashcards available for review.</p>
        </div>
      </div>
    )
  }

  // Session complete summary
  if (sessionComplete) {
    const masteredCount = reviewedCards.filter(r => r.mastered).length
    const needReviewCount = reviewedCards.filter(r => !r.mastered).length

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
            <p className="text-secondary mb-8">You reviewed {flashcards.length} flashcard{flashcards.length !== 1 ? 's' : ''}</p>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-green-50 rounded-xl p-6 border border-green-200">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Check className="w-5 h-5 text-green-600" />
                  <span className="text-3xl font-bold text-green-600">{masteredCount}</span>
                </div>
                <p className="text-sm text-green-700">Got it</p>
              </div>

              <div className="bg-orange-50 rounded-xl p-6 border border-orange-200">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <RotateCcw className="w-5 h-5 text-orange-600" />
                  <span className="text-3xl font-bold text-orange-600">{needReviewCount}</span>
                </div>
                <p className="text-sm text-orange-700">Need review</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              {needReviewCount > 0 && (
                <button
                  onClick={handleReviewDifficult}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 rounded-xl font-medium text-white transition-colors"
                >
                  <RotateCcw className="w-5 h-5" />
                  Review {needReviewCount} Difficult Card{needReviewCount !== 1 ? 's' : ''} Again
                </button>
              )}

              <button
                onClick={handleFinish}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent hover:bg-blue-600 rounded-xl font-medium text-white transition-colors"
              >
                Finish Session
              </button>
            </div>
          </div>
        </main>
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
              <div
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: `${module.color}15`, color: module.color }}
              >
                {module.abbreviation}
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-secondary" />
                <span className="text-sm font-medium text-primary">
                  {reviewingDifficult ? 'Reviewing Difficult Cards' : 'Flashcard Review'}
                </span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-secondary">
                Card {reviewedCards.length + 1} of {flashcards.length}
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
          {/* Card */}
          <div
            onClick={handleFlip}
            className="bg-surface rounded-2xl p-12 shadow-sm border border-divider cursor-pointer hover:shadow-md transition-shadow min-h-[400px] flex items-center justify-center"
          >
            <div className="text-center">
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

          {/* Action Buttons - only show when flipped */}
          {isFlipped && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleResponse(false)}
                className="flex items-center justify-center gap-2 px-6 py-4 bg-orange-600 hover:bg-orange-700 rounded-xl font-medium text-white transition-colors"
              >
                <RotateCcw className="w-5 h-5" />
                Need Review
              </button>

              <button
                onClick={() => handleResponse(true)}
                className="flex items-center justify-center gap-2 px-6 py-4 bg-green-600 hover:bg-green-700 rounded-xl font-medium text-white transition-colors"
              >
                <Check className="w-5 h-5" />
                Got It
              </button>
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
    </div>
  )
}

/**
 * Integration-style tests for review behavior using an in-memory store.
 * Scope covered:
 * - queue filtering rules used by global review (due today, state, suspended/buried)
 * - persistence updates (card progression + review log write)
 * - end-to-end session loop over all due-today cards
 *
 * Run:
 *   node src/lib/testReviewSystemIntegration.js
 */

import { fileURLToPath } from 'node:url'
import { calculateNextReview, RATING, STATE } from './srsAlgorithmV2.js'

function pass(msg) { console.log(`PASS: ${msg}`) }
function fail(msg) { console.error(`FAIL: ${msg}`); return false }

function isoOffsetMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

function getDueReviewCardsInMemory(cards, { userId, includeNew = false, dueBefore = null, limit = 100 }) {
  const cutoff = new Date(dueBefore || new Date().toISOString()).getTime()

  let filtered = cards.filter((c) => {
    if (c.user_id !== userId) return false
    if (c.suspended) return false
    if (c.buried === true) return false

    const due = new Date(c.due_date).getTime()
    if (Number.isNaN(due) || due > cutoff) return false

    if (!includeNew) {
      return [STATE.LEARNING, STATE.RELEARNING, STATE.REVIEW].includes(c.state)
    }

    return true
  })

  filtered.sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
  filtered = filtered.slice(0, limit)

  const newCount = includeNew
    ? 0
    : cards.filter((c) => c.user_id === userId && c.state === STATE.NEW && !c.suspended).length

  return {
    data: filtered,
    count: { due: filtered.length, new: newCount },
    error: null,
  }
}

function recordReviewInMemory({ cards, reviewLogs, userId, flashcardId, rating, reviewTimeMs = null, examDate = null }) {
  const card = cards.find((c) => c.id === flashcardId && c.user_id === userId)
  if (!card) {
    return { data: null, error: new Error('Card not found') }
  }

  const { updatedCard, reviewLog } = calculateNextReview(card, rating, { reviewTimeMs, examDate })
  Object.assign(card, updatedCard)

  reviewLogs.push({
    user_id: userId,
    flashcard_id: flashcardId,
    ...reviewLog,
  })

  return { data: card, error: null }
}

function testRecordReviewPersists() {
  console.log('\n=== TEST 1: recordReview persistence semantics ===')

  const cards = [{
    id: 'c1',
    user_id: 'user-1',
    lecture_id: 'l1',
    state: STATE.REVIEW,
    ease_factor: 2.5,
    interval_days: 5,
    repetitions: 3,
    lapse_count: 0,
    review_count: 10,
    learning_step: 0,
    due_date: isoOffsetMinutes(-60),
    suspended: false,
    buried: false,
    last_reviewed_at: null,
  }]
  const logs = []

  const result = recordReviewInMemory({ cards, reviewLogs: logs, userId: 'user-1', flashcardId: 'c1', rating: RATING.GOOD, reviewTimeMs: 900 })
  if (result.error) return fail(`recordReview error: ${result.error.message}`)

  const card = cards[0]
  if (card.review_count !== 11) return fail(`Expected review_count=11, got ${card.review_count}`)
  if (card.repetitions !== 4) return fail(`Expected repetitions=4, got ${card.repetitions}`)
  if (card.state !== STATE.REVIEW) return fail(`Expected state=review, got ${card.state}`)
  if (logs.length !== 1) return fail(`Expected 1 review log, got ${logs.length}`)

  pass('Card progression persisted and review log recorded')
  return true
}

function testDueTodayFiltering() {
  console.log('\n=== TEST 2: due-today global filtering ===')

  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999)
  const cards = [
    { id: 'due-review', user_id: 'user-1', lecture_id: 'l1', state: STATE.REVIEW, due_date: isoOffsetMinutes(-30), suspended: false, buried: false },
    { id: 'due-learning', user_id: 'user-1', lecture_id: 'l1', state: STATE.LEARNING, due_date: isoOffsetMinutes(-5), suspended: false, buried: false },
    { id: 'new-card', user_id: 'user-1', lecture_id: 'l1', state: STATE.NEW, due_date: isoOffsetMinutes(-5), suspended: false, buried: false },
    { id: 'tomorrow', user_id: 'user-1', lecture_id: 'l1', state: STATE.REVIEW, due_date: isoOffsetMinutes(24 * 60), suspended: false, buried: false },
    { id: 'suspended', user_id: 'user-1', lecture_id: 'l1', state: STATE.REVIEW, due_date: isoOffsetMinutes(-5), suspended: true, buried: false },
    { id: 'buried', user_id: 'user-1', lecture_id: 'l1', state: STATE.REVIEW, due_date: isoOffsetMinutes(-5), suspended: false, buried: true },
    { id: 'other-user', user_id: 'user-2', lecture_id: 'l1', state: STATE.REVIEW, due_date: isoOffsetMinutes(-5), suspended: false, buried: false },
  ]

  const { data } = getDueReviewCardsInMemory(cards, {
    userId: 'user-1',
    includeNew: false,
    dueBefore: endOfToday.toISOString(),
    limit: 5000,
  })

  const ids = new Set(data.map((c) => c.id))
  const expected = ['due-review', 'due-learning']
  const forbidden = ['new-card', 'tomorrow', 'suspended', 'buried', 'other-user']

  for (const id of expected) if (!ids.has(id)) return fail(`Expected id missing: ${id}`)
  for (const id of forbidden) if (ids.has(id)) return fail(`Unexpected id present: ${id}`)

  pass('Queue filtering matches due-today global review rules')
  return true
}

function testGlobalSessionLoop() {
  console.log('\n=== TEST 3: global session loop over all due cards ===')

  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999)
  const cards = [
    { id: 'g1', user_id: 'user-1', lecture_id: 'l1', state: STATE.REVIEW, ease_factor: 2.3, interval_days: 4, repetitions: 3, lapse_count: 0, review_count: 0, learning_step: 0, due_date: isoOffsetMinutes(-60), suspended: false, buried: false },
    { id: 'g2', user_id: 'user-1', lecture_id: 'l2', state: STATE.REVIEW, ease_factor: 2.5, interval_days: 7, repetitions: 5, lapse_count: 0, review_count: 0, learning_step: 0, due_date: isoOffsetMinutes(-10), suspended: false, buried: false },
    { id: 'future', user_id: 'user-1', lecture_id: 'l2', state: STATE.REVIEW, ease_factor: 2.5, interval_days: 7, repetitions: 5, lapse_count: 0, review_count: 0, learning_step: 0, due_date: isoOffsetMinutes(24 * 60), suspended: false, buried: false },
  ]
  const logs = []

  const queue = getDueReviewCardsInMemory(cards, {
    userId: 'user-1',
    includeNew: false,
    dueBefore: endOfToday.toISOString(),
    limit: 5000,
  })

  if (queue.data.length !== 2) return fail(`Expected 2 due cards, got ${queue.data.length}`)

  for (const card of queue.data) {
    const result = recordReviewInMemory({
      cards,
      reviewLogs: logs,
      userId: 'user-1',
      flashcardId: card.id,
      rating: RATING.GOOD,
      reviewTimeMs: 500,
    })
    if (result.error) return fail(`Review failed for ${card.id}: ${result.error.message}`)
  }

  if (logs.length !== 2) return fail(`Expected 2 logs, got ${logs.length}`)

  const reviewed = cards.filter((c) => ['g1', 'g2'].includes(c.id))
  if (!reviewed.every((c) => c.review_count === 1)) return fail('Not all due cards were progressed once')
  if (cards.find((c) => c.id === 'future').review_count !== 0) return fail('Future card should remain untouched')

  pass('Session consumes all due-today cards and excludes future cards')
  return true
}

export function runReviewIntegrationTests() {
  console.log('=============================================')
  console.log('REVIEW SYSTEM INTEGRATION TEST SUITE')
  console.log('=============================================')

  const results = [
    testRecordReviewPersists(),
    testDueTodayFiltering(),
    testGlobalSessionLoop(),
  ]

  const passed = results.filter(Boolean).length
  const total = results.length
  console.log('\n---------------------------------------------')
  console.log(`Summary: ${passed}/${total} tests passed`)
  console.log('---------------------------------------------')

  if (passed !== total) {
    process.exitCode = 1
    return false
  }
  return true
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectRun) {
  const ok = runReviewIntegrationTests()
  if (!ok) process.exit(1)
}

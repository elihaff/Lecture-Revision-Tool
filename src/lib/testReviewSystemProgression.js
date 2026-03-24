/**
 * REVIEW-stage progression test suite
 * Focus: cards that are already learned (state=review) and their transitions.
 *
 * Run:
 *   node src/lib/testReviewSystemProgression.js
 */

import { calculateNextReview, RATING, STATE, CONFIG, formatInterval } from './srsAlgorithmV2.js'
import { fileURLToPath } from 'node:url'

function assertCheck(name, condition, details = '') {
  if (condition) {
    console.log(`PASS: ${name}`)
    return true
  }

  console.error(`FAIL: ${name}${details ? ` :: ${details}` : ''}`)
  return false
}

function withinFuzz(actual, expected, baseInterval) {
  const tolerance = Math.max(0.001, baseInterval * CONFIG.FUZZ_FACTOR + 0.001)
  return Math.abs(actual - expected) <= tolerance
}

function makeReviewCard(overrides = {}) {
  return {
    state: STATE.REVIEW,
    ease_factor: 2.5,
    interval_days: 10,
    repetitions: 3,
    lapse_count: 0,
    review_count: 7,
    learning_step: 0,
    ...overrides,
  }
}

function testReviewAgainToRelearning() {
  console.log('\n=== TEST 1: REVIEW + AGAIN -> RELEARNING ===')

  const input = makeReviewCard({ interval_days: 21, repetitions: 6, lapse_count: 2 })
  const { updatedCard } = calculateNextReview(input, RATING.AGAIN)

  let ok = true
  ok = assertCheck('State switches to RELEARNING', updatedCard.state === STATE.RELEARNING, `got ${updatedCard.state}`) && ok
  ok = assertCheck('Repetitions reset to 0', updatedCard.repetitions === 0, `got ${updatedCard.repetitions}`) && ok
  ok = assertCheck('Lapse count increments', updatedCard.lapse_count === 3, `got ${updatedCard.lapse_count}`) && ok
  ok = assertCheck('Interval becomes short (sub-day)', updatedCard.interval_days < 1, `got ${updatedCard.interval_days}`) && ok

  return ok
}

function testReviewGoodProgression() {
  console.log('\n=== TEST 2: REVIEW + GOOD progression ===')

  const input = makeReviewCard({ interval_days: 12, ease_factor: 2.4, repetitions: 5 })
  const expected = input.interval_days * input.ease_factor
  const { updatedCard } = calculateNextReview(input, RATING.GOOD)

  let ok = true
  ok = assertCheck('State remains REVIEW', updatedCard.state === STATE.REVIEW, `got ${updatedCard.state}`) && ok
  ok = assertCheck('Interval increases', updatedCard.interval_days > input.interval_days, `old=${input.interval_days}, new=${updatedCard.interval_days}`) && ok
  ok = assertCheck('Interval roughly matches SM-2 growth', withinFuzz(updatedCard.interval_days, expected, input.interval_days), `expected~${expected}, got ${updatedCard.interval_days}`) && ok
  ok = assertCheck('Ease unchanged on GOOD', updatedCard.ease_factor === input.ease_factor, `old=${input.ease_factor}, new=${updatedCard.ease_factor}`) && ok
  ok = assertCheck('Repetitions incremented', updatedCard.repetitions === input.repetitions + 1, `old=${input.repetitions}, new=${updatedCard.repetitions}`) && ok

  return ok
}

function testReviewHardBehavior() {
  console.log('\n=== TEST 3: REVIEW + HARD behavior ===')

  const input = makeReviewCard({ interval_days: 10, ease_factor: 2.5, repetitions: 4 })
  const expected = input.interval_days * CONFIG.HARD_INTERVAL_MULTIPLIER
  const { updatedCard } = calculateNextReview(input, RATING.HARD)

  let ok = true
  ok = assertCheck('State remains REVIEW', updatedCard.state === STATE.REVIEW, `got ${updatedCard.state}`) && ok
  ok = assertCheck('Interval grows by HARD multiplier (with fuzz)', withinFuzz(updatedCard.interval_days, expected, input.interval_days), `expected~${expected}, got ${updatedCard.interval_days}`) && ok
  ok = assertCheck('Ease decreases on HARD', updatedCard.ease_factor < input.ease_factor, `old=${input.ease_factor}, new=${updatedCard.ease_factor}`) && ok
  ok = assertCheck('Repetitions incremented', updatedCard.repetitions === input.repetitions + 1, `old=${input.repetitions}, new=${updatedCard.repetitions}`) && ok

  return ok
}

function testReviewEasyBehavior() {
  console.log('\n=== TEST 4: REVIEW + EASY behavior ===')

  const input = makeReviewCard({ interval_days: 9, ease_factor: 2.2, repetitions: 4 })
  const goodExpected = input.interval_days * input.ease_factor
  const easyExpected = goodExpected * CONFIG.EASY_BONUS_MULTIPLIER
  const { updatedCard } = calculateNextReview(input, RATING.EASY)

  let ok = true
  ok = assertCheck('State remains REVIEW', updatedCard.state === STATE.REVIEW, `got ${updatedCard.state}`) && ok
  ok = assertCheck('Interval beats GOOD baseline', updatedCard.interval_days > goodExpected, `good~${goodExpected}, easy=${updatedCard.interval_days}`) && ok
  ok = assertCheck('Interval roughly includes EASY bonus (with fuzz)', withinFuzz(updatedCard.interval_days, easyExpected, input.interval_days), `expected~${easyExpected}, got ${updatedCard.interval_days}`) && ok
  ok = assertCheck('Ease increases on EASY', updatedCard.ease_factor > input.ease_factor, `old=${input.ease_factor}, new=${updatedCard.ease_factor}`) && ok
  ok = assertCheck('Repetitions incremented', updatedCard.repetitions === input.repetitions + 1, `old=${input.repetitions}, new=${updatedCard.repetitions}`) && ok

  return ok
}

function testRelearningGraduatesBackToReview() {
  console.log('\n=== TEST 5: RELEARNING graduation ===')

  const relearning = {
    state: STATE.RELEARNING,
    ease_factor: 2.1,
    interval_days: 10 / (24 * 60),
    repetitions: 0,
    lapse_count: 4,
    review_count: 12,
    learning_step: 0,
  }

  const good = calculateNextReview(relearning, RATING.GOOD).updatedCard
  const easy = calculateNextReview(relearning, RATING.EASY).updatedCard

  let ok = true
  ok = assertCheck('RELEARNING + GOOD -> REVIEW', good.state === STATE.REVIEW, `got ${good.state}`) && ok
  ok = assertCheck('GOOD relearning graduates to 1d interval', good.interval_days >= 1, `got ${formatInterval(good.interval_days)}`) && ok
  ok = assertCheck('RELEARNING + EASY -> REVIEW', easy.state === STATE.REVIEW, `got ${easy.state}`) && ok
  ok = assertCheck('EASY relearning gives longer interval than GOOD', easy.interval_days > good.interval_days, `good=${good.interval_days}, easy=${easy.interval_days}`) && ok

  return ok
}

function testExamModeCapOnLearnedCards() {
  console.log('\n=== TEST 6: Exam mode caps REVIEW interval ===')

  // Use a near exam date to force a tight cap.
  const examDate = new Date()
  examDate.setDate(examDate.getDate() + 10)
  const examIso = examDate.toISOString().split('T')[0]

  const input = makeReviewCard({ interval_days: 20, ease_factor: 2.7, repetitions: 8 })
  const { updatedCard } = calculateNextReview(input, RATING.GOOD, { examDate: examIso })

  const expectedCap = Math.min(CONFIG.MAXIMUM_INTERVAL, 10 * CONFIG.EXAM_INTERVAL_CAP_MULTIPLIER)

  let ok = true
  ok = assertCheck('State remains REVIEW', updatedCard.state === STATE.REVIEW, `got ${updatedCard.state}`) && ok
  ok = assertCheck('Interval obeys exam cap', updatedCard.interval_days <= expectedCap, `cap=${expectedCap}, got=${updatedCard.interval_days}`) && ok

  return ok
}

export function runReviewProgressionTests() {
  console.log('=============================================')
  console.log('REVIEW SYSTEM PROGRESSION TEST SUITE')
  console.log('=============================================')

  const results = [
    testReviewAgainToRelearning(),
    testReviewGoodProgression(),
    testReviewHardBehavior(),
    testReviewEasyBehavior(),
    testRelearningGraduatesBackToReview(),
    testExamModeCapOnLearnedCards(),
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
  const ok = runReviewProgressionTests()
  if (!ok) process.exit(1)
}

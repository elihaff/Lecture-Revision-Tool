/**
 * Test script for REVIEW-stage scheduling
 * Run this in the browser console or import it to verify the SRS system works
 *
 * Usage (in browser console on your app):
 *   const test = await import('/src/lib/testSrsScheduling.js')
 *   await test.runAllTests()
 */

import { calculateNextReview, RATING, STATE, CONFIG, formatInterval } from './srsAlgorithmV2.js'
import { getDueReviewCards } from './flashcardService.js'

// ============================================================
// TEST 1: Algorithm calculates correct intervals for REVIEW cards
// ============================================================
export function testReviewCardScheduling() {
  console.log('\n=== TEST 1: REVIEW Card Scheduling ===\n')

  // Simulate a card that has graduated to REVIEW state
  const reviewCard = {
    state: STATE.REVIEW,
    ease_factor: 2.5,
    interval_days: 10,  // Was scheduled 10 days ago
    repetitions: 3,
    lapse_count: 0,
    review_count: 5,
    learning_step: 0,
  }

  console.log('Input card:', reviewCard)
  console.log('')

  const ratings = [
    { rating: RATING.AGAIN, name: 'Again' },
    { rating: RATING.HARD, name: 'Hard' },
    { rating: RATING.GOOD, name: 'Good' },
    { rating: RATING.EASY, name: 'Easy' },
  ]

  let allPassed = true

  for (const { rating, name } of ratings) {
    const { updatedCard } = calculateNextReview(reviewCard, rating)

    const checks = {
      hasDueDate: !!updatedCard.due_date,
      hasInterval: updatedCard.interval_days > 0 || rating === RATING.AGAIN,
      hasEase: updatedCard.ease_factor >= CONFIG.MINIMUM_EASE,
      correctState: rating === RATING.AGAIN
        ? updatedCard.state === STATE.RELEARNING
        : updatedCard.state === STATE.REVIEW,
    }

    const passed = Object.values(checks).every(v => v)
    allPassed = allPassed && passed

    console.log(`${passed ? '✅' : '❌'} ${name}:`)
    console.log(`   State: ${updatedCard.state}`)
    console.log(`   Interval: ${formatInterval(updatedCard.interval_days)} (${updatedCard.interval_days.toFixed(2)} days)`)
    console.log(`   Ease: ${updatedCard.ease_factor.toFixed(2)}`)
    console.log(`   Due: ${new Date(updatedCard.due_date).toLocaleString()}`)
    console.log('')
  }

  return allPassed
}

// ============================================================
// TEST 2: Again rating triggers RELEARNING correctly
// ============================================================
export function testAgainTriggersRelearning() {
  console.log('\n=== TEST 2: Again → RELEARNING Flow ===\n')

  const reviewCard = {
    state: STATE.REVIEW,
    ease_factor: 2.5,
    interval_days: 30,
    repetitions: 5,
    lapse_count: 0,
    learning_step: 0,
  }

  const { updatedCard } = calculateNextReview(reviewCard, RATING.AGAIN)

  const checks = {
    stateIsRelearning: updatedCard.state === STATE.RELEARNING,
    lapseIncremented: updatedCard.lapse_count === 1,
    repetitionsReset: updatedCard.repetitions === 0,
    easeReduced: updatedCard.ease_factor < 2.5,
    shortInterval: updatedCard.interval_days < 1, // Should be minutes, not days
  }

  console.log('Card after Again:')
  console.log(`  State: ${updatedCard.state} ${checks.stateIsRelearning ? '✅' : '❌'}`)
  console.log(`  Lapse count: ${updatedCard.lapse_count} ${checks.lapseIncremented ? '✅' : '❌'}`)
  console.log(`  Repetitions: ${updatedCard.repetitions} ${checks.repetitionsReset ? '✅' : '❌'}`)
  console.log(`  Ease: ${updatedCard.ease_factor.toFixed(2)} ${checks.easeReduced ? '✅' : '❌'}`)
  console.log(`  Interval: ${formatInterval(updatedCard.interval_days)} ${checks.shortInterval ? '✅' : '❌'}`)

  const passed = Object.values(checks).every(v => v)
  console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}`)

  return passed
}

// ============================================================
// TEST 3: Good rating extends interval correctly (SM-2)
// ============================================================
export function testGoodExtendsInterval() {
  console.log('\n=== TEST 3: Good Rating Interval Growth ===\n')

  const reviewCard = {
    state: STATE.REVIEW,
    ease_factor: 2.5,
    interval_days: 10,
    repetitions: 3,
    lapse_count: 0,
    learning_step: 0,
  }

  const { updatedCard } = calculateNextReview(reviewCard, RATING.GOOD)

  // Expected: interval_days * ease_factor = 10 * 2.5 = 25 days (with fuzz)
  const expectedInterval = reviewCard.interval_days * reviewCard.ease_factor
  const tolerance = expectedInterval * CONFIG.FUZZ_FACTOR * 2 // Account for fuzz

  const checks = {
    stateStaysReview: updatedCard.state === STATE.REVIEW,
    intervalGrows: updatedCard.interval_days > reviewCard.interval_days,
    intervalCorrect: Math.abs(updatedCard.interval_days - expectedInterval) < tolerance,
    easeUnchanged: updatedCard.ease_factor === reviewCard.ease_factor,
    repetitionsIncremented: updatedCard.repetitions === reviewCard.repetitions + 1,
  }

  console.log(`Previous interval: ${reviewCard.interval_days} days`)
  console.log(`Expected new interval: ~${expectedInterval} days`)
  console.log(`Actual new interval: ${updatedCard.interval_days.toFixed(1)} days`)
  console.log('')
  console.log(`State stays REVIEW: ${checks.stateStaysReview ? '✅' : '❌'}`)
  console.log(`Interval grows: ${checks.intervalGrows ? '✅' : '❌'}`)
  console.log(`Interval ~= prev × ease: ${checks.intervalCorrect ? '✅' : '❌'}`)
  console.log(`Ease unchanged: ${checks.easeUnchanged ? '✅' : '❌'}`)
  console.log(`Repetitions +1: ${checks.repetitionsIncremented ? '✅' : '❌'}`)

  const passed = Object.values(checks).every(v => v)
  console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}`)

  return passed
}

// ============================================================
// TEST 4: getDueReviewCards service function
// ============================================================
export async function testGetDueReviewCards() {
  console.log('\n=== TEST 4: getDueReviewCards() Service ===\n')

  try {
    const result = await getDueReviewCards()

    console.log('Result:', result)
    console.log('')
    console.log(`Error: ${result.error ? '❌ ' + result.error.message : '✅ None'}`)
    console.log(`Due cards returned: ${result.data?.length ?? 0}`)
    console.log(`Due count: ${result.count?.due ?? 0}`)
    console.log(`New count: ${result.count?.new ?? 0}`)

    if (result.data?.length > 0) {
      console.log('\nSample card:')
      const card = result.data[0]
      console.log(`  ID: ${card.id}`)
      console.log(`  State: ${card.state}`)
      console.log(`  Due: ${card.due_date}`)
      console.log(`  Interval: ${card.interval_days} days`)
    }

    const passed = !result.error
    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}`)
    return passed
  } catch (err) {
    console.error('❌ Error:', err)
    return false
  }
}

// ============================================================
// RUN ALL TESTS
// ============================================================
export async function runAllTests() {
  console.log('╔════════════════════════════════════════╗')
  console.log('║  SRS REVIEW SCHEDULING TEST SUITE      ║')
  console.log('╚════════════════════════════════════════╝')

  const results = {
    'REVIEW Card Scheduling': testReviewCardScheduling(),
    'Again → RELEARNING': testAgainTriggersRelearning(),
    'Good Interval Growth': testGoodExtendsInterval(),
    'getDueReviewCards()': await testGetDueReviewCards(),
  }

  console.log('\n════════════════════════════════════════')
  console.log('SUMMARY')
  console.log('════════════════════════════════════════\n')

  let allPassed = true
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}`)
    allPassed = allPassed && passed
  }

  console.log('')
  console.log(allPassed
    ? '🎉 All tests passed! REVIEW scheduling is working correctly.'
    : '⚠️ Some tests failed. Check the output above.')

  return allPassed
}

// Export for easy console access
export default { runAllTests, testReviewCardScheduling, testAgainTriggersRelearning, testGoodExtendsInterval, testGetDueReviewCards }

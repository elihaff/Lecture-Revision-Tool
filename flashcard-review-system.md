# Flashcard Review System

## New Cards

### Overview
The flashcard review system implements an Anki-style spaced repetition algorithm with two-cycle learning steps. New cards must pass through both learning cycles before graduating to long-term review scheduling.

---

## Two-Cycle Learning System

### Learning Steps Configuration
```javascript
LEARNING_STEPS: [0.3, 10] // minutes
```

- **Step 0 (First Cycle):** 0.3 minutes (~18 seconds)
- **Step 1 (Second Cycle):** 10 minutes

### Card Lifecycle
```
NEW → LEARNING (step 0) → LEARNING (step 1) → REVIEW
```

1. **NEW:** Card has never been reviewed
2. **LEARNING (step 0):** First cycle - card appears within same session
3. **LEARNING (step 1):** Second cycle - card reappears after 10 minutes
4. **REVIEW:** Graduated - scheduled for next day+ with SM-2 intervals

---

## Rating System (4 Buttons)

### Button Definitions

#### 1. Again (Rating: 1)
- **First Cycle:** Reset to step 0, due in <1 minute
- **Second Cycle:** Reset to step 0, due in <1 minute
- **Effect:** Card forgotten - restart learning process
- **Ease penalty:** -0.2 (makes card appear more frequently in future)

#### 2. Hard (Rating: 2)
- **First Cycle:** Repeat step 0, due in **6 minutes** (special interval)
- **Second Cycle:** Repeat step 1, due in 10 minutes
- **Effect:** Stay at current step - don't advance yet
- **Ease penalty:** -0.15

#### 3. Good (Rating: 3)
- **First Cycle:** Advance to step 1, due in 10 minutes
- **Second Cycle:** Graduate to REVIEW, due in **1 day**
- **Effect:** Normal progression - advance to next step
- **Ease change:** None (maintains current ease factor)

#### 4. Easy (Rating: 4)
- **First Cycle:** Skip to REVIEW, due in **1 day**
- **Second Cycle:** Graduate to REVIEW, due in **4 days** (bonus interval)
- **Effect:** Skip all remaining steps - exceptional recall
- **Ease bonus:** +0.15 (makes card appear less frequently in future)

### Interval Summary Table

| Button | First Cycle (Step 0) | Second Cycle (Step 1) |
|--------|---------------------|----------------------|
| Again  | <1 min (reset to step 0) | <1 min (reset to step 0) |
| Hard   | 6 min (repeat step 0) | 10 min (repeat step 1) |
| Good   | 10 min (→ step 1) | 1 day (→ REVIEW) |
| Easy   | 1 day (→ REVIEW) | 4 days (→ REVIEW) |

---

## Session Management

### 20 Card Batch System

**Purpose:** Prevent overwhelming users with too many new cards per session.

**Implementation:**
```javascript
const [activeSessionCardIds, setActiveSessionCardIds] = useState(null)
```

**Flow:**
1. **Session Start:** Select first 20 NEW cards from lecture
2. **Store IDs:** Track these 20 card IDs in component state
3. **Session Scope:** Only show cards from this batch until all graduate
4. **Session Complete:** When all 20 cards reach REVIEW state, clear IDs and allow new batch

**Key Rule:** No mid-session replacement. If a card graduates from first cycle, it stays in the session for second cycle - it does NOT get replaced by a 21st card.

### Session Completion Criteria
```javascript
const sessionCards = allCards.filter(card =>
  activeSessionCardIds.includes(card.id) && card.state !== 'review'
)

if (sessionCards.length === 0) {
  setActiveSessionCardIds(null)
  setSessionComplete(true)
}
```

Session is complete when all 20 cards have state === 'review'.

---

## Queue Sorting Logic

### The Problem: Inconsistent `due_date` Semantics

**NEW cards:**
- `due_date` = creation timestamp (e.g., 2 weeks ago)
- `last_reviewed_at` = null

**LEARNING cards:**
- `due_date` = calculated next review time (e.g., now + 18 seconds)
- `last_reviewed_at` = timestamp of last review

This creates a semantic mismatch where NEW cards appear weeks overdue compared to LEARNING cards.

### The Solution: Effective Due Date

**Concept:** Normalize NEW and LEARNING cards to make them comparable.

```javascript
const sortCards = (cards) => {
  const now = new Date()

  return cards.sort((a, b) => {
    // Step 1: Sort by learning_step (step 0 before step 1)
    const stepA = a.learning_step || 0
    const stepB = b.learning_step || 0

    if (stepA !== stepB) {
      return stepA - stepB
    }

    // Step 2: Calculate effective due date
    // NEW cards (never reviewed) → treat as due NOW (not overdue)
    // LEARNING cards (reviewed) → use actual due_date
    const effectiveDueA = a.last_reviewed_at ? new Date(a.due_date) : now
    const effectiveDueB = b.last_reviewed_at ? new Date(b.due_date) : now

    // Step 3: Sort by effective due date (most overdue first)
    return effectiveDueA - effectiveDueB
  })
}
```

### Why This Works

**Scenario:** User presses "Again" on a card

After 30-second minimum delay:
- **NEW card:** effective due = now (0 seconds overdue)
- **"Again" card:** actual due = now - 12 seconds (12 seconds overdue)

**Result:** "Again" card is more overdue → appears **before** NEW cards

This creates proper interleaving: failed cards appear within next 1-3 cards, not at position 20.

### Sorting Priority (in order)
1. **Learning step** (step 0 before step 1)
2. **Effective due date** (most overdue first)

---

## Minimum Delay Enforcement

### Purpose
Prevent cards from appearing immediately after being reviewed. This gives the user's brain time to consolidate memory before testing again.

### Implementation
```javascript
const now = new Date()
const eligibleCards = sessionCards.filter(card => {
  if (!card.last_reviewed_at) return true // Never reviewed, show immediately
  const timeSinceReview = now - new Date(card.last_reviewed_at)
  return timeSinceReview > 30000 // 30 seconds minimum delay
})
```

**Threshold:** 30 seconds (30000 milliseconds)

### Exception: Last Cards in Session
If all remaining session cards are within the 30-second window (i.e., `eligibleCards.length === 0`), show them anyway:

```javascript
if (eligibleCards.length === 0) {
  // These are the only cards left - show them anyway
  const sortedWaitingCards = sortCards(sessionCards)
  setCurrentCard(sortedWaitingCards[0])
  return
}
```

**Rationale:** Don't show a waiting screen when these are the only cards left. Show the card with shortest interval remaining.

---

## Cycle Progress Display

### Cycle Count Calculation
```javascript
const firstCycle = sessionCards.filter(c =>
  (c.state === 'new' || c.state === 'learning') &&
  (c.learning_step === 0 || !c.learning_step)
).length

const secondCycle = sessionCards.filter(c =>
  c.state === 'learning' &&
  c.learning_step === 1
).length

const graduated = allCards.filter(c =>
  c.state === 'review'
).length
```

### UI Display
```
🟠 First Cycle: 12
🔵 Second Cycle: 5
🟢 Graduated: 3
```

**Colors:**
- Orange: First cycle (step 0)
- Blue: Second cycle (step 1)
- Green: Graduated (review state)

**Scope:**
- First/Second Cycle: Only counts cards in active session
- Graduated: Counts all graduated cards from lecture (not just session)

---

## Dynamic Card Loading

### Architectural Pattern
Instead of loading all cards upfront into a static queue, the system dynamically reloads after each review.

```javascript
const [currentCard, setCurrentCard] = useState(null) // Single card, not array
```

### Load Flow
```
Review card → recordReview() → loadNextCard() → fetch from DB → filter → sort → show next
```

**Benefits:**
1. Always reflects latest database state
2. Automatically handles card state changes (step 0 → step 1 → review)
3. No queue synchronization issues
4. Proper cycle separation (all step 0 before any step 1)

### loadNextCard() Logic
```javascript
const loadNextCard = async () => {
  // 1. Fetch all cards from lecture
  const { data: allCards } = await getFlashcardsByLecture(lecture.id)

  // 2. Check if session exists
  if (activeSessionCardIds === null) {
    // Start new session: select 20 NEW cards
    const newCards = allCards.filter(card => card.state === 'new')
    const batchCards = newCards.slice(0, 20)
    setActiveSessionCardIds(batchCards.map(c => c.id))
    // ... show first card
    return
  }

  // 3. Get cards from active session (not graduated)
  const sessionCards = allCards.filter(card =>
    activeSessionCardIds.includes(card.id) && card.state !== 'review'
  )

  // 4. Check session completion
  if (sessionCards.length === 0) {
    setActiveSessionCardIds(null)
    setSessionComplete(true)
    return
  }

  // 5. Apply minimum delay filter
  const eligibleCards = sessionCards.filter(card => {
    if (!card.last_reviewed_at) return true
    const timeSinceReview = now - new Date(card.last_reviewed_at)
    return timeSinceReview > 30000
  })

  // 6. Handle last cards exception
  if (eligibleCards.length === 0) {
    const sortedWaitingCards = sortCards(sessionCards)
    setCurrentCard(sortedWaitingCards[0])
    return
  }

  // 7. Sort and show next card
  const sortedCards = sortCards(eligibleCards)
  setCurrentCard(sortedCards[0])
}
```

---

## Database Schema Fields

### Flashcard Table (Relevant Fields)
```sql
-- SM-2 Algorithm Fields
ease_factor REAL DEFAULT 2.5 CHECK (ease_factor >= 1.3)
interval_days REAL DEFAULT 0 CHECK (interval_days >= 0)
repetitions INTEGER DEFAULT 0 CHECK (repetitions >= 0)
due_date TIMESTAMPTZ DEFAULT now() NOT NULL

-- State Tracking
state TEXT DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning'))
learning_step INTEGER DEFAULT 0 CHECK (learning_step >= 0)
last_reviewed_at TIMESTAMPTZ
review_count INTEGER DEFAULT 0 CHECK (review_count >= 0)
lapse_count INTEGER DEFAULT 0 CHECK (lapse_count >= 0)
```

### Field Usage by State

| Field | NEW State | LEARNING State | REVIEW State |
|-------|-----------|---------------|--------------|
| `due_date` | Creation timestamp | Calculated interval | Calculated interval |
| `last_reviewed_at` | null | Last review timestamp | Last review timestamp |
| `learning_step` | 0 | 0 or 1 | 0 (reset) |
| `state` | 'new' | 'learning' | 'review' |
| `interval_days` | 0 | < 1 (minutes/24/60) | ≥ 1 |
| `ease_factor` | 2.5 | 2.5 (± adjustments) | 2.5 (± adjustments) |

---

## Example Walkthrough: New Card Journey

### Initial State (Card Created)
```javascript
{
  state: 'new',
  learning_step: 0,
  due_date: '2024-01-15T10:00:00Z', // creation timestamp
  last_reviewed_at: null,
  ease_factor: 2.5,
  interval_days: 0,
  repetitions: 0
}
```

### First Review - User Presses "Good"
**Algorithm result:**
```javascript
{
  state: 'learning',
  learning_step: 1,
  due_date: '2024-01-15T10:10:00Z', // now + 10 minutes
  last_reviewed_at: '2024-01-15T10:00:00Z',
  ease_factor: 2.5,
  interval_days: 0.00694, // 10 minutes in days
  repetitions: 0
}
```

**Queue behavior:** Card moves from first cycle to second cycle

### Second Review (10 minutes later) - User Presses "Good"
**Algorithm result:**
```javascript
{
  state: 'review',
  learning_step: 0,
  due_date: '2024-01-16T10:10:00Z', // tomorrow
  last_reviewed_at: '2024-01-15T10:10:00Z',
  ease_factor: 2.5,
  interval_days: 1,
  repetitions: 1
}
```

**Queue behavior:** Card graduates - removed from session (session complete when all 20 reach this state)

### Alternative: First Review - User Presses "Again"
**Algorithm result:**
```javascript
{
  state: 'learning',
  learning_step: 0, // RESET to step 0
  due_date: '2024-01-15T10:00:18Z', // now + 18 seconds
  last_reviewed_at: '2024-01-15T10:00:00Z',
  ease_factor: 2.3, // -0.2 penalty
  interval_days: 0.000208, // 18 seconds in days
  repetitions: 0,
  lapse_count: 1
}
```

**Queue behavior:**
- Card stays in first cycle
- After 30-second minimum delay, appears near front of queue (not at position 20)
- Sorted by effective due date (treated as slightly overdue)

---

## Key Algorithmic Decisions

### 1. Why Two Cycles?
**Balance between:**
- **Too few cycles:** Cards graduate too quickly, poor retention
- **Too many cycles:** Session becomes tedious, user fatigue

**Anki default:** 2 steps before graduating (we match this)

### 2. Why Special 6-Minute Interval for Hard in First Cycle?
**Rationale:** Create meaningful spacing between button options
- Again: <1 minute (immediate retry)
- Hard: 6 minutes (challenging but not forgotten)
- Good: 10 minutes (ready for second cycle)

Without this, Hard and Good would both be 10 minutes (no distinction).

### 3. Why Different Easy Intervals?
**First Cycle Easy (1 day):**
- User demonstrates strong recall on first exposure
- But hasn't proven it twice yet
- Conservative graduation interval

**Second Cycle Easy (4 days):**
- User has now seen card twice and found it easy both times
- Exceptional recall deserves longer interval
- Bonus for strong performance

### 4. Why 30-Second Minimum Delay?
**Psychological spacing:**
- Immediate re-showing doesn't allow memory consolidation
- 30 seconds provides minimal "forgetting time"
- Balances learning efficiency with session pacing

**Research basis:** Even brief delays improve retention vs. immediate testing

### 5. Why Reset to Step 0 (Not Demote by 1)?
**Anki behavior:** Failed cards restart learning completely

**Rationale:**
- If user can't recall in second cycle, card isn't solidified
- Better to restart learning process than risk false graduation
- Conservative approach prioritizes retention over speed

---

## Common Edge Cases

### Case 1: All Cards Pressed "Again"
**Scenario:** User struggles with all 20 cards in first cycle

**Behavior:**
- All cards reset to step 0
- All have `due_date` = now + 18 seconds
- After 30-second delay, all become eligible
- Sorted by `last_reviewed_at` (oldest review first)
- User sees cards in order they were originally reviewed

**No infinite loop:** Eventually, some cards will be pressed "Good" or "Hard" (different intervals)

### Case 2: Mix of Steps in Queue
**Scenario:** 5 cards in first cycle, 3 in second cycle

**Behavior:**
- All 5 first-cycle cards shown before any second-cycle cards
- Within first cycle: sorted by effective due date
- Within second cycle: sorted by effective due date
- User completes all first cycle before seeing second cycle

### Case 3: Last Card Graduated, Others Waiting
**Scenario:** 19 cards graduated, 1 card just reviewed (in 30-second window)

**Behavior:**
- `eligibleCards.length === 0` (no cards past 30-second delay)
- Exception logic triggers: show the waiting card anyway
- Card appears immediately (don't show "Cards processing..." screen)

**Rationale:** No point making user wait when it's the only card left

### Case 4: User Closes and Reopens Session
**Scenario:** User exits review mid-session, comes back later

**Behavior:**
- `activeSessionCardIds` is component state (lost on unmount)
- On next session start: `activeSessionCardIds === null`
- System creates NEW 20-card batch (may include previously reviewed cards)

**Implication:** Sessions are ephemeral, not persisted across page reloads

**Future enhancement:** Could persist `activeSessionCardIds` to localStorage if session continuity is desired

---

## Performance Considerations

### Why Dynamic Loading Beats Static Queue

**Static Queue Issues:**
```javascript
// ❌ Problems with this approach:
const [reviewQueue, setReviewQueue] = useState([...20 cards...])
```
1. Queue becomes stale after reviews (doesn't reflect DB state)
2. Manual queue splicing/reordering needed
3. Cycle transitions require manual queue reconstruction
4. State sync bugs between queue and database

**Dynamic Loading Benefits:**
```javascript
// ✅ Benefits of this approach:
const [currentCard, setCurrentCard] = useState(null)
// Reload after each review
```
1. Always fresh data from database
2. No queue synchronization needed
3. Automatic cycle separation (query filters by step)
4. Simpler state management

**Performance cost:** Additional database query per card

**Mitigation:**
- Queries are fast (indexed by lecture_id, state, learning_step)
- Client-side filtering minimal (20 cards max)
- Perceived performance is instant (no lag)

### Database Query Pattern
```javascript
// Single query gets ALL cards from lecture
const { data: allCards } = await getFlashcardsByLecture(lecture.id)

// Client-side filtering (fast)
const sessionCards = allCards.filter(card =>
  activeSessionCardIds.includes(card.id) && card.state !== 'review'
)
```

**Why not filter in SQL?**
- Need full card set for cycle counts (all states)
- Session IDs are dynamic (can't parameterize efficiently)
- Client-side filtering is negligible for 20 cards

---

## Testing Scenarios

### Test 1: Normal Flow
1. Start review → 20 new cards loaded
2. Press Good on all → Cards move to second cycle
3. Wait 10 minutes
4. Press Good on all → Cards graduate
5. Session complete message appears

**Expected:** Smooth progression, no waiting screens

### Test 2: All Again
1. Start review → 20 new cards
2. Press Again on all 20 cards
3. Wait 30 seconds
4. Cards reappear in original review order

**Expected:** No position 20 issue, cards interleaved properly

### Test 3: Mixed Ratings
1. Press Again on card 1
2. Press Hard on card 2
3. Press Good on card 3
4. Press Easy on card 4

**Expected:**
- Card 1: appears in ~30 seconds
- Card 2: appears in ~6 minutes (first cycle)
- Card 3: appears in ~10 minutes (second cycle)
- Card 4: graduates immediately (removed from session)

### Test 4: Last Card Edge Case
1. Graduate 19 cards
2. Press Again on card 20
3. Immediately after review

**Expected:**
- No "Cards processing..." screen
- Card 20 appears immediately (exception logic)
- Shows despite being in 30-second window

### Test 5: Cycle Separation
1. Get 10 cards to second cycle (step 1)
2. Keep 10 cards in first cycle (step 0)
3. Review

**Expected:**
- All 10 first-cycle cards shown first
- Only after all first-cycle done → second-cycle cards appear
- No interleaving between cycles

---

## Configuration Constants

### srsAlgorithmV2.js
```javascript
export const CONFIG = {
  // Learning steps (minutes) - two-cycle system
  LEARNING_STEPS: [0.3, 10],

  // Hard interval for first cycle (between Again and Good)
  HARD_FIRST_CYCLE_INTERVAL: 6,

  // Graduating intervals (days)
  GRADUATING_INTERVAL_GOOD: 1,
  GRADUATING_INTERVAL_EASY_FIRST: 1,  // Easy in first cycle
  GRADUATING_INTERVAL_EASY_LATER: 4,  // Easy in second cycle

  // Relearning steps (when forgot from review)
  RELEARNING_STEPS: [10],

  // Ease factor bounds
  STARTING_EASE: 2.5,
  MINIMUM_EASE: 1.3,

  // Interval bounds (days)
  MINIMUM_INTERVAL: 1,
  MAXIMUM_INTERVAL: 365,

  // Interval modifiers (for review state)
  HARD_INTERVAL_MULTIPLIER: 1.2,
  EASY_BONUS_MULTIPLIER: 1.3,

  // Ease adjustments
  HARD_EASE_PENALTY: -0.15,
  EASY_EASE_BONUS: 0.15,
  AGAIN_EASE_PENALTY: -0.2,

  // Fuzz factor (randomization for review intervals)
  FUZZ_FACTOR: 0.05,

  // Session limits
  NEW_CARDS_PER_DAY: 20,
}
```

### FlashcardReviewView.jsx
```javascript
// Minimum delay between reviews (milliseconds)
const MINIMUM_DELAY_MS = 30000 // 30 seconds

// Session batch size
const SESSION_BATCH_SIZE = 20
```

---

## Future Enhancements

### Potential Improvements
1. **Session persistence:** Store `activeSessionCardIds` in localStorage to survive page reloads
2. **Custom learning steps:** Allow users to configure step intervals
3. **Per-lecture limits:** Different new card limits for different lectures
4. **Undo review:** Allow users to undo last rating if pressed wrong button
5. **Statistics:** Show retention rate, average ease, time spent per cycle
6. **Deck prioritization:** If multiple lectures have new cards, prioritize by user preference
7. **Evening out:** Spread reviews throughout day instead of clustering

### Known Limitations
1. **No mobile gestures:** Currently button-only (could add swipe gestures)
2. **No keyboard shortcuts:** Must click buttons (could add 1/2/3/4 keys)
3. **No bulk operations:** Can't suspend/bury multiple cards at once
4. **Session ephemeral:** Lost on page reload (see persistence enhancement)
5. **Fixed batch size:** Always 20 cards (could make configurable)

---

## Version History

- **v3.71:** Initial learning steps implementation
- **v3.74:** Two-cycle system with special Hard interval (6 min)
- **v3.75:** Dynamic card loading (replaced static queue)
- **v3.76:** Removed due_date filter (show all learning cards)
- **v3.78:** Overdue/future card sorting split
- **v3.79-v3.80:** 20 card limit enforcement
- **v3.81:** Prevent mid-session replacement
- **v3.82:** Sort by learning_step first
- **v3.83:** Session-based ID tracking
- **v3.84:** Minimum delay enforcement (30 seconds)
- **v3.85:** Sort by last_reviewed_at (failed approach)
- **v3.86:** Effective due date sorting (working solution)
- **v3.87:** Remove waiting screen for last cards

---

*This document describes the new card learning system as implemented in the Medical Lecture Study Assistant. The system balances proven spaced repetition principles (Anki's SM-2 algorithm) with UX optimizations for continuous learning flow.*

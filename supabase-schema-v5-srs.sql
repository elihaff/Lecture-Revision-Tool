-- Schema v5: Spaced Repetition System (SRS)
-- This migration creates a proper flashcards table with SM-2 algorithm support
-- Run this after supabase-schema-v4.sql

-- ============================================================
-- FLASHCARDS TABLE
-- ============================================================
-- Stores individual flashcards with spaced repetition metadata
CREATE TABLE IF NOT EXISTS flashcards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE NOT NULL,

  -- Card content
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  tags TEXT,

  -- Section relationship (for organization)
  section_index INTEGER,
  section_key TEXT,
  section_title TEXT,

  -- Image attachments (stored as JSONB arrays of data URLs)
  front_images JSONB DEFAULT '[]',
  back_images JSONB DEFAULT '[]',

  -- ============================================================
  -- SM-2 ALGORITHM FIELDS
  -- ============================================================

  -- Ease Factor: Multiplier for interval growth (higher = easier card)
  -- Range: 1.3 to infinity (typically 1.3-3.0)
  -- Default: 2.5 (optimal starting point)
  ease_factor REAL DEFAULT 2.5 CHECK (ease_factor >= 1.3),

  -- Interval: Days until next review
  -- 0 = new/due today, 1 = due tomorrow, 7 = due in a week, etc.
  interval_days REAL DEFAULT 0 CHECK (interval_days >= 0),

  -- Repetitions: Number of consecutive successful reviews
  -- Resets to 0 when card is forgotten
  repetitions INTEGER DEFAULT 0 CHECK (repetitions >= 0),

  -- Due Date: When this card should be reviewed next
  -- Cards with due_date <= now() are shown in review queue
  due_date TIMESTAMPTZ DEFAULT now() NOT NULL,

  -- ============================================================
  -- CARD STATE TRACKING
  -- ============================================================

  -- State: Current learning stage
  -- 'new' = Never reviewed
  -- 'learning' = Being learned (first time, interval < 1 day)
  -- 'review' = In review rotation (graduated, interval >= 1 day)
  -- 'relearning' = Was forgotten, being relearned
  state TEXT DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning')),

  -- Review statistics
  last_reviewed_at TIMESTAMPTZ,
  review_count INTEGER DEFAULT 0 CHECK (review_count >= 0),
  lapse_count INTEGER DEFAULT 0 CHECK (lapse_count >= 0),

  -- ============================================================
  -- CARD FLAGS
  -- ============================================================

  -- Suspended: Card is paused and won't appear in reviews
  -- User can manually suspend difficult or irrelevant cards
  suspended BOOLEAN DEFAULT false,

  -- Buried: Temporarily hidden until next day
  -- Useful for hiding related cards (siblings) in same session
  buried BOOLEAN DEFAULT false,
  buried_until TIMESTAMPTZ,

  -- ============================================================
  -- METADATA
  -- ============================================================

  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

-- Query cards by user
CREATE INDEX IF NOT EXISTS idx_flashcards_user_id ON flashcards(user_id);

-- Query cards by lecture
CREATE INDEX IF NOT EXISTS idx_flashcards_lecture_id ON flashcards(lecture_id);

-- Query due cards (most common query)
CREATE INDEX IF NOT EXISTS idx_flashcards_due_date ON flashcards(due_date)
WHERE NOT suspended AND NOT buried;

-- Query cards by state
CREATE INDEX IF NOT EXISTS idx_flashcards_state ON flashcards(state);

-- Composite index for getting due cards for a user
CREATE INDEX IF NOT EXISTS idx_flashcards_user_due
ON flashcards(user_id, due_date, state)
WHERE NOT suspended AND NOT buried;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

-- Users can only view their own flashcards
CREATE POLICY "Users can view own flashcards"
  ON flashcards FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only create flashcards for themselves
CREATE POLICY "Users can insert own flashcards"
  ON flashcards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own flashcards
CREATE POLICY "Users can update own flashcards"
  ON flashcards FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can only delete their own flashcards
CREATE POLICY "Users can delete own flashcards"
  ON flashcards FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- REVIEW LOGS TABLE
-- ============================================================
-- Stores every review event for analytics and undo functionality

CREATE TABLE IF NOT EXISTS review_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  flashcard_id UUID REFERENCES flashcards(id) ON DELETE CASCADE NOT NULL,

  -- Review result
  -- 1 = Again (forgot), 2 = Hard, 3 = Good, 4 = Easy
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 4),

  -- Time taken to review this card (milliseconds)
  time_taken_ms INTEGER CHECK (time_taken_ms >= 0),

  -- Card state before review (for undo functionality)
  ease_factor_before REAL,
  interval_before REAL,
  repetitions_before INTEGER,
  state_before TEXT,

  -- Card state after review
  ease_factor_after REAL,
  interval_after REAL,
  repetitions_after INTEGER,
  state_after TEXT,

  -- Timestamp
  reviewed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================
-- INDEXES FOR REVIEW LOGS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_review_logs_flashcard_id ON review_logs(flashcard_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_user_id ON review_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);

-- Composite index for user statistics queries
CREATE INDEX IF NOT EXISTS idx_review_logs_user_date
ON review_logs(user_id, reviewed_at DESC);

-- ============================================================
-- RLS FOR REVIEW LOGS
-- ============================================================

ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own review logs"
  ON review_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own review logs"
  ON review_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- AUTOMATIC TIMESTAMP UPDATE
-- ============================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for flashcards table
DROP TRIGGER IF EXISTS update_flashcards_updated_at ON flashcards;
CREATE TRIGGER update_flashcards_updated_at
  BEFORE UPDATE ON flashcards
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to get count of cards due for a user
CREATE OR REPLACE FUNCTION get_due_card_count(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM flashcards
  WHERE user_id = p_user_id
    AND due_date <= now()
    AND NOT suspended
    AND NOT buried
    AND state != 'new';
$$ LANGUAGE SQL STABLE;

-- Function to get count of new cards for a user
CREATE OR REPLACE FUNCTION get_new_card_count(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM flashcards
  WHERE user_id = p_user_id
    AND state = 'new'
    AND NOT suspended;
$$ LANGUAGE SQL STABLE;

-- Function to get retention rate for last N days
CREATE OR REPLACE FUNCTION get_retention_rate(p_user_id UUID, p_days INTEGER DEFAULT 30)
RETURNS NUMERIC AS $$
  SELECT
    CASE
      WHEN COUNT(*) = 0 THEN 100
      ELSE ROUND((COUNT(*) FILTER (WHERE rating >= 3)::NUMERIC / COUNT(*)) * 100, 1)
    END
  FROM review_logs
  WHERE user_id = p_user_id
    AND reviewed_at >= now() - (p_days || ' days')::INTERVAL;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- MIGRATION NOTE
-- ============================================================
--
-- After running this migration, flashcards from lectures.notes._flashcards
-- should be migrated to this table. The migration will happen automatically
-- in the application code when users load the dashboard.
--
-- Old flashcards will be kept in JSONB as backup.
--
-- ============================================================

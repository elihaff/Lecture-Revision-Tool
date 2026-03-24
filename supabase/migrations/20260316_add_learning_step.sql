-- Migration: Add learning_step column for SRS learning flow
-- This column tracks which step (0, 1, ...) a card is at during LEARNING/RELEARNING phases
-- The srsAlgorithmV2.js code already uses this field, but it was missing from the schema

-- ============================================================
-- FLASHCARDS TABLE: Add learning_step column
-- ============================================================

-- Add learning_step column to track position in learning steps
-- Default 0 = first step, increments as user progresses through learning steps
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS learning_step INTEGER DEFAULT 0 CHECK (learning_step >= 0);

-- ============================================================
-- REVIEW_LOGS TABLE: Add learning_step tracking
-- ============================================================

-- Add columns to track learning_step transitions during reviews
-- This enables debugging and potential undo functionality
ALTER TABLE review_logs ADD COLUMN IF NOT EXISTS learning_step_before INTEGER;
ALTER TABLE review_logs ADD COLUMN IF NOT EXISTS learning_step_after INTEGER;

-- ============================================================
-- MIGRATION NOTES
-- ============================================================
--
-- The srsAlgorithmV2.js uses learning_step to track progress through
-- the LEARNING_STEPS array [0.3min, 10min]. Cards start at step 0,
-- advance to step 1 on "Good", and graduate to REVIEW after completing
-- all steps.
--
-- Without this column, learning_step was being lost on save, causing
-- cards to always restart at step 0 instead of progressing correctly.
--

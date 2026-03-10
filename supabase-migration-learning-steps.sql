-- Migration: Add learning_step column for Anki-style learning workflow
-- Date: 2026-03-10
-- Purpose: Track which learning step a card is on (0, 1, 2, etc.)

-- Add learning_step column to flashcards table
ALTER TABLE flashcards
ADD COLUMN IF NOT EXISTS learning_step INTEGER DEFAULT 0 CHECK (learning_step >= 0);

-- Create index for efficient querying of learning cards
CREATE INDEX IF NOT EXISTS idx_flashcards_learning_step
ON flashcards(learning_step)
WHERE state IN ('learning', 'relearning');

-- Update existing cards to have learning_step = 0
UPDATE flashcards
SET learning_step = 0
WHERE learning_step IS NULL;

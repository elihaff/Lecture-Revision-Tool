-- Migration: Persist structured flashcard payload for in-session editing
-- Adds JSONB columns used by image occlusion and interpretation cards.

ALTER TABLE flashcards
  ADD COLUMN IF NOT EXISTS occlusion_data JSONB,
  ADD COLUMN IF NOT EXISTS interpretation_data JSONB;

-- Helpful index for debugging/queries by payload presence
CREATE INDEX IF NOT EXISTS idx_flashcards_structured_payload
  ON flashcards (lecture_id)
  WHERE occlusion_data IS NOT NULL OR interpretation_data IS NOT NULL;

-- Migration: Flashcard tagging system foundation
-- Adds canonical semantic tags, optional custom user labels,
-- AI suggestion storage, and source bullet traceability.

-- ============================================================
-- FLASHCARDS TABLE: Tagging + Source trace fields
-- ============================================================

ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS content_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS custom_user_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS ai_tag_suggestions JSONB;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS tags_last_suggested_at TIMESTAMPTZ;

ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS source_point_index INTEGER;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS source_point_text TEXT;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS source_parent_point_index INTEGER;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS source_parent_point_text TEXT;

-- Helpful indexes for upcoming custom-study filtering
CREATE INDEX IF NOT EXISTS idx_flashcards_content_tags_gin
  ON flashcards USING gin (content_tags);

CREATE INDEX IF NOT EXISTS idx_flashcards_custom_user_tags_gin
  ON flashcards USING gin (custom_user_tags);

CREATE INDEX IF NOT EXISTS idx_flashcards_source_point
  ON flashcards (lecture_id, section_index, source_point_index);

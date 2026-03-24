-- Migration: Remove knowledge_type column
-- This field was never populated and is being removed to simplify the tagging system.

-- Drop the constraint first if it exists
ALTER TABLE flashcards DROP CONSTRAINT IF EXISTS flashcards_knowledge_type_check;

-- Drop the column if it exists
ALTER TABLE flashcards DROP COLUMN IF EXISTS knowledge_type;

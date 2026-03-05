-- Schema v3: Add lecture dashboard fields
-- Run this migration after supabase-schema-v2.sql

-- Add learning objectives as JSONB array
-- Structure: [{ "id": "uuid", "text": "objective text", "completed": false }]
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS learning_objectives JSONB DEFAULT '[]';

-- Add phase tracking for learn/memorise progression
-- Values: 'not_started', 'learn', 'memorise', 'complete'
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'not_started';

-- Add progress percentage (0-100)
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;

-- Track whether AI notes have been generated
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS notes_generated BOOLEAN DEFAULT false;

-- Track when the lecture was processed by AI
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Add check constraints
ALTER TABLE lectures ADD CONSTRAINT lectures_phase_check
  CHECK (phase IN ('not_started', 'learn', 'memorise', 'complete'));

ALTER TABLE lectures ADD CONSTRAINT lectures_progress_check
  CHECK (progress >= 0 AND progress <= 100);

-- Create index for phase filtering (useful for dashboard queries)
CREATE INDEX IF NOT EXISTS idx_lectures_phase ON lectures(phase);

-- Create index for notes_generated filtering
CREATE INDEX IF NOT EXISTS idx_lectures_notes_generated ON lectures(notes_generated);

-- Add learn_progress column to track current section in Learn Mode
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS learn_progress INTEGER DEFAULT 0;

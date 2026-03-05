-- Schema v4: Add notes content storage
-- Run this migration after supabase-schema-v3.sql

-- Add notes JSONB column to store generated notes
-- Structure: { "title": "Lecture Title", "notes": [{ "section": "Section Title", "points": ["point1", "point2"] }] }
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT NULL;

-- Add pdf_path to store the uploaded PDF file path
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS pdf_path TEXT DEFAULT NULL;

-- Create index for notes querying
CREATE INDEX IF NOT EXISTS idx_lectures_notes ON lectures USING GIN (notes);

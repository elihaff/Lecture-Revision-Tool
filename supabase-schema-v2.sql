-- Schema Update v2: Add submodules and ordering
-- Run this in the Supabase SQL Editor AFTER the initial schema

-- Add display_order to modules
ALTER TABLE modules ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Add display_order to lectures and submodule_id
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS submodule_id UUID;

-- Create submodules table
CREATE TABLE IF NOT EXISTS submodules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  module_id UUID REFERENCES modules(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_collapsed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add foreign key for lectures -> submodules (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lectures_submodule_id_fkey'
  ) THEN
    ALTER TABLE lectures
    ADD CONSTRAINT lectures_submodule_id_fkey
    FOREIGN KEY (submodule_id) REFERENCES submodules(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS on submodules
ALTER TABLE submodules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for submodules
CREATE POLICY "Users can view own submodules"
  ON submodules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own submodules"
  ON submodules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own submodules"
  ON submodules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own submodules"
  ON submodules FOR DELETE
  USING (auth.uid() = user_id);

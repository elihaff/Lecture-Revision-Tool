-- Supabase Schema for Medical Lecture Study Assistant
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/YOUR_PROJECT/sql

-- Modules table
CREATE TABLE modules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Lectures table (for future use)
CREATE TABLE lectures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  module_id UUID REFERENCES modules(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;

-- RLS Policies for modules
CREATE POLICY "Users can view own modules"
  ON modules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own modules"
  ON modules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own modules"
  ON modules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own modules"
  ON modules FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for lectures
CREATE POLICY "Users can view own lectures"
  ON lectures FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lectures"
  ON lectures FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lectures"
  ON lectures FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own lectures"
  ON lectures FOR DELETE
  USING (auth.uid() = user_id);

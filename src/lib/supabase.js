import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Validate configuration at startup
if (!supabaseUrl || supabaseUrl === 'your-project-url' || !supabaseAnonKey || supabaseAnonKey === 'your-anon-key') {
  throw new Error('Supabase is not configured. Please update .env.local with your Supabase credentials.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

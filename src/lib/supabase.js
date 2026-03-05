import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || supabaseUrl === 'your-project-url') {
  console.warn('Supabase URL not configured. Please update .env.local with your Supabase project URL.')
}

if (!supabaseAnonKey || supabaseAnonKey === 'your-anon-key') {
  console.warn('Supabase anon key not configured. Please update .env.local with your Supabase anon key.')
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)

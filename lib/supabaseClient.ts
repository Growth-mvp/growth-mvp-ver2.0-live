// lib/supabaseClient.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

declare global {
  var __supabase: SupabaseClient | undefined;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase =
  globalThis.__supabase ?? createClient(supabaseUrl, supabaseKey);

if (process.env.NODE_ENV !== 'production') {
  globalThis.__supabase = supabase;
}

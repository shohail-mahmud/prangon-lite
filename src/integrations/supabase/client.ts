/**
 * Prangon Lite — Supabase client.
 *
 * Lite reads its backend coordinates from the environment only. Nothing in this
 * file may contain a project URL or key: the whole point of Lite is that it can
 * never reach the original Prangon project.
 *
 * Required env (see .env.example):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Prangon Lite: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. ' +
      'Copy .env.example to .env and fill in the LITE project values.',
  );
}

// Hard guard: refuse to boot against the original production project.
if (SUPABASE_URL.includes('tlknidtjixekowxmhacw')) {
  throw new Error(
    'Prangon Lite: refusing to start against the original Prangon database. ' +
      'Point VITE_SUPABASE_URL at the Lite project.',
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 5 },
  },
});

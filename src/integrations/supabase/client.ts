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
 *
 * NOTE: this module deliberately does NOT throw when the env is missing.
 * Throwing here kills the module graph before React mounts, which produced a
 * completely blank screen with no message anywhere. Instead we export a
 * `supabaseConfigError` string and let the UI render it.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Demo mode: src/mock/ intercepts every Supabase call in the browser, so no
 * real project is needed and no credentials are required.
 */
// Single source of truth — src/mock/install.ts reads the same flag so the
// interceptors and the client can never disagree.
import { usingMockData } from '@/lib/backendMode';

export { usingMockData };

/** The original Prangon project ref — Lite must never point at it. */
const ORIGINAL_PROJECT_REF = 'tlknidtjixekowxmhacw';

function describeConfigProblem(): string | null {
  // In demo mode the mock backend answers everything, so credentials are
  // optional. Without this, a mock deployment still demanded a real URL+key.
  if (usingMockData) return null;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const missing = [
      !SUPABASE_URL ? 'VITE_SUPABASE_URL' : null,
      !SUPABASE_ANON_KEY ? 'VITE_SUPABASE_ANON_KEY' : null,
    ]
      .filter(Boolean)
      .join(' and ');

    return (
      `${missing} ${missing.includes(' and ') ? 'are' : 'is'} not set.` +
      ' On Vercel: open the project → Settings → Environment Variables, add them, then Redeploy.' +
      ' Locally: copy .env.example to .env and fill in your Lite project values.'
    );
  }

  if (SUPABASE_URL.includes(ORIGINAL_PROJECT_REF)) {
    return 'Prangon Lite is pointed at the original Prangon database. Point VITE_SUPABASE_URL at the Lite project.';
  }

  return null;
}

/**
 * Non-null when the app is misconfigured. The UI reads this and shows a
 * readable error instead of hanging or going blank.
 */
export const supabaseConfigError: string | null = describeConfigProblem();

export const supabase = createClient<Database>(
  // Placeholders keep createClient from throwing; nothing is ever reached
  // because supabaseConfigError short-circuits the boot.
  SUPABASE_URL ?? (usingMockData ? 'https://your-lite-project.supabase.co' : 'https://unconfigured.supabase.co'),
  SUPABASE_ANON_KEY ?? 'unconfigured-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  },
);

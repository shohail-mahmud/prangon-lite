/**
 * Prangon Lite — decides whether the app runs against the in-browser mock
 * backend or a real Supabase project.
 *
 * Resolution order:
 *   1. VITE_USE_MOCK_DATA=true  -> always mock
 *   2. VITE_USE_MOCK_DATA=false -> never mock (real backend required)
 *   3. Not set at all           -> mock ONLY if no real credentials exist
 *
 * Rule 3 exists so a deployment with no environment variables configured
 * comes up as a working demo instead of a blank screen. It is deliberately
 * imported by both src/mock/install.ts and the Supabase client so the two
 * can never disagree.
 */
const RAW = import.meta.env.VITE_USE_MOCK_DATA;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True only when BOTH real credentials are present. */
export const hasRealCredentials: boolean = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Explicit user choice, or null when the variable was never set. */
const explicit: boolean | null =
  RAW === undefined || RAW === "" ? null : String(RAW).toLowerCase() === "true";

export const usingMockData: boolean = explicit ?? !hasRealCredentials;

if (import.meta.env.DEV) {
  console.info(
    `[Prangon Lite] backend mode: ${usingMockData ? "MOCK (no database)" : "REAL Supabase"}` +
      ` (VITE_USE_MOCK_DATA=${RAW === undefined ? "not set" : String(RAW)}${
        explicit === null && usingMockData ? ", defaulting to mock" : ""
      })`,
  );
}

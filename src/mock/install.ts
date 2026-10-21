//**
 * Prangon Lite — mock backend installer.
 *
 * Imported at the very top of src/main.tsx so the interceptors are in place
 * before the app creates its Supabase client.
 *
 * SELF-CONTAINED ON PURPOSE: this file computes the decision itself instead of
 * importing it from src/lib/backendMode.ts. If the two files ever disagree, the
 * client believes it is in mock mode while no interceptor is installed, and
 * every request goes to a placeholder host that does not resolve — producing a
 * "Can't reach the Supabase project" error. Duplicating three lines removes
 * that whole failure mode.
 */
import { installMockBackend } from "./mockBackend";
import { createSeed } from "./mockDb";

const RAW = import.meta.env.VITE_USE_MOCK_DATA;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const hasRealCredentials = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const explicit =
  RAW === undefined || RAW === ""
    ? null
    : String(RAW).toLowerCase() === "true";

// Not set -> mock UNLESS real credentials exist.
const usingMockData = explicit ?? !hasRealCredentials;

if (usingMockData) {
  installMockBackend(createSeed);
}

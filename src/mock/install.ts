/**
 * Prangon Lite — mock backend installer (dev/testing only).
 *
 * Imported at the very top of src/main.tsx so the interceptors are in place
 * before the app creates its Supabase client.
 *
 * Enabled automatically when no real Supabase credentials are configured, so a
 * deployment with zero environment variables still boots as a working demo
 * instead of showing a blank screen. See src/lib/backendMode.ts.
 */
import { usingMockData } from "@/lib/backendMode";
import { installMockBackend } from "./mockBackend";
import { createSeed } from "./mockDb";

if (usingMockData) {
  installMockBackend(createSeed);
}

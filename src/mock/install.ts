/**
 * Prangon Lite — mock backend installer (dev/testing only).
 *
 * Imported at the very top of src/main.tsx so the interceptors are in place
 * before the app creates its Supabase client. When VITE_USE_MOCK_DATA is not
 * 'true' this does nothing and the app behaves exactly as shipped.
 */
import { installMockBackend } from "./mockBackend";
import { createSeed } from "./mockDb";

if (import.meta.env.VITE_USE_MOCK_DATA === "true") {
  installMockBackend(createSeed);
}

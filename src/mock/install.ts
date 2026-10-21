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

const usingMockData = explicit ?? !hasRealCredentials;

if (usingMockData) {
  installMockBackend(createSeed);
}

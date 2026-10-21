/**
 * Prangon Lite — seed data for the in-browser mock backend (dev/testing only).
 *
 * Provides a realistic slice of Prangon content: three demo identities that
 * follow and message each other, a home feed of posts and reels, stories,
 * circles, pages, notifications and a small wallet/store set. Everything is
 * in-memory (persisted to localStorage by the mock engine) — no database.
 */
import type { MockSeed, Row } from "./mockTypes";
import { avatarDataUri, coverDataUri, photoUrl } from "./placeholderImages";

const DEMO_PASSWORD_OK = true; // checked against VITE_DEMO_PASSWORD in the engine

// ---------------------------------------------------------------- identities

export const DEMO_A = "11111111-1111-4111-8111-111111111111";
export const DEMO_B = "22222222-2222-4222-8222-222222222222";
export const DEMO_C = "33333333-3333-4333-8333-333333333333";

/** Deterministic-ish uuid generator for extra users and rows. */
let seq = 0;
const uid = (prefix = "u") =>
  `${prefix}${String(++seq).padStart(3, "0")}`.padEnd(8, "0") +
  "-0000-4000-8000-" +
  String(seq).padStart(12, "0");

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3600 * 1000).toISOString();

// Extra people to make the app feel alive.
export const PEOPLE = [
  { id: DEMO_B, username: "demo_b", displayName: "Demo User B", bio: "Follow and message this account to test relationships." },
  { id: DEMO_C, username: "demo_c", displayName: "Demo User C", bio: "Useful for testing list counts and a second conversation." },
  { id: uid("p1"), username: "ayesha_r", displayName: "Ayesha Rahman", bio: "Photographer. Chasing golden hour in Old Dhaka." },
  { id: uid("p2"), username: "tanvir_k", displayName: "Tanvir Karim", bio: "Reels about street food. Modest about it." },
  { id: uid("p3"), username: "nusrat_j", displayName: "Nusrat Jahan", bio: "Poetry, plants, and long bus rides." },
  { id: uid("p4"), username: "shafin_m", displayName: "Shafin Mahmud", bio: "Cricket on weekends, code on weekdays." },
  { id: uid("p5"), username: "mira_p", displayName: "Mira Parveen", bio: "Designing things you will scroll past beautifully." },
  { id: uid("p6"), username: "rashid_h", displayName: "Rashid Hossain", bio: "Travel diaries from every district." },
];

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- seed build

export function createSeed(): MockSeed {
  return {
    version: "prangon-mock-v1",
    authUsers: buildAuthUsers(),
    identities: {
      demo_a: "demo_a@prangon.lite",
      demo_b: "demo_b@prangon.lite",
      demo_c: "demo_c@prangon.lite",
    },
    tables: buildTables,
    relations: buildRelations(),
    rpcs: buildRpcs(),
    prepareRow,
  };
}

function buildAuthUsers(): Record<string, Row> {
  const users: Record<string, Row> = {};
  const metas: Record<string, { id: string; username: string; displayName: string }> = {
    "demo_a@prangon.lite": { id: DEMO_A, username: "demo_a", displayName: "Demo User A" },
    "demo_b@prangon.lite": { id: DEMO_B, username: "demo_b", displayName: "Demo User B" },
    "demo_c@prangon.lite": { id: DEMO_C, username: "demo_c", displayName: "Demo User C" },
  };
  for (const [email, meta] of Object.entries(metas)) {
    users[email] = {
      id: meta.id,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      phone: "",
      confirmed_at: "2026-01-01T00:00:00.000Z",
      last_sign_in_at: now(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {
        username: meta.username,
        display_name: meta.displayName,
        demo_identity_id: email.startsWith("demo_a") ? "demo_a" : email.startsWith("demo_b") ? "demo_b" : "demo_c",
        lite_profile_ready: true,
      },
      identities: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: now(),
      is_anonymous: false,
    };
  }
  return users;
}

// Fill in from the migration schema — tables, relations, rpcs, prepareRow.

function buildTables(): Record<string, Row[]> {
  return {
    profiles: [],
  };
}

function buildRelations(): MockSeed["relations"] {
  return {};
}

function buildRpcs(): MockSeed["rpcs"] {
  return {};
}

function prepareRow(table: string, row: Row): Row {
  if (!row.id) row.id = uid(table.slice(0, 2));
  if (table === "profiles" && !row.created_at) row.created_at = now();
  else if (!row.created_at) row.created_at = now();
  return row;
}

export const __unused = DEMO_PASSWORD_OK;

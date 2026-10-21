# Prangon Lite — Audit & Implementation Plan

Forked from `prangon/app-foundation-pro` @ `207c981`.

## 1. Existing architecture (audited)

| Area | Finding |
|---|---|
| Framework | Vite 5 + React 18 + TypeScript, Tailwind 3, shadcn/ui |
| Routing | `react-router-dom` v6, 37 routes in `src/App.tsx` |
| Data | `@tanstack/react-query` v5 + `@supabase/supabase-js` v2.58 |
| Backend | Supabase — 61 migrations, 4 edge functions, Postgres + RLS |
| Auth | `src/contexts/AuthContext.tsx` — real Supabase session, `onAuthStateChange` |
| **Credentials** | **HARDCODED** in `src/integrations/supabase/client.ts` (auto-generated). Blocker for backend separation. |
| Follow | `friend_requests` + `friendships` + triggers mutating `profiles.followers_count`. Two tables, mutual-insert history, no single `follows` table. |
| Messaging | 6 competing chat components (`ChatWindow`, `EnhancedChatWindow`, `FirebaseChatWindow`, `SupabaseChatWindow`, `FirebaseChatList`, …), Firebase + Supabase paths, calls, disappearing mode. No message status model. |
| Anniversary | 11 files: page, 5 components, hooks, lib, CSS, assets |
| Verified | `VerifiedBadge` + `is_verified` referenced in **44** files |
| Themes | `profile_theme` in **10** files |
| Animation | `framer-motion` + `tailwindcss-animate`; heavy `motion` usage in feed/lists |
| Bundle (baseline) | **dist 6.0 MB**, main chunk **1,597 kB** (459 kB gzip) |

## 2. Key risks

1. **Hardcoded Supabase URL/anon key** — must move to env before a separate backend is possible.
2. **Cannot create the Lite Supabase project from here** — no credentials. Schema + config prepared; provisioning is manual.
3. **Messaging is tangled** — 6 overlapping components + Firebase. Rebuilding means choosing one path (Supabase) and deleting the rest.
4. **`is_verified` in 44 files** — removal must be systematic to avoid breaking admin panels.
5. **Denormalised follow counts** — triggers mutate `profiles`; must be rebuilt alongside the new `follows` table.

## 3. Implementation order

1. Env isolation — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, no hardcoded values.
2. Demo mode — real Supabase sessions for 3 seeded demo identities + dev identity switcher.
3. Remove anniversary (page, route, nav, components, assets, CSS).
4. Remove verification UI + profile themes.
5. Remove Google OAuth + `/auth` login screen.
6. Rebuild following — `follows` table, unique constraint, RPCs, denormalised counts.
7. Rebuild messaging — conversations, participants, messages, statuses, realtime, unread counts.
8. Reduce animation; lazy-load heavy routes.
9. Lite migrations + RLS + storage policies.
10. Verify: typecheck, lint, build, bundle diff. Document.

## 4. Demo-mode design decision

Supabase RLS requires a real JWT for `auth.uid()`. Anonymous/open writes are explicitly out of scope.

Chosen approach: **real Supabase auth users** for `demo_a` / `demo_b` / `demo_c`, signed in via
`signInWithPassword` with credentials held in Lite-only env vars. This yields a genuine session, so
`auth.uid()` is server-derived and cannot be forged client-side.

Trade-off: the demo password lives in frontend env. Acceptable only because the Lite project is a
throwaway environment with no production data; documented in `LITE_SETUP.md`.

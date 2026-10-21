# Lovable workspace task list

## Done
- [x] Phase 1 — Import Prangon project (prangon-lite.zip) into the Lovable project as-is; dependencies installed; dev server runs; verified pages render in a test browser.
  - Replaced Lovable template scaffolding with the imported project (package.json, vite.config.ts, tsconfig*, tailwind.config.ts, index.html, src/, public/, supabase/, docs).
  - Added `.env` from `.env.example` (placeholder values, no database connected).
  - Fixed one import blocker: moved `<DemoIdentitySwitcher />` inside `<AuthProvider>` in `src/App.tsx` (it crashed the app when rendered).
- [x] Demo data layer (`src/mock/`) so the app can be tested without a database, per user request:
  - Browser-side interceptor for the app's Supabase calls, enabled by `VITE_USE_MOCK_DATA=true` in `.env`; no database contacted, app code unchanged.
  - Seeded: 9 profiles, 14 posts + 3 reels (sample videos), stories, 2 chat threads with unread badges, 5 notifications (3 unread), circles + posts, pages, follows/friend requests, wallets + store items, settings/roles.
  - Verified in a test browser: home feed with photos/stories/suggestions, messages (sent a chat message), notifications page, circles, search, reels playback, zero page errors.

## Pending
- [ ] Phase 2 — Prangon Lite redesign: waiting on the user's explicit instructions (per the setup brief; no redesign before then).
- [ ] Backend data (optional, user decision): point VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at a real Lite Supabase project and turn VITE_USE_MOCK_DATA off to make data-backed features real. Blocked on user.
- [ ] Not yet exercised: identity switching (Demo A/B/C), comments dialog, story viewer, wallet/store flows, admin screens.

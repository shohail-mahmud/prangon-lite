# Architecture rules
- Anniversary visual changes are event-scoped and use a ticking event clock so the original appearance returns without reloading.
- Anniversary awards and capsules are managed by authenticated Supabase functions with server-side eligibility and opening dates; no browser writes can forge awards or reveal sealed messages.
- Wrapped uses only the requesting member's recorded Supabase content totals; do not invent activity or inspect Firebase conversations for this feature.
- Wrapped PNG exports use a dedicated on-device canvas renderer with shared CSS color tokens and optional-image fallbacks; this keeps export logic separate from the photocard editor and avoids uploads.
## Lovable workspace
- This project was imported as a Vite + React 18 SPA (react-router-dom v6, Tailwind v3). It is intentionally NOT on the TanStack Start template; do not migrate routing, SSR, or server functions here unless the user asks. Preview runs `vite` on port 8080 (same as the Lovable dev server).

- Demo data layer: src/mock/ intercepts the Supabase client in the browser when VITE_USE_MOCK_DATA=true (in .env). App code untouched; no database contacted. Seed + writes live in localStorage; window.__prangonResetMockData() reseeds. Do not enable it against a real Supabase URL.

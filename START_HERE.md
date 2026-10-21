# Prangon Lite — Start Here

This is the complete, working source for Prangon Lite: a fork of Prangon with
its own database, its own env vars, and a simplified Menu/Settings.

**It will not run until you create a Supabase project.** There is no database
included, and nothing has been deployed. Follow the steps below in order.

---

## 1. Install

```bash
npm install
```

(`node_modules` is not included in this archive — it's excluded from the
workspace snapshot. Install it before anything else.)

## 2. Create the Lite Supabase project

This is a **completely separate** project from the original Prangon. Lite
deliberately refuses to boot if it detects the original project's URL, so the
two can never share data.

1. Go to supabase.com → **New project** (name it `prangon-lite`).
2. **Settings → API**, copy:
   - `Project URL`
   - `anon public` key

## 3. Configure env

```bash
cp .env.example .env
```

Fill in:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_DEMO_PASSWORD=prangon-lite-demo
VITE_SHOW_DEMO_SWITCHER=true
```

Never put the `service_role` key in `.env` — anything Vite bundles is public.

## 4. Push the database

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

This runs the 68 migrations, including the Lite-specific ones:

| Migration | What it creates |
|---|---|
| `20261018000010_lite_follows` | `follows` table, count triggers, follow/unfollow RPCs |
| `20261018000011_lite_messaging` | `lite_conversations`, `lite_participants`, `lite_messages` + participant-only RLS |
| `20261018000012_lite_demo_seed` | The three demo accounts (A / B / C) |
| `20261021000001_lite_media_limits` | 20 MiB video bucket, staging bucket, `media_assets`, `media_deletion_outbox` |
| `20261021000002_lite_permanent_deletion` | `delete_post_permanently`, `delete_comment_permanently` |
| `20261021000003_lite_feature_suspension` | `feature_flags` + triggers suspending Stories and Notes |
| `20261021000004_lite_cleanup_worker` | Outbox claim function for media cleanup |

**Skip this and the app boots to a "demo accounts not seeded" panel.**

## 5. Deploy the edge functions (optional but recommended)

```bash
supabase secrets set MEDIA_CLEANUP_TOKEN="$(openssl rand -hex 32)"
supabase functions deploy process-image
supabase functions deploy process-media-deletion
```

Without these, uploads still work (bucket limits apply) but images are **not**
resized, and deleted posts leave their media in storage instead of being
cleaned up.

To finish the media cleanup, schedule `process-media-deletion` every ~5
minutes via pg_cron or an external cron. See `LITE_MEDIA_AND_DELETION_GUIDE.md`
§5.

## 6. Run

```bash
npm run dev
```

The first demo identity signs in automatically — **there is no login screen.**

The switcher in the bottom-left corner swaps between Demo User A / B / C so you
can test following and messaging from both sides. It performs a real
sign-in/sign-out, so RLS genuinely changes.

---

## What's different from the original Prangon

| Removed / changed | Notes |
|---|---|
| Anniversary | Page, route, nav, hook, assets — fully gone |
| Google auth + login screen | Demo identity signs in automatically |
| Verification badges & request flow | Removed |
| Profile themes | One default design |
| Menu | Only Messages, Notifications, Followers, Settings |
| Settings | Four sections: Account, Appearance, Safety, About & Support |
| Stories & Notes | **Suspended** — visible, but creation blocked ("Available in a future update.") |
| Following | Rebuilt on a normalised `follows` table |
| Messaging | Rebuilt as 1:1 on `lite_*` tables with sent/delivered/read |

## Theme

Midnight Indigo. Palette lives in `src/index.css` (`:root` and `.dark` are
identical — Lite is dark-only). Glassmorphism is kept but dialled back: 12px
blur instead of 20px, more opaque panels, hairline borders.

---

## Verification status — read this

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` | **0 errors** |
| `npm run build` | **exit 0** (~11s), `dist` 3.4 MB |
| `npm run lint` | 574 errors — all pre-existing in inherited code |
| Migrations run against Postgres | **No — no database was available** |
| Edge functions executed | **No** |
| App opened in a browser | **No** |

The code compiles and builds. Nothing has been run end-to-end.

Known gaps, in priority order:

1. **The image-processing pipeline is built but not wired into the composer.**
   `usePosts.ts` still uploads images straight to `post-media`. Resize,
   compression and metadata stripping will not happen until the composer is
   switched to upload → staging bucket → `process-image`.
2. `src/integrations/supabase/types.ts` was hand-edited to add the new tables
   and RPCs so the project would compile. **After `db push`, regenerate it**
   and replace the file.
3. `src/pages/Friends.tsx` still reads the legacy `friendships` table. The Menu
   now points "Followers" at the new `/followers` page, which reads `follows`
   correctly — but `/friends` itself is stale.
4. HEIC/HEIF images are rejected by the processor.

## Docs in this archive

- `LITE_SETUP.md` — detailed provisioning steps
- `LITE_AUDIT_AND_PLAN.md` — the original audit and 9-stage plan
- `LITE_MEDIA_AND_DELETION_GUIDE.md` — media, deletion, suspension: design,
  manual setup, and the 10 verification cases to run
- `menu-settings-preview.html` — static preview of the simplified Menu/Settings
- `theme-preview.html` — static preview of the Midnight Indigo theme

# Prangon Lite — Media limits, permanent deletion, Stories/Notes suspension

**Status: implemented but NOT executed.** No database existed in this workspace, so
nothing below has been run against Postgres. Every claim in this document is about
what the code does, not about observed behaviour.

---

## What was found in the audit

- **Every upload was client-side.** `supabase.storage.from(bucket).upload(...)`
  is called directly from the browser in ~12 places. There was no trusted
  upload backend, so any client-side size check was advisory only — anyone with
  the anon key could bypass it.
- **Deletion never touched storage.** `useDeletePost` deleted the `posts` row
  and stopped. Every deleted post left its media orphaned in the bucket.
- **`posts.comments_count` is denormalised** and was never recomputed on delete.
- **`comments(post_id)` had no index** despite comment threads always being read
  by post, and deletion scanning children by post.
- **Stories and Notes had no kill switch** — suspending them from the UI alone
  would not have stopped a direct REST call.

---

## 1. Schema and migration changes

| File | What it does |
|---|---|
| `20261021000001_lite_media_limits.sql` | `post-videos` bucket (20 MiB hard cap), private `uploads-pending` staging bucket, image-only + size caps on `post-media`/`avatars`, storage RLS ownership policies, `media_assets` table, `media_deletion_outbox` table, `lite_parse_storage_url()`, `lite_enqueue_media_deletion()` |
| `20261021000002_lite_permanent_deletion.sql` | `lite_delete_where()` optional-table helper, `delete_post_permanently()`, `delete_comment_permanently()`, 6 justified indexes, `comments → posts` ON DELETE CASCADE |
| `20261021000003_lite_feature_suspension.sql` | `feature_flags` table, `feature_enabled()`, `lite_assert_feature_enabled()` trigger function, BEFORE INSERT/UPDATE triggers on `stories` and `user_notes` |
| `20261021000004_lite_cleanup_worker.sql` | `lite_claim_media_deletions()` (claim with SKIP LOCKED), `lite_media_cleanup_status()`, `lite_orphaned_media_candidates()` |

**Why 20 MiB, not 20 MB:** the limit is `20 × 1024 × 1024 = 20,971,520` bytes.
"MB" is ambiguous; the binary value is pinned in three places (bucket config,
`src/lib/mediaLimits.ts`, and the UI label) so they cannot drift.

Nothing is dropped, truncated, or deleted from existing tables. No data is
destroyed by any of these migrations.

---

## 2. Upload validation and media processing

**Where the boundaries actually are:**

| Concern | Enforced by | Bypassable from the client? |
|---|---|---|
| Video ≤ 20 MiB | `post-videos` bucket `file_size_limit` (Storage API) | No |
| Video/image MIME allow-list | bucket `allowed_mime_types` | No |
| Object ownership | RLS policies on `storage.objects` | No |
| Image resize ≤ 2048² | `process-image` edge function (service role) | No |
| Metadata / GPS stripping | `process-image` re-encode | No |
| Decompression-bomb guard | `process-image` (50 MP cap, 30 MiB input cap) | No |
| Client-side pre-checks | `src/lib/mediaLimits.ts` | **Yes — advisory only** |

**`process-image` flow:** original → private `uploads-pending` → function
verifies the caller owns the path → downloads → validates magic bytes (never
trusts filename or client MIME) → decodes → pixel guard → fits to 2048×2048
preserving aspect ratio, never upscaling → re-encodes (WebP q82, JPEG fallback)
→ 512px thumbnail → uploads to the public bucket → writes a `media_assets` row
→ **deletes the staging original**.

Re-encoding is what strips EXIF/GPS: the encoder writes a fresh file and never
copies the original metadata blocks.

Uses `ImageScript` (Deno). **HEIC/HEIF is not supported and is rejected with a
clear error** — that's a real limitation if your users shoot iPhone photos.

---

## 3. Permanent deletion and retryable cleanup

Deletion runs as one DB transaction; storage deletion **cannot** join it, so:

```
delete_post_permanently()
  ├─ authorise (owner, or admin/moderator/COO via user_roles)
  ├─ parse media URLs → lite_enqueue_media_deletion() per object
  ├─ DELETE post_media, likes, post_reactions, saved_posts, post_views,
  │         post_rankings, feed_events, post_hashtags, reports
  ├─ DELETE comment_reactions + comments (cascade also covers this)
  ├─ DELETE notifications whose action_url references the post
  └─ DELETE the post row                          ← all in one transaction

process-media-deletion (worker, service role)
  ├─ lite_claim_media_deletions()  (FOR UPDATE SKIP LOCKED — concurrency-safe)
  ├─ storage.remove() per object
  ├─ success → status 'done'
  ├─ transient failure → attempts++, exponential backoff (1,2,4,8,16,32,60 min)
  └─ attempts exhausted → status 'failed', RETAINED for manual review
```

A failed row is never discarded, so a partial failure cannot silently orphan
media. `lite_media_cleanup_status()` distinguishes "nothing to do" from
"silently stuck".

---

## 4. Stories and Notes suspension

- `feature_flags` table with `stories` and `notes` both `false`.
- **BEFORE INSERT/UPDATE triggers** on `stories` and `user_notes` reject writes
  while the flag is off — a direct REST call with a valid JWT is blocked even
  if the UI button is re-enabled in devtools.
- Triggers were chosen over RLS because a pre-existing permissive policy could
  otherwise shadow a new one.
- Reads are untouched: **existing stories and notes remain fully visible.**
- UI: `src/lib/featureFlags.ts` (no new dependency — uses React's
  `useSyncExternalStore`). `Stories.tsx` keeps the tray and viewer, blocks
  creation, and shows **"Available in a future update."**
- No tables, migrations, rows, or implementation code were deleted.

---

## 5. Manual setup (required — none of this has been done)

```bash
supabase link --project-ref YOUR-LITE-REF
supabase db push

# Edge function secrets (SUPABASE_URL / ANON / SERVICE_ROLE are injected
# automatically; only this one is custom)
supabase secrets set MEDIA_CLEANUP_TOKEN="$(openssl rand -hex 32)"

supabase functions deploy process-image
supabase functions deploy process-media-deletion
```

**Schedule the worker.** Pick one:

```sql
-- pg_cron + pg_net (enable both extensions first)
select cron.schedule('media-cleanup', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-LITE-REF.supabase.co/functions/v1/process-media-deletion',
    headers := '{"x-media-cleanup-token":"YOUR_TOKEN"}'::jsonb
  );
$$);
```

or an external cron hitting that URL every 5 minutes. Until this is scheduled,
**media cleanup will not run** — posts delete correctly, but their objects stay
in the bucket (queued, not lost).

---

## 6. Verification — run these yourself

I could not run any of these. Copy them into the SQL editor / a test client.

| # | Case | How to check | Expected |
|---|---|---|---|
| 1 | Video < 20 MiB uploads | Upload a 10 MB mp4 through the composer | Stored in `post-videos` |
| 2 | Video > 20 MiB rejected | Upload a 25 MB mp4 (or POST straight to the storage API with curl, bypassing the app) | Storage API rejects it; client pre-check also warns |
| 3 | Large image resized | Upload a 4000×3000 JPEG; then `select width,height,bytes from media_assets order by created_at desc limit 1` | ≤ 2048 on the long edge, aspect preserved, smaller than original |
| 4 | Corrupt image rejected | Rename a `.txt` to `.jpg` and upload | 415 "Unsupported or corrupted image file"; staging object removed |
| 5 | Post deletion permanent | Delete a post; `select * from posts where id='…'`; then run the worker and `select * from media_deletion_outbox where post_id='…'` | Row gone; outbox `status='done'`; object gone from bucket |
| 6 | Comment deletion permanent | Delete a comment; `select * from comments where id='…'`; check `posts.comments_count` | Row gone; count recomputed |
| 7 | Unauthorised deletion blocked | As user B: `select delete_post_permanently('<A-post-id>')` | Raises "Not allowed to delete this post" |
| 8 | Stories/Notes blocked | Try creating a story, and `insert into stories (...) ...` with a valid JWT | UI shows "Available in a future update."; both rejected |
| 9 | Existing data intact | `select count(*) from stories; select count(*) from user_notes;` before and after | Counts unchanged |
| 10 | Nothing else broken | Smoke-test feed, profile, follow, messaging, notifications | No regressions |

---

## 7. Limitations — read this before trusting anything

- **No migration has been executed.** Structural checks (balanced `$$`, parens,
  transaction control) pass, but PL/pgSQL semantics are unverified. Expect to
  iterate on the first `supabase db push`.
- **Neither edge function has ever run.** `process-image` depends on
  ImageScript's WebP encoder; there is a JPEG fallback, but the fallback itself
  is untested.
- **The image pipeline is not wired into the browser yet.** The functions,
  buckets and table exist, but `usePosts.ts` still uploads images straight to
  `post-media`. Bucket limits apply immediately; **resize/compress/strip will
  not happen until the composer is switched to upload → `uploads-pending` →
  `process-image`.** That switch is the next step.
- **Only the post composer routes video to `post-videos`.** Circles, groups,
  lab, admin, chat and calling still upload to `post-media`. That bucket keeps
  its existing MIME allow-list (so those paths keep working) but gets the same
  **20 MiB ceiling**, so video is capped at 20 MiB on every route. Migrating
  them onto `post-videos` is still worth doing, but nothing breaks meanwhile.
- **HEIC/HEIF images are rejected.**
- **Cleanup does not run** until the worker is scheduled (section 5).
- `lite_delete_where()` and the optional-table deletes silently skip tables that
  don't exist. Check which of `likes` / `post_reactions` your schema actually
  has after migrating, and confirm the right one is being cleaned.

---

## 8. Frontend changes

| File | Change |
|---|---|
| `src/lib/mediaLimits.ts` | **New.** 20 MiB constant, formatters, advisory validator, `sizedImageUrl()` for feed thumbnails |
| `src/lib/featureFlags.ts` | **New.** Central flag store (no new dependency) |
| `src/hooks/useFeatureFlags.ts` | **New.** Loads flags from the DB; fails closed |
| `src/hooks/usePosts.ts` | Video → `post-videos`, image → `post-media`; pre-flight validation with clear messages |
| `src/hooks/usePostActions.ts` | `delete_post_permanently` RPC |
| `src/hooks/usePostInteractions.ts` | `delete_comment_permanently` RPC |
| `src/components/home/Stories.tsx` | Creation blocked, viewer kept, suspension toast |
| `src/components/messages/NotesBar.tsx` | Creation blocked with suspension toast |
| `src/App.tsx` | Loads feature flags at boot |

Build exit 0 · typecheck 0 errors · lint 574 (unchanged — no new issues).

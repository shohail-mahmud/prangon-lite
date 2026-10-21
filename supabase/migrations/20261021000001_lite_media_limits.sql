-- =============================================================================
-- Prangon Lite — media upload limits, trusted processing pipeline, outbox
--
-- WHY THIS EXISTS
--   Today every upload in the app is a direct client -> Supabase Storage call
--   (`supabase.storage.from(bucket).upload(...)`). A client-side size check is
--   not a security boundary: anyone with the anon key can call the storage API
--   directly and ignore it. So the *real* limit has to live on the bucket.
--
--   Supabase Storage enforces `file_size_limit` and `allowed_mime_types`
--   server-side, which is the trusted boundary we rely on here.
--
-- 20 MiB, NOT 20 MB
--   The limit is defined as 20 * 1024 * 1024 = 20,971,520 bytes (20 MiB).
--   "MB" is ambiguous (decimal 20,000,000 vs binary 20,971,520). We use the
--   binary value explicitly and document it, so the number in the UI, the
--   bucket config and the client check can never drift apart.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Buckets
-- ---------------------------------------------------------------------------

-- Videos get their own bucket so the 20 MiB rule can be enforced exactly,
-- without also capping image uploads at the same number.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-videos',
  'post-videos',
  true,
  20971520,  -- 20 MiB — the hard video ceiling
  ARRAY['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit     = EXCLUDED.file_size_limit,
      allowed_mime_types  = EXCLUDED.allowed_mime_types,
      public              = EXCLUDED.public;

-- Private staging bucket. Originals land here first; the `process-image`
-- edge function downloads, validates, re-encodes and promotes them.
-- Nothing in here is ever served publicly.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads-pending',
  'uploads-pending',
  false,
  31457280,  -- 30 MiB input ceiling; large enough for a 4K photo, small
             -- enough to bound the processing function's memory use
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = EXCLUDED.public;

-- Existing buckets: cap the input size, but do NOT restrict MIME types here.
--
-- Circles, Groups, Lab, admin, chat and calling still upload straight to
-- `post-media`, including video. Making that bucket images-only would break
-- video in all of those paths, so instead we apply the SAME 20 MiB ceiling
-- everywhere: video is capped at 20 MiB no matter which route it takes.
--
-- Images are capped at 20 MiB of input, which is fine because the pipeline
-- resizes them down to <= 2048px anyway.
UPDATE storage.buckets
   SET file_size_limit = 20971520
 WHERE id IN ('post-media')
   AND (file_size_limit IS NULL OR file_size_limit > 20971520);

-- Avatars/banners are images only and should be small.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif'],
       file_size_limit    = 12582912  -- 12 MiB is generous for an avatar upload
 WHERE id IN ('avatars')
   AND (file_size_limit IS NULL OR file_size_limit > 12582912);

-- ---------------------------------------------------------------------------
-- 2. Storage RLS — ownership
--
-- The default posture for a public bucket is "anyone can read, owner writes".
-- We keep read public (feeds need it) but require that INSERT/UPDATE/DELETE
-- only touch objects under the caller's own prefix (<uid>/...).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION storage.public_owns_object(bucket_id text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid() IS NOT NULL
     AND split_part(object_name, '/', 1) = auth.uid()::text;
$$;

DROP POLICY IF EXISTS "lite_owner_insert" ON storage.objects;
CREATE POLICY "lite_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('post-media','post-videos','avatars','stories','uploads-pending')
    AND storage.public_owns_object(bucket_id, name)
  );

DROP POLICY IF EXISTS "lite_owner_update" ON storage.objects;
CREATE POLICY "lite_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('post-media','post-videos','avatars','stories','uploads-pending')
    AND storage.public_owns_object(bucket_id, name)
  );

DROP POLICY IF EXISTS "lite_owner_delete" ON storage.objects;
CREATE POLICY "lite_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('post-media','post-videos','avatars','stories','uploads-pending')
    AND storage.public_owns_object(bucket_id, name)
  );

-- ---------------------------------------------------------------------------
-- 3. media_assets — metadata for processed media
--
-- URLs, dimensions, byte sizes and ownership live here so the app can pick an
-- appropriately sized variant instead of downloading the full original.
-- Binary bytes never go in relational rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket       text NOT NULL,
  path         text NOT NULL,
  url          text NOT NULL,
  thumb_bucket text,
  thumb_path   text,
  thumb_url    text,
  kind         text NOT NULL CHECK (kind IN ('image','video')),
  mime_type    text NOT NULL,
  width        integer,
  height       integer,
  bytes        bigint NOT NULL,
  processed    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, path)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner
  ON public.media_assets (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_url
  ON public.media_assets (url);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_assets_owner_rw" ON public.media_assets;
CREATE POLICY "media_assets_owner_rw" ON public.media_assets
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. media_deletion_outbox — retryable storage cleanup
--
-- A DELETE against `storage.objects` cannot participate in the same
-- transaction as a DELETE against `posts`. If the DB row goes and the object
-- delete fails, the object is orphaned forever. So: the RPC writes an outbox
-- row inside the transaction, and a worker drains it afterwards, retrying
-- with backoff until it succeeds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_deletion_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket        text NOT NULL,
  path          text NOT NULL,
  owner_id      uuid,
  post_id       uuid,
  comment_id    uuid,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','done','failed')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 8,
  last_error    text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (bucket, path)
);

-- The worker only ever scans this one index.
CREATE INDEX IF NOT EXISTS idx_media_outbox_due
  ON public.media_deletion_outbox (status, next_attempt_at)
  WHERE status IN ('pending','failed');

-- No user-facing RLS: this table is only ever touched by SECURITY DEFINER
-- RPCs and by the service-role worker. RLS on without a policy = denied for
-- anon/authenticated, which is exactly what we want.
ALTER TABLE public.media_deletion_outbox ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. Helper: turn a public URL back into (bucket, path)
--
-- Needed because posts.media_url stores a full public URL, and storage
-- deletion needs the bucket + object path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_parse_storage_url(p_url text)
RETURNS TABLE (bucket text, object_path text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_bucket text;
  v_path   text;
  v_tail   text;
BEGIN
  IF p_url IS NULL OR p_url = '' THEN
    RETURN;
  END IF;

  -- Public URLs look like:
  --   https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path...>
  IF p_url LIKE '%/storage/v1/object/public/%' THEN
    v_tail := split_part(p_url, '/storage/v1/object/public/', 2);
  ELSIF p_url LIKE '%/storage/v1/object/%' THEN
    v_tail := split_part(p_url, '/storage/v1/object/', 2);
  ELSE
    RETURN;  -- external URL, not ours; nothing to delete
  END IF;

  v_bucket := split_part(v_tail, '/', 1);
  v_path   := substr(v_tail, length(v_bucket) + 2);

  IF v_bucket = '' OR v_path = '' THEN
    RETURN;
  END IF;

  bucket      := v_bucket;
  object_path := v_path;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Enqueue helper
--
-- `ignore_dups` matters: deleting a post that references the same object
-- twice must not create two outbox rows (the UNIQUE constraint would also
-- have caught it, but ON CONFLICT DO NOTHING keeps the RPC simple).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_enqueue_media_deletion(
  p_bucket     text,
  p_path       text,
  p_owner_id   uuid DEFAULT NULL,
  p_post_id    uuid DEFAULT NULL,
  p_comment_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_bucket IS NULL OR p_path IS NULL OR p_path = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.media_deletion_outbox (bucket, path, owner_id, post_id, comment_id)
  VALUES (p_bucket, p_path, p_owner_id, p_post_id, p_comment_id)
  ON CONFLICT (bucket, path) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.lite_enqueue_media_deletion(text, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lite_enqueue_media_deletion(text, text, uuid, uuid, uuid) TO authenticated, service_role;

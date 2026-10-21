-- =============================================================================
-- Prangon Lite — outbox claim function for the media cleanup worker
--
-- Claims a batch of due rows atomically and flips them to 'processing'.
-- FOR UPDATE ... SKIP LOCKED means multiple worker invocations (overlapping
-- cron ticks, a manual run during a scheduled one) can never process the same
-- row twice, and none of them block each other.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lite_claim_media_deletions(p_batch integer DEFAULT 50)
RETURNS TABLE (
  id           uuid,
  bucket       text,
  path         text,
  attempts     integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id
      FROM public.media_deletion_outbox o
     WHERE o.status IN ('pending','failed')
       AND o.attempts < o.max_attempts
       AND o.next_attempt_at <= now()
     ORDER BY o.next_attempt_at
     LIMIT LEAST(GREATEST(p_batch, 1), 500)
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.media_deletion_outbox o
       SET status = 'processing'
     WHERE o.id IN (SELECT id FROM due)
     RETURNING o.id, o.bucket, o.path, o.attempts, o.max_attempts
  )
  SELECT * FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.lite_claim_media_deletions(integer) FROM PUBLIC, anon;
-- The worker authenticates with the service role.
GRANT EXECUTE ON FUNCTION public.lite_claim_media_deletions(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Visibility for "did cleanup actually complete?"
--
-- Returns counts plus the oldest still-outstanding row, so a health check can
-- tell the difference between "nothing to do" and "silently stuck".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_media_cleanup_status()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending',    (SELECT count(*) FROM public.media_deletion_outbox WHERE status = 'pending'),
    'processing', (SELECT count(*) FROM public.media_deletion_outbox WHERE status = 'processing'),
    'failed',     (SELECT count(*) FROM public.media_deletion_outbox
                    WHERE status = 'failed' AND attempts < max_attempts),
    'exhausted',  (SELECT count(*) FROM public.media_deletion_outbox
                    WHERE status = 'failed' AND attempts >= max_attempts),
    'done',       (SELECT count(*) FROM public.media_deletion_outbox WHERE status = 'done'),
    'oldest_outstanding', (
      SELECT min(created_at) FROM public.media_deletion_outbox
       WHERE status IN ('pending','failed')
    )
  );
$$;

REVOKE ALL ON FUNCTION public.lite_media_cleanup_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lite_media_cleanup_status() TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Orphaned-media audit helper.
--
-- Lists storage objects in the media buckets that no post, profile or media
-- asset refers to any more. Intended to be run manually and reviewed before
-- any deletion — it never deletes anything itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_orphaned_media_candidates()
RETURNS TABLE (bucket text, name text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.bucket_id AS bucket, o.name, o.created_at
    FROM storage.objects o
   WHERE o.bucket_id IN ('post-media','post-videos','avatars','stories')
     AND NOT EXISTS (
       SELECT 1 FROM public.posts p
        WHERE p.media_url LIKE '%' || o.name || '%'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.avatar_url LIKE '%' || o.name || '%'
           OR pr.cover_url  LIKE '%' || o.name || '%'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.media_assets ma
        WHERE ma.path = o.name
     )
     AND o.created_at < now() - interval '24 hours'
   ORDER BY o.created_at
   LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.lite_orphaned_media_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lite_orphaned_media_candidates() TO service_role;

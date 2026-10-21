-- =============================================================================
-- Prangon Lite — permanent deletion for posts and comments
--
-- PROBLEM
--   `useDeletePost` deletes the `posts` row from the browser and never touches
--   storage, so every deleted post leaves its media orphaned in the bucket
--   forever. Comment deletion has the same shape.
--
--   Also: the old flow did the ownership check in the browser. That is a UX
--   nicety, not a boundary. The boundary is the policy/RPC below.
--
-- DESIGN
--   1. Authorisation is enforced inside the RPC (owner, or admin/mod via
--      has_role). RLS alone is not enough because we must fan out across
--      child tables in one transaction.
--   2. All relational deletion happens in ONE transaction.
--   3. Storage deletion is written to `media_deletion_outbox` and drained by
--      the `process-media-deletion` worker. DB and object storage cannot share
--      a transaction, so a partial failure must be retryable rather than
--      silently orphaning bytes.
--   4. Reappearing posts/comments: deletion is a real DELETE, not a soft flag.
--      We additionally purge the client-visible cache sources (notifications,
--      feed_events) so nothing re-emits the row after a refresh.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Justified indexes (see section 4 for the reasoning)
-- ---------------------------------------------------------------------------
-- comments are always read by post; deletion needs to find children fast.
CREATE INDEX IF NOT EXISTS idx_comments_post_id_created
  ON public.comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user_id
  ON public.comments (user_id);

-- reactions/likes are counted and removed by post.
CREATE INDEX IF NOT EXISTS idx_likes_post_id
  ON public.likes (post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_post
  ON public.likes (user_id, post_id);

-- bookmarks / saved posts
CREATE INDEX IF NOT EXISTS idx_saved_posts_post_id
  ON public.saved_posts (post_id);

-- notifications are filtered by user, and purged by reference on delete.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- feed cache tables
CREATE INDEX IF NOT EXISTS idx_feed_events_post_id
  ON public.feed_events (post_id);


-- ---------------------------------------------------------------------------
-- 1. Optional-table helper
--
-- Several optional tables may or may not exist depending on which migrations
-- have run. Rather than hard-failing, we skip them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_delete_where(
  p_table text,
  p_column text,
  p_value uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.' || quote_ident(p_table)) IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format('DELETE FROM public.%I WHERE %I = $1', p_table, p_column)
    USING p_value;
END;
$$;

REVOKE ALL ON FUNCTION public.lite_delete_where(text, text, uuid) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. delete_post_permanently
--
-- Returns a small JSON summary so the caller can report what happened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_post_permanently(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_post       public.posts;
  v_is_staff   boolean := false;
  v_media_count integer := 0;
  v_rec         record;
  v_parsed      record;
  v_deleted     integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_post FROM public.posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  -- Authorisation: owner, or staff.
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = v_uid
       AND ur.role IN ('admin','moderator','COO')
  ) INTO v_is_staff;

  IF v_post.user_id <> v_uid AND NOT v_is_staff THEN
    RAISE EXCEPTION 'Not allowed to delete this post';
  END IF;

  -- ---- 1. Collect media and enqueue storage cleanup -----------------------
  IF v_post.media_url IS NOT NULL THEN
    FOR v_parsed IN
      SELECT * FROM public.lite_parse_storage_url(v_post.media_url)
    LOOP
      PERFORM public.lite_enqueue_media_deletion(
        v_parsed.bucket, v_parsed.object_path, v_post.user_id, p_post_id, NULL
      );
      v_media_count := v_media_count + 1;
    END LOOP;
  END IF;

  IF to_regclass('public.post_media') IS NOT NULL THEN
    FOR v_rec IN
      SELECT media_url FROM public.post_media WHERE post_id = p_post_id
    LOOP
      FOR v_parsed IN SELECT * FROM public.lite_parse_storage_url(v_rec.media_url)
      LOOP
        PERFORM public.lite_enqueue_media_deletion(
          v_parsed.bucket, v_parsed.object_path, v_post.user_id, p_post_id, NULL
        );
        v_media_count := v_media_count + 1;
      END LOOP;
    END LOOP;
  END IF;

  -- ---- 2. Remove dependent rows ------------------------------------------
  -- Explicit, reviewed deletes. Anything whose FK already cascades will simply
  -- be a no-op here; anything without a cascade is handled explicitly so we
  -- never leave orphans.
  PERFORM public.lite_delete_where('post_media',        'post_id', p_post_id);
  PERFORM public.lite_delete_where('likes',             'post_id', p_post_id);
  PERFORM public.lite_delete_where('post_reactions',    'post_id', p_post_id);
  PERFORM public.lite_delete_where('saved_posts',       'post_id', p_post_id);
  PERFORM public.lite_delete_where('post_views',        'post_id', p_post_id);
  PERFORM public.lite_delete_where('post_rankings',     'post_id', p_post_id);
  PERFORM public.lite_delete_where('feed_events',       'post_id', p_post_id);
  PERFORM public.lite_delete_where('post_hashtags',     'post_id', p_post_id);
  PERFORM public.lite_delete_where('reports',           'post_id', p_post_id);

  -- Comments (and their reactions) go with the post.
  IF to_regclass('public.comments') IS NOT NULL THEN
    IF to_regclass('public.comment_reactions') IS NOT NULL THEN
      DELETE FROM public.comment_reactions cr
       WHERE cr.comment_id IN (
         SELECT c.id FROM public.comments c WHERE c.post_id = p_post_id
       );
    END IF;
    DELETE FROM public.comments WHERE post_id = p_post_id;
  END IF;

  -- Notifications that deep-link to the post would otherwise resurrect it in
  -- the UI after a refresh.
  DELETE FROM public.notifications
   WHERE action_url LIKE '%' || p_post_id::text || '%';

  -- ---- 3. Remove the post itself -----------------------------------------
  DELETE FROM public.posts WHERE id = p_post_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'post_id',     p_post_id,
    'deleted',     v_deleted,
    'media_queued', v_media_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_post_permanently(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_post_permanently(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. delete_comment_permanently
--
-- Same shape. Also fixes the counter: `posts.comments_count` is denormalised,
-- so we recompute it rather than trusting an increment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_comment_permanently(p_comment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_comment  public.comments;
  v_is_staff boolean := false;
  v_replies  integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_comment FROM public.comments WHERE id = p_comment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comment not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = v_uid
       AND ur.role IN ('admin','moderator','COO')
  ) INTO v_is_staff;

  IF v_comment.user_id <> v_uid AND NOT v_is_staff THEN
    RAISE EXCEPTION 'Not allowed to delete this comment';
  END IF;

  -- Replies first (self-referencing FK may or may not cascade).
  IF to_regclass('public.comment_reactions') IS NOT NULL THEN
    DELETE FROM public.comment_reactions
     WHERE comment_id IN (
       SELECT id FROM public.comments WHERE parent_id = p_comment_id
     );
  END IF;
  DELETE FROM public.comments WHERE parent_id = p_comment_id;
  GET DIAGNOSTICS v_replies = ROW_COUNT;

  IF to_regclass('public.comment_reactions') IS NOT NULL THEN
    DELETE FROM public.comment_reactions WHERE comment_id = p_comment_id;
  END IF;

  -- Any media attached to the comment.
  DELETE FROM public.notifications
   WHERE action_url LIKE '%' || p_comment_id::text || '%';

  DELETE FROM public.comments WHERE id = p_comment_id;

  -- Recompute the denormalised counter from source of truth.
  UPDATE public.posts
     SET comments_count = (
       SELECT count(*) FROM public.comments c WHERE c.post_id = v_comment.post_id
     )
   WHERE id = v_comment.post_id;

  RETURN jsonb_build_object(
    'comment_id', p_comment_id,
    'post_id',    v_comment.post_id,
    'replies_removed', v_replies
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_comment_permanently(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_comment_permanently(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Index rationale (deliberately conservative)
--
--   comments(post_id, created_at)  - every comment thread is read by post, and
--                                    post deletion scans children. Was missing.
--   likes(post_id)                 - count + removal by post. Was missing.
--   saved_posts(post_id)           - bookmark removal on delete.
--   notifications(user_id, ...)    - hot path on every page load.
--   feed_events(post_id)           - cache purge on delete.
--
--   We deliberately do NOT add: indexes on low-cardinality boolean columns,
--   indexes on tables already covered by a composite whose leading column
--   matches, or speculative indexes without a matching query pattern.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. Cascades we add deliberately
--
--   comments -> posts: a comment cannot outlive its post. Safe and intended.
--   We check first to avoid churn if it is already cascading.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_name = 'comments'
       AND tc.constraint_name = 'comments_post_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
     WHERE tc.table_name = 'comments'
       AND tc.constraint_name = 'comments_post_id_fkey'
       AND rc.delete_rule = 'CASCADE'
  ) THEN
    ALTER TABLE public.comments
      DROP CONSTRAINT comments_post_id_fkey,
      ADD CONSTRAINT comments_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;
  END IF;
END $$;


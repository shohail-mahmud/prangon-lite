-- =====================================================================
-- Prangon Lite — following system
--
-- Replaces the legacy friend_requests + friendships pair with a single,
-- normalised `follows` table. Instagram-like: following is one-way and
-- never creates a reciprocal relationship.
--
-- Integrity is enforced by the database, not the client:
--   * composite primary key  -> no duplicate relationships
--   * CHECK follower <> following -> no self-follow
--   * FK + ON DELETE CASCADE -> deleted users cannot corrupt the graph
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> following_id)
);

-- follower_id is covered by the PK; this index serves "who follows X" and counts.
CREATE INDEX IF NOT EXISTS follows_following_idx ON public.follows (following_id);
CREATE INDEX IF NOT EXISTS follows_created_idx   ON public.follows (created_at DESC);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- Anyone may read the graph (follower lists and counts are public).
DROP POLICY IF EXISTS "Follows are public" ON public.follows;
CREATE POLICY "Follows are public" ON public.follows
  FOR SELECT USING (true);

-- You may only create a follow row where you are the follower.
DROP POLICY IF EXISTS "Users follow as themselves" ON public.follows;
CREATE POLICY "Users follow as themselves" ON public.follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

-- You may only remove your own follow rows.
DROP POLICY IF EXISTS "Users unfollow themselves" ON public.follows;
CREATE POLICY "Users unfollow themselves" ON public.follows
  FOR DELETE USING (auth.uid() = follower_id);

-- ---------------------------------------------------------------------
-- Denormalised counters, maintained by trigger so list/count reads do
-- not aggregate the whole table on every profile view.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS followers_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sync_follow_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE public.profiles SET followers_count  = followers_count  + 1 WHERE id = NEW.following_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    UPDATE public.profiles SET followers_count  = GREATEST(0, followers_count  - 1) WHERE id = OLD.following_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS follows_count_sync ON public.follows;
CREATE TRIGGER follows_count_sync
  AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.sync_follow_counts();

-- Backfill counters from existing rows (idempotent).
UPDATE public.profiles p
SET followers_count  = (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id),
    following_count = (SELECT count(*) FROM public.follows f WHERE f.follower_id  = p.id);

-- ---------------------------------------------------------------------
-- follow_user / unfollow_user
--
-- Idempotent and race-safe: INSERT ... ON CONFLICT DO NOTHING means rapid
-- repeated taps cannot create duplicates, and DELETE always succeeds even
-- if the row is already gone. Returns the resulting state so the client
-- can update without a refetch.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.follow_user(p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;
  IF p_target IS NULL OR me = p_target THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You cannot follow yourself');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That profile no longer exists');
  END IF;

  INSERT INTO public.follows (follower_id, following_id)
  VALUES (me, p_target)
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'following', true);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.unfollow_user(p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;

  DELETE FROM public.follows WHERE follower_id = me AND following_id = p_target;

  RETURN jsonb_build_object('ok', true, 'following', false);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- Relationship state for a batch of profiles in one round trip.
CREATE OR REPLACE FUNCTION public.following_ids(p_targets uuid[])
RETURNS TABLE (following_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.following_id
  FROM public.follows f
  WHERE f.follower_id = auth.uid()
    AND f.following_id = ANY (p_targets);
$$;

REVOKE ALL ON FUNCTION public.follow_user(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unfollow_user(uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.following_ids(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.follow_user(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfollow_user(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.following_ids(uuid[]) TO authenticated;

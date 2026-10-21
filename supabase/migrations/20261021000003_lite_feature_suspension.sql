-- =============================================================================
-- Prangon Lite — temporary suspension of Stories and Notes
--
-- This is a SUSPENSION, not a removal. Nothing is dropped:
--   * no tables dropped
--   * no migrations removed
--   * no existing rows deleted
--   * no implementation code deleted
--
-- Existing Stories and Notes remain fully readable. Only WRITES are blocked.
--
-- WHY TRIGGERS AND NOT JUST RLS
--   RLS policies can be permissive, and a policy I add could be shadowed by a
--   pre-existing one I don't control. A BEFORE INSERT/UPDATE trigger fires
--   regardless of which policy let the row through, so a direct REST call with
--   a valid JWT is still rejected. The UI flag is only for presentation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key          text PRIMARY KEY,
  enabled      boolean NOT NULL DEFAULT false,
  message      text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Everyone (including anon) may READ flags; only staff may change them.
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_flags_read" ON public.feature_flags;
CREATE POLICY "feature_flags_read" ON public.feature_flags
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "feature_flags_staff_write" ON public.feature_flags;
CREATE POLICY "feature_flags_staff_write" ON public.feature_flags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed both flags disabled.
INSERT INTO public.feature_flags (key, enabled, message)
VALUES
  ('stories', false, 'Available in a future update.'),
  ('notes',   false, 'Available in a future update.')
ON CONFLICT (key) DO UPDATE
  SET message    = EXCLUDED.message,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- Helper used by both the triggers and the frontend-facing RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.feature_enabled(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.feature_flags WHERE key = p_key),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.feature_enabled(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- The gate. Raises with a user-facing message; the PostgREST error surfaces
-- it to the client so the UI can show "Available in a future update."
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_assert_feature_enabled(p_key text)
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_msg text;
BEGIN
  IF public.feature_enabled(p_key) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(message, 'Available in a future update.')
    INTO v_msg
    FROM public.feature_flags
   WHERE key = p_key;

  RAISE EXCEPTION '%', v_msg
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Stories
DROP TRIGGER IF EXISTS trg_stories_suspended ON public.stories;
CREATE TRIGGER trg_stories_suspended
  BEFORE INSERT OR UPDATE ON public.stories
  FOR EACH ROW
  EXECUTE FUNCTION public.lite_assert_feature_enabled('stories');

-- Notes
DROP TRIGGER IF EXISTS trg_user_notes_suspended ON public.user_notes;
CREATE TRIGGER trg_user_notes_suspended
  BEFORE INSERT OR UPDATE ON public.user_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.lite_assert_feature_enabled('notes');

-- Reads stay untouched on purpose: existing stories/notes must remain visible.

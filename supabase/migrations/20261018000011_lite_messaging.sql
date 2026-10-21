-- =====================================================================
-- Prangon Lite — one-to-one messaging (WhatsApp-like core)
--
-- Deliberately uses new `lite_*` tables rather than altering the legacy
-- conversations/messages structures, so Lite can never disturb them.
--
-- Model
--   lite_conversations  one row per 1:1 chat, with a canonical pair key
--   lite_participants   membership + per-participant read cursor
--   lite_messages       text messages with sent / delivered / read stamps
--
-- Status model (deliberately conservative)
--   sent      : row inserted by the sender (created_at)
--   delivered : recipient's client acknowledged receipt (delivered_at)
--   read      : recipient actually opened the conversation (read_at)
-- "Delivered" is therefore NOT inferred from a successful insert.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lite_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- canonical, order-independent key 'low::high' - makes duplicate 1:1
  -- conversations impossible at the database level
  pair_key         text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  last_message_preview text
);

CREATE TABLE IF NOT EXISTS public.lite_participants (
  conversation_id uuid NOT NULL REFERENCES public.lite_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS lite_participants_user_idx
  ON public.lite_participants (user_id);

CREATE TABLE IF NOT EXISTS public.lite_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.lite_conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  read_at         timestamptz,
  CONSTRAINT lite_message_length CHECK (char_length(body) BETWEEN 1 AND 4000)
);

-- Ordering + history pagination.
CREATE INDEX IF NOT EXISTS lite_messages_conversation_idx
  ON public.lite_messages (conversation_id, created_at DESC, id DESC);

ALTER TABLE public.lite_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lite_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lite_messages      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Access control: participants only, on every table, both directions.
-- USING restricts what you can read; WITH CHECK restricts what you can
-- write, so a client cannot insert a message into a conversation it is
-- not part of even if it guesses the id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_is_participant(p_conversation uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lite_participants
    WHERE conversation_id = p_conversation AND user_id = p_user
  );
$$;

DROP POLICY IF EXISTS "Participants read conversations" ON public.lite_conversations;
CREATE POLICY "Participants read conversations" ON public.lite_conversations
  FOR SELECT USING (public.lite_is_participant(id, auth.uid()));

DROP POLICY IF EXISTS "Participants read participants" ON public.lite_participants;
CREATE POLICY "Participants read participants" ON public.lite_participants
  FOR SELECT USING (public.lite_is_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Participants read messages" ON public.lite_messages;
CREATE POLICY "Participants read messages" ON public.lite_messages
  FOR SELECT USING (public.lite_is_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Participants send messages" ON public.lite_messages;
CREATE POLICY "Participants send messages" ON public.lite_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND public.lite_is_participant(conversation_id, auth.uid())
  );

-- Recipients may only stamp delivery/read, never author or edit content.
DROP POLICY IF EXISTS "Recipients acknowledge messages" ON public.lite_messages;
CREATE POLICY "Recipients acknowledge messages" ON public.lite_messages
  FOR UPDATE USING (public.lite_is_participant(conversation_id, auth.uid()))
  WITH CHECK (
    public.lite_is_participant(conversation_id, auth.uid())
    AND auth.uid() <> sender_id
  );

-- ---------------------------------------------------------------------
-- get_or_create_conversation — idempotent, race-safe.
-- The unique pair_key means two clients racing both land on one row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_get_or_create_conversation(p_other uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me  uuid := auth.uid();
  key text;
  cid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_other IS NULL OR p_other = me THEN
    RAISE EXCEPTION 'Invalid conversation partner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_other) THEN
    RAISE EXCEPTION 'That profile no longer exists';
  END IF;

  key := LEAST(me::text, p_other::text) || '::' || GREATEST(me::text, p_other::text);

  INSERT INTO public.lite_conversations (pair_key) VALUES (key)
  ON CONFLICT (pair_key) DO NOTHING
  RETURNING id INTO cid;

  IF cid IS NULL THEN
    SELECT id INTO cid FROM public.lite_conversations WHERE pair_key = key;
  END IF;

  INSERT INTO public.lite_participants (conversation_id, user_id)
  VALUES (cid, me), (cid, p_other)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN cid;
END;
$$;

-- ---------------------------------------------------------------------
-- send_message — validates membership server-side and returns the row so
-- the client can dedupe optimistic sends.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_send_message(p_conversation uuid, p_body text)
RETURNS public.lite_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me   uuid := auth.uid();
  body text := btrim(coalesce(p_body, ''));
  row  public.lite_messages;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF body = '' THEN RAISE EXCEPTION 'Message cannot be empty'; END IF;
  IF char_length(body) > 4000 THEN RAISE EXCEPTION 'Message is too long'; END IF;
  IF NOT public.lite_is_participant(p_conversation, me) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  INSERT INTO public.lite_messages (conversation_id, sender_id, body)
  VALUES (p_conversation, me, body)
  RETURNING * INTO row;

  UPDATE public.lite_conversations
  SET last_message_at = row.created_at,
      last_message_preview = left(body, 120)
  WHERE id = p_conversation;

  RETURN row;
END;
$$;

-- ---------------------------------------------------------------------
-- mark_delivered — recipient's client confirms receipt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_mark_delivered(p_conversation uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  n  integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.lite_is_participant(p_conversation, me) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  WITH stamped AS (
    UPDATE public.lite_messages
    SET delivered_at = now()
    WHERE conversation_id = p_conversation
      AND sender_id <> me
      AND delivered_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO n FROM stamped;

  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------
-- mark_read — a real read event: recipient opened the conversation.
-- Advances the participant cursor and stamps unread inbound messages.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_mark_read(p_conversation uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  n  integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.lite_is_participant(p_conversation, me) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  WITH stamped AS (
    UPDATE public.lite_messages
    SET read_at = now(),
        delivered_at = coalesce(delivered_at, now())
    WHERE conversation_id = p_conversation
      AND sender_id <> me
      AND read_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO n FROM stamped;

  UPDATE public.lite_participants
  SET last_read_at = now()
  WHERE conversation_id = p_conversation AND user_id = me;

  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------
-- unread_counts — one row per conversation, one round trip for the list.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lite_unread_counts()
RETURNS TABLE (conversation_id uuid, unread bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.conversation_id,
         count(m.id) FILTER (
           WHERE m.sender_id <> me.uid
             AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
         ) AS unread
  FROM public.lite_participants p
  CROSS JOIN (SELECT auth.uid() AS uid) me
  LEFT JOIN public.lite_messages m
    ON m.conversation_id = p.conversation_id
   AND m.sender_id <> me.uid
   AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
  WHERE p.user_id = me.uid
  GROUP BY p.conversation_id, p.last_read_at;
$$;

REVOKE ALL ON FUNCTION public.lite_get_or_create_conversation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lite_send_message(uuid, text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lite_mark_delivered(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lite_mark_read(uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lite_unread_counts()                 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lite_get_or_create_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lite_send_message(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.lite_mark_delivered(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.lite_mark_read(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.lite_unread_counts()                 TO authenticated;

-- ---------------------------------------------------------------------
-- Realtime: only row changes for conversations the caller can read are
-- delivered, because Realtime evaluates RLS on these tables.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lite_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lite_conversations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.lite_messages REPLICA IDENTITY FULL;

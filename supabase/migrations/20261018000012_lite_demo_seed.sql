-- =====================================================================
-- Prangon Lite — demo identities
--
-- Creates the three seeded demo accounts used by demo mode. These are real
-- Supabase auth users so that auth.uid() resolves inside RLS and identity
-- cannot be forged from the client.
--
-- The password comes from a fixed literal so it matches VITE_DEMO_PASSWORD
-- ('prangon-lite-demo'). Change both together if you change either.
--
-- Safe to re-run: guarded by email existence checks.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Allowlist used by backend policies to recognise demo traffic.
CREATE TABLE IF NOT EXISTS public.demo_accounts (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email    text NOT NULL UNIQUE,
  label    text,
  username text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.demo_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Demo accounts are readable" ON public.demo_accounts;
CREATE POLICY "Demo accounts are readable" ON public.demo_accounts
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.is_demo_user(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.demo_accounts d WHERE d.user_id = p_user);
$$;

-- ---------------------------------------------------------------------
-- Seed the identities.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  demo_pw text := 'prangon-lite-demo';
  ident   record;
  new_id  uuid;
BEGIN
  FOR ident IN
    SELECT *
    FROM (VALUES
      ('demo_a@prangon.lite', 'demo_a', 'Demo User A', 'The default demo identity.'),
      ('demo_b@prangon.lite', 'demo_b', 'Demo User B', 'Follow and message this account to test relationships.'),
      ('demo_c@prangon.lite', 'demo_c', 'Demo User C', 'Useful for testing list counts and a second conversation.')
    ) AS t(email, username, display_name, bio)
  LOOP
    SELECT id INTO new_id FROM auth.users WHERE email = ident.email;

    IF new_id IS NULL THEN
      new_id := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id, id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, is_sso_user
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        new_id, 'authenticated', 'authenticated', ident.email,
        crypt(demo_pw, gen_salt('bf')),
        now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        jsonb_build_object('username', ident.username, 'display_name', ident.display_name),
        now(), now(), false
      );

      -- Identity row so email/password sign-in resolves.
      INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), new_id::text, new_id,
        jsonb_build_object('sub', new_id::text, 'email', ident.email),
        'email', now(), now(), now()
      );
    END IF;

    -- Profile row (public identity shown in the UI).
    INSERT INTO public.profiles (id, username, display_name, bio, account_type)
    VALUES (new_id, ident.username, ident.display_name, ident.bio, 'public')
    ON CONFLICT (id) DO UPDATE
      SET username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          bio = EXCLUDED.bio;

    -- Allowlist entry.
    INSERT INTO public.demo_accounts (user_id, email, label, username)
    VALUES (new_id, ident.email, ident.display_name, ident.username)
    ON CONFLICT (email) DO NOTHING;
  END LOOP;
END $$;

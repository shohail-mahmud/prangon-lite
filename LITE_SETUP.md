# Prangon Lite — setup guide

Lite is a **fork** of Prangon with its **own Supabase project, database, and env vars**.
It shares nothing with the original: no data, no credentials, no storage, no writes.

Everything below is manual because I have no Supabase or hosting credentials in this
workspace. Nothing has been deployed.

---

## 1. Create the Lite Supabase project

1. supabase.com → **New project** → name it `prangon-lite` (any region).
2. Wait for it to finish provisioning.
3. **Settings → API** → copy:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → keep this **out of the frontend**. Only for the CLI/seed step.

> ⚠️ Never put the `service_role` key in `.env` or any file Vite bundles. It is safe only
> in a local shell or a server-side edge function secret.

---

## 2. Point the app at it

```bash
cd prangon-lite
cp .env.example .env
```

Fill in:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
VITE_DEMO_PASSWORD=prangon-lite-demo
VITE_SHOW_DEMO_SWITCHER=true
```

The client **deliberately throws on boot** if either variable is missing, or if the URL
contains `tlknidtjixekowxmhacw` (the original project). That guard stops Lite from ever
writing to production by accident.

---

## 3. Run the migrations

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

This applies the 61 inherited migrations **plus** the three new Lite ones:

| Migration | What it creates |
|---|---|
| `20261018000010_lite_follows.sql` | `follows` table (composite PK, self-follow CHECK, cascade FKs), the sync trigger that maintains `followers_count` / `following_count`, and the `follow_user` / `unfollow_user` / `following_ids` RPCs |
| `20261018000011_lite_messaging.sql` | isolated `lite_conversations` / `lite_participants` / `lite_messages`, participant-only RLS, and the `lite_get_or_create_conversation` / `lite_send_message` / `lite_mark_delivered` / `lite_mark_read` / `lite_unread_counts` RPCs |
| `20261018000012_lite_demo_seed.sql` | the `demo_accounts` allowlist and the three demo auth users (A / B / C) |

**Do not skip step 3.** Until it runs, the app boots to a "demo accounts not seeded" panel.

---

## 4. Verify the seed worked

In the Supabase SQL editor:

```sql
select id, email from auth.users where email like 'demo_%@prangon.lite';
select * from public.demo_accounts;
select id, username, display_name from public.profiles
 where id in (select user_id from public.demo_accounts);
```

You should see three rows in each. If `auth.users` is empty, the seed step was skipped —
re-run the migration and check for errors in the output.

### If email confirmation is ON

The seed sets `email_confirmed_at`, so password sign-in should work immediately.
If your project has **Confirm email** enabled and sign-in fails anyway, turn it off
under **Authentication → Providers → Email**, or the demo sign-in will be blocked.

---

## 5. Run it

```bash
npm install
npm run dev
```

The first identity (Demo User A) signs in automatically. The switcher in the
bottom-left corner swaps between A / B / C so you can test follow and messaging
from both sides — it performs a real sign-out / sign-in, so `auth.uid()` and RLS
genuinely change.

---

## 6. Deploy

Any static host (Vercel / Netlify / Cloudflare Pages):

- Build command: `npm run build`
- Output directory: `dist`
- Env vars: the same three `VITE_*` values

Use a **different host project** from the original Prangon so the two never share
a domain, a cache, or an env surface.

---

## Notes on the demo mode

- The three demo accounts share one password that ships in the frontend bundle.
  This is acceptable **only** because Lite is disposable and has no production data.
  Never reuse this pattern for a real deployment.
- Identity is still **server-derived**: the password signs in a real `auth.users` row,
  so `auth.uid()` inside RLS comes from the JWT and cannot be forged by editing
  a value in the browser.
- `demo_accounts` is the allowlist. Only those three ids can hold a Lite session.

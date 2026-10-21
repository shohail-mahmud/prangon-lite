/**
 * Prangon Lite — demo identities.
 *
 * Lite has no login screen and no Google auth. Instead it signs in as one of
 * three pre-seeded Supabase auth users using a shared demo password held in
 * VITE_DEMO_PASSWORD.
 *
 * Why real auth users instead of anonymous access:
 *   Postgres RLS resolves auth.uid() from the signed JWT. A real session means
 *   identity is derived server-side, so a client cannot impersonate another
 *   user by changing an id in the browser. Anonymous writes would force us to
 *   open up RLS, which is explicitly out of scope for Lite.
 *
 * Trade-off: the demo password is present in the frontend bundle. That is only
 * acceptable because Lite is a disposable environment with no production data.
 * See LITE_SETUP.md.
 */

export type DemoIdentityId = 'demo_a' | 'demo_b' | 'demo_c';

export interface DemoIdentity {
  id: DemoIdentityId;
  email: string;
  username: string;
  displayName: string;
  label: string;
  bio: string;
}

export const DEMO_PASSWORD: string =
  (import.meta.env.VITE_DEMO_PASSWORD as string) || 'prangon-lite-demo';

export const DEMO_IDENTITIES: readonly DemoIdentity[] = [
  {
    id: 'demo_a',
    email: 'demo_a@prangon.lite',
    username: 'demo_a',
    displayName: 'Demo User A',
    label: 'Demo A — default',
    bio: 'The default demo identity.',
  },
  {
    id: 'demo_b',
    email: 'demo_b@prangon.lite',
    username: 'demo_b',
    displayName: 'Demo User B',
    label: 'Demo B — follow & message target',
    bio: 'Follow and message this account to test relationships.',
  },
  {
    id: 'demo_c',
    email: 'demo_c@prangon.lite',
    username: 'demo_c',
    displayName: 'Demo User C',
    label: 'Demo C — lists & extra conversation',
    bio: 'Useful for testing list counts and a second conversation.',
  },
] as const;

export const DEFAULT_DEMO_IDENTITY: DemoIdentity = DEMO_IDENTITIES[0];

const STORAGE_KEY = 'prangon-lite-identity';

/** Identity switching is a testing affordance, never exposed by default. */
export const CAN_SWITCH_IDENTITIES: boolean =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_SWITCHER === 'true';

export function getStoredIdentityId(): DemoIdentityId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as DemoIdentityId | null;
    if (v && DEMO_IDENTITIES.some((d) => d.id === v)) return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_DEMO_IDENTITY.id;
}

export function storeIdentityId(id: DemoIdentityId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function getIdentity(id: DemoIdentityId): DemoIdentity {
  return DEMO_IDENTITIES.find((d) => d.id === id) ?? DEFAULT_DEMO_IDENTITY;
}

/** True when a session belongs to one of the allowed demo accounts. */
export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && DEMO_IDENTITIES.some((d) => d.email === email);
}

/** Map a signed-in email back to its demo identity, if any. */
export function identityFromEmail(
  email: string | null | undefined,
): DemoIdentity | null {
  if (!email) return null;
  return DEMO_IDENTITIES.find((d) => d.email === email) ?? null;
}

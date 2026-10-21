/**
 * Prangon Lite — boot diagnostics.
 *
 * WHY THIS EXISTS
 *   Every sign-in failure used to render as "demo accounts are not set up".
 *   That is only one of several possible causes, and it is not even the most
 *   common one. A browser that cannot reach Supabase at all reports
 *   `TypeError: Failed to fetch`, which has nothing to do with seeding — but
 *   the old panel told people to run the seed migration, sending them down the
 *   wrong path entirely.
 *
 *   This module maps the failure to the cause that actually produced it and
 *   returns an accurate next step.
 */

export type BootFailureKind =
  | "unreachable"      // network: wrong URL, paused project, offline, DNS
  | "not_seeded"       // auth worked, credentials wrong -> no demo users
  | "email_unconfirmed"// project has email confirmation switched on
  | "project_refused"  // HTTP error from a project that does exist
  | "misconfigured"    // env vars missing or malformed
  | "unknown";

export interface BootDiagnosis {
  kind: BootFailureKind;
  title: string;
  /** What actually went wrong. */
  detail: string;
  /** Concrete steps, in order. */
  steps: string[];
  /** Safe to display: the host only, never the key. */
  host?: string;
}

const NETWORK_HINTS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "err_network",
  "err_internet_disconnected",
  "err_name_not_resolved",
  "err_connection_refused",
  "load failed",
];

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch() throws TypeError on network failure
  const msg = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  return NETWORK_HINTS.some((h) => msg.includes(h));
}

/** Host only — safe to put on screen. Never log the anon key. */
export function liteSupabaseHost(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return "(VITE_SUPABASE_URL is not set)";
  try {
    return new URL(url).host;
  } catch {
    return url; // malformed; showing it as-is is the point
  }
}

export function describeBootFailure(err: unknown): BootDiagnosis {
  const raw =
    err instanceof Error
      ? err.message
      : String((err as { message?: string })?.message ?? err ?? "Unknown error");
  const msg = raw.toLowerCase();
  const host = liteSupabaseHost();

  // ---- 1. Could not reach the project at all -----------------------------
  if (isNetworkError(err)) {
    return {
      kind: "unreachable",
      title: "Can't reach the Supabase project",
      detail: `The browser could not connect to ${host}. This is a connection problem, not a missing-seed problem — running the seed migration will not fix it.`,
      steps: [
        "Check the Supabase dashboard: if the project shows as Paused or Inactive, click Restore. Free-tier projects pause after about a week of inactivity and this is the single most common cause.",
        `Confirm VITE_SUPABASE_URL in .env points at this project. It is currently ${host}.`,
        "Vite only reads .env at startup — restart the dev server after editing it.",
        "Check the browser console Network tab for the failing request and its status.",
      ],
      host,
    };
  }

  // ---- 2. Reached it, credentials rejected -------------------------------
  if (msg.includes("invalid login credentials")) {
    return {
      kind: "not_seeded",
      title: "Demo accounts are not set up",
      detail:
        "The project responded, but the demo sign-in was rejected. Either the seed migration has not run, or VITE_DEMO_PASSWORD does not match the seeded password.",
      steps: [
        "Run: supabase db push",
        "Then check the accounts exist — see LITE_SETUP.md §4.",
        "Confirm VITE_DEMO_PASSWORD in .env matches the password in the seed migration.",
      ],
      host,
    };
  }

  // ---- 3. Email confirmation is switched on ------------------------------
  if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
    return {
      kind: "email_unconfirmed",
      title: "Email confirmation is blocking the demo sign-in",
      detail:
        "The demo accounts exist but Supabase is refusing the sign-in because the project requires confirmed email addresses.",
      steps: [
        "Supabase dashboard → Authentication → Providers → Email → turn OFF 'Confirm email'.",
        "Reload the app.",
      ],
      host,
    };
  }

  // ---- 4. Rate limited / refused -----------------------------------------
  if (msg.includes("429") || msg.includes("too many requests")) {
    return {
      kind: "project_refused",
      title: "Too many sign-in attempts",
      detail: "Supabase rate-limited the request. Wait a minute and reload.",
      steps: ["Wait ~60 seconds.", "Reload the page."],
      host,
    };
  }

  // ---- 5. Env not loaded --------------------------------------------------
  if (msg.includes("must be set") || msg.includes("vite_supabase")) {
    return {
      kind: "misconfigured",
      title: "Missing environment variables",
      detail: "VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set.",
      steps: [
        "cp .env.example .env and fill in the Lite project values.",
        "Restart the dev server — Vite reads .env only at startup.",
      ],
      host,
    };
  }

  // ---- 6. Refusing to boot against the original project -------------------
  if (msg.includes("refusing to start")) {
    return {
      kind: "misconfigured",
      title: "Pointing at the original Prangon project",
      detail:
        "Lite refuses to start against the original production database. This guard is intentional.",
      steps: ["Set VITE_SUPABASE_URL to the Lite project, not the original one."],
      host,
    };
  }

  return {
    kind: "unknown",
    title: "Could not sign in to the demo account",
    detail: raw,
    steps: [
      "Check the browser console for the full error.",
      "Confirm the project is active and the env vars are correct.",
    ],
    host,
  };
}

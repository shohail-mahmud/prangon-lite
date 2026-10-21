import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "@/integrations/supabase/client";
import {
  DEMO_IDENTITIES,
  DEMO_PASSWORD,
  DemoIdentityId,
  getIdentity,
  getStoredIdentityId,
  identityFromEmail,
  isDemoEmail,
  storeIdentityId,
} from "@/lib/demoAccounts";
import { describeBootFailure, type BootDiagnosis } from "@/lib/bootDiagnostics";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Lite only: which demo identity is currently signed in. */
  demoIdentityId: DemoIdentityId | null;
  /** Lite only: switch between seeded demo accounts (testing affordance). */
  switchDemoUser: (id: DemoIdentityId) => Promise<void>;
  canSwitch: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Give up rather than spinning forever. */
const BOOT_TIMEOUT_MS = 15000;

/**
 * Signs in as a seeded demo account. Uses a real Supabase session so that
 * RLS and auth.uid() continue to be enforced server-side.
 */
async function signInAsDemo(id: DemoIdentityId) {
  const identity = getIdentity(id);
  const { error } = await supabase.auth.signInWithPassword({
    email: identity.email,
    password: DEMO_PASSWORD,
  });
  if (error) throw error;
  storeIdentityId(id);
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoIdentityId, setDemoIdentityId] =
    useState<DemoIdentityId | null>(null);
  const [bootError, setBootError] = useState<BootDiagnosis | null>(null);

  // Guards against duplicate sign-in attempts (rapid token refresh, or a user
  // hammering the identity switcher).
  const signingIn = useRef(false);

  const applySession = useCallback((next: Session | null) => {
    setSession(next);
    setUser(next?.user ?? null);
    setDemoIdentityId(
      next?.user?.email ? (identityFromEmail(next.user.email)?.id ?? null) : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const ensureDemoSession = async () => {
      // Claim the slot BEFORE awaiting. The old code checked the flag, then
      // awaited getSession(), then set the flag — so two runs could both get
      // past the check and the second returned early WITHOUT clearing
      // `loading`, leaving the app on the spinner forever.
      if (signingIn.current) {
        setLoading(false);
        return;
      }
      signingIn.current = true;

      try {
        const { data } = await supabase.auth.getSession();
        const existing = data.session;

        // Already signed in as an allowed demo account — reuse it.
        if (existing?.user?.email && isDemoEmail(existing.user.email)) {
          if (cancelled) return;
          applySession(existing);
          return;
        }

        await signInAsDemo(getStoredIdentityId());
        if (cancelled) return;

        // THE FIX: do not rely on onAuthStateChange to clear `loading`.
        // If that event never fires, the old code hung on the spinner forever.
        // Re-read the session and finish the boot ourselves.
        const { data: after } = await supabase.auth.getSession();
        if (after.session?.user) {
          applySession(after.session);
        } else {
          setLoading(false);
          setBootError(
            describeBootFailure(
              new Error(
                "Sign-in reported success but no session was returned.",
              ),
            ),
          );
        }
      } catch (err) {
        console.error("[Prangon Lite] demo sign-in failed:", err);
        if (!cancelled) {
          // Diagnose the real cause — a network failure and a missing seed
          // need different fixes, so they must not share a message.
          setBootError(describeBootFailure(err));
          setLoading(false);
        }
      } finally {
        signingIn.current = false;
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      // Keep state in sync, but never rely on this alone to finish booting.
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setDemoIdentityId(
        nextSession?.user?.email
          ? (identityFromEmail(nextSession.user.email)?.id ?? null)
          : null,
      );
      setLoading(false);
    });

    void ensureDemoSession();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [applySession]);

  // Misconfigured env: fail loudly and immediately instead of hanging or
  // rendering a blank screen (the old client.ts threw at module load, which
  // killed React before anything could be shown).
  useEffect(() => {
    if (!supabaseConfigError) return;
    setLoading(false);
    setBootError({
      kind: 'misconfigured',
      title: 'Prangon Lite is not configured',
      detail: supabaseConfigError,
      steps: [
        'Vercel: Project → Settings → Environment Variables.',
        'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase project.',
        'Go to Deployments → ⋯ → Redeploy (env vars are baked in at build time).',
      ],
      host: undefined,
    });
  }, []);

  // Watchdog: whatever happens above, never sit on the loading screen forever.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setBootError((current) =>
        current ??
        {
          kind: "unknown",
          title: "Startup timed out",
          detail:
            "The app could not finish signing in within 15 seconds. This is usually a network or configuration problem, not a missing seed.",
          steps: [
            "Open the browser console (F12) and look for the error above.",
            "Run connection-check.html to test the project directly.",
            "Check the Supabase dashboard — a paused project causes exactly this.",
          ],
          host: undefined,
        },
      );
    }, BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    // Lite never shows a login screen, so drop straight back into the default
    // demo identity rather than leaving the app in a signed-out state.
    try {
      await signInAsDemo(getStoredIdentityId());
      const { data } = await supabase.auth.getSession();
      applySession(data.session);
    } catch {
      setLoading(false);
    }
  };

  const switchDemoUser = useCallback(async (id: DemoIdentityId) => {
    if (!DEMO_IDENTITIES.some((d) => d.id === id)) return;
    if (signingIn.current) return;
    signingIn.current = true;
    setLoading(true);
    try {
      await supabase.auth.signOut();
      await signInAsDemo(id);
      const { data } = await supabase.auth.getSession();
      applySession(data.session);
    } catch (err) {
      setBootError(describeBootFailure(err));
      setLoading(false);
    } finally {
      signingIn.current = false;
    }
  }, [applySession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signOut,
        demoIdentityId,
        switchDemoUser,
        canSwitch: true,
      }}
    >
      {bootError && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background p-6">
          <div className="max-w-lg rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm">
            <h1 className="mb-2 text-base font-semibold text-destructive">
              {bootError.title}
            </h1>

            <p className="text-muted-foreground">{bootError.detail}</p>

            {bootError.host && (
              <p className="mt-3 text-xs text-muted-foreground">
                Project host:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {bootError.host}
                </code>
              </p>
            )}

            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              {bootError.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>

            <button
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[hsl(var(--primary-hover))]"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

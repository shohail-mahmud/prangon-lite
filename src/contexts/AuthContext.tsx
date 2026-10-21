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
import { supabase } from "@/integrations/supabase/client";
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
  const [bootError, setBootError] = useState<string | null>(null);

  // Guards against duplicate sign-in attempts (StrictMode double-mount,
  // rapid token refresh, or a user hammering the identity switcher).
  const signingIn = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const ensureDemoSession = async () => {
      if (signingIn.current) return;
      const { data } = await supabase.auth.getSession();
      const existing = data.session;

      // Already signed in as an allowed demo account — reuse it.
      if (existing?.user?.email && isDemoEmail(existing.user.email)) {
        if (cancelled) return;
        setSession(existing);
        setUser(existing.user);
        setDemoIdentityId(identityFromEmail(existing.user.email)?.id ?? null);
        setLoading(false);
        return;
      }

      // Otherwise sign in as the selected (or default) demo identity.
      signingIn.current = true;
      try {
        await signInAsDemo(getStoredIdentityId());
      } catch (err) {
        if (!cancelled) {
          setBootError(
            err instanceof Error
              ? err.message
              : "Could not sign in to the demo account",
          );
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
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setDemoIdentityId(
        identityFromEmail(nextSession?.user?.email)?.id ?? null,
      );
      setLoading(false);
    });

    void ensureDemoSession();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    // Lite never shows a login screen, so drop straight back into the default
    // demo identity rather than leaving the app in a signed-out state.
    try {
      await signInAsDemo(getStoredIdentityId());
    } catch {
      /* leave signed out if the demo accounts are unavailable */
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
    } finally {
      signingIn.current = false;
      setLoading(false);
    }
  }, []);

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
          <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-5 text-sm">
            <h1 className="mb-2 font-semibold text-destructive">
              Prangon Lite demo accounts are not set up
            </h1>
            <p className="text-muted-foreground">
              {bootError}
            </p>
            <p className="mt-3 text-muted-foreground">
              Run the Lite seed migration to create demo_a / demo_b / demo_c,
              then reload. See LITE_SETUP.md.
            </p>
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

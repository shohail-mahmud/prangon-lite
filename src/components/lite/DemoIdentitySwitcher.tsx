/**
 * Prangon Lite — demo identity switcher.
 *
 * A testing affordance, not a product feature: it lets you jump between the
 * seeded demo accounts to exercise following and messaging from both sides.
 * Rendered only when VITE_SHOW_DEMO_SWITCHER is enabled or in dev.
 *
 * Switching performs a real sign-out / sign-in, so the session JWT — and
 * therefore auth.uid() inside RLS — genuinely changes.
 *
 * The panel can be collapsed to a small floating button; the choice is
 * remembered in localStorage.
 */
import { useEffect, useState } from "react";
import { Users, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEMO_IDENTITIES,
  CAN_SWITCH_IDENTITIES,
  DemoIdentityId,
} from "@/lib/demoAccounts";

const STORAGE_KEY = "prangon-lite:demo-switcher-hidden";

export const DemoIdentitySwitcher = () => {
  const { demoIdentityId, switchDemoUser, loading } = useAuth();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      /* storage unavailable — default to visible */
    }
  }, []);

  const setHiddenPersisted = (value: boolean) => {
    setHidden(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* ignore */
    }
  };

  if (!CAN_SWITCH_IDENTITIES) return null;

  // Collapsed: just a small round button to bring the panel back.
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHiddenPersisted(false)}
        title="Show demo identity switcher"
        aria-label="Show demo identity switcher"
        className="fixed bottom-4 left-4 z-50 hidden h-9 w-9 items-center justify-center rounded-full border bg-background/95 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground sm:flex"
      >
        <Users className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 hidden sm:block">
      <div className="rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur">
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Demo identity
          </span>
          <button
            type="button"
            onClick={() => setHiddenPersisted(true)}
            title="Hide this panel"
            aria-label="Hide demo identity switcher"
            className="-mr-0.5 flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {DEMO_IDENTITIES.map((identity) => {
            const active = identity.id === demoIdentityId;
            return (
              <button
                key={identity.id}
                type="button"
                disabled={loading}
                onClick={() => switchDemoUser(identity.id as DemoIdentityId)}
                className={
                  "rounded-lg px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-60 " +
                  (active ? "bg-primary text-primary-foreground" : "hover:bg-muted")
                }
              >
                <div className="font-medium">{identity.label}</div>
                <div
                  className={
                    "text-[10px] " +
                    (active ? "text-primary-foreground/80" : "text-muted-foreground")
                  }
                >
                  @{identity.username}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * Prangon Lite — demo identity switcher.
 *
 * A testing affordance, not a product feature: it lets you jump between the
 * seeded demo accounts to exercise following and messaging from both sides.
 * Rendered only when VITE_SHOW_DEMO_SWITCHER is enabled or in dev.
 *
 * Switching performs a real sign-out / sign-in, so the session JWT — and
 * therefore auth.uid() inside RLS — genuinely changes.
 */
import { Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEMO_IDENTITIES,
  CAN_SWITCH_IDENTITIES,
  DemoIdentityId,
} from "@/lib/demoAccounts";

export const DemoIdentitySwitcher = () => {
  const { demoIdentityId, switchDemoUser, loading } = useAuth();

  if (!CAN_SWITCH_IDENTITIES) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 hidden sm:block">
      <div className="rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur">
        <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Users className="h-3 w-3" />
          Demo identity
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
                  (active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted")
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

/**
 * Prangon Lite — Menu.
 *
 * Deliberately small: only the four primary destinations (Messages,
 * Notifications, Followers, Settings) plus role panels for staff accounts.
 * Secondary features still exist in the app's main navigation; they are just
 * not duplicated here.
 */
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { getVersionInfo } from "@/lib/version";
import { toast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/contexts/RolesContext";
import {
  DEFAULT_DEMO_IDENTITY,
  storeIdentityId,
} from "@/lib/demoAccounts";
import {
  Bell,
  MessageCircle,
  Heart,
  Settings,
  ChevronRight,
  ArrowLeft,
  Shield,
  Headphones,
  BarChart3,
  Flag,
  RefreshCw,
} from "lucide-react";

interface MenuItem {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  path: string;
}

/** The only primary destinations in Lite. */
const primaryItems: MenuItem[] = [
  { id: "messages", icon: MessageCircle, label: "Messages", description: "Your conversations", path: "/messages" },
  { id: "notifications", icon: Bell, label: "Notifications", description: "Your alerts", path: "/notifications" },
  { id: "followers", icon: Heart, label: "Followers", description: "Followers and following", path: "/followers" },
  { id: "settings", icon: Settings, label: "Settings", description: "Account, appearance, safety", path: "/settings" },
];

const Menu = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isModerator, isAdvisor, isSupport } = useRoles();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  /**
   * Lite runs on a predefined demo identity, so there is no "log out" — the
   * session is restored automatically. Resetting returns to Demo User A and
   * does not delete anything.
   */
  const handleResetDemoSession = () => {
    storeIdentityId(DEFAULT_DEMO_IDENTITY.id);
    toast({ title: "Demo session reset", description: "Returning to Demo User A." });
    window.location.reload();
  };

  // Staff panels stay available, but only for accounts that hold the role.
  const roleItems: MenuItem[] = [];
  if (isAdmin) roleItems.push({ id: "admin", icon: Shield, label: "Admin Panel", description: "Manage the platform", path: "/admin" });
  if (isSupport && !isAdmin) roleItems.push({ id: "support", icon: Headphones, label: "Support Panel", description: "Handle support tickets", path: "/support-panel" });
  if (isModerator && !isAdmin) roleItems.push({ id: "moderator", icon: Flag, label: "Moderator Panel", description: "Review reports & content", path: "/moderator-panel" });
  if (isAdvisor && !isAdmin) roleItems.push({ id: "advisor", icon: BarChart3, label: "Advisor Panel", description: "Insights & suggestions", path: "/advisor-panel" });

  const renderMenuRow = (item: MenuItem) => (
    <button
      key={item.id}
      onClick={() => navigate(item.path)}
      className="flex w-full items-center gap-3.5 rounded-xl p-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60">
        <item.icon className="h-[18px] w-[18px] text-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{item.label}</p>
        <p className="truncate text-xs text-muted-foreground">{item.description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </button>
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="lg-nav sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-screen-md items-center gap-3 px-4">
          <button
            onClick={() => navigate(-1)}
            className="-ml-2 rounded-full p-2 transition-colors hover:bg-muted/60"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">Menu</h1>
        </div>
      </div>

      <div className="mx-auto max-w-screen-md space-y-4 px-4 py-4">
        {/* Profile */}
        <Card
          className="cursor-pointer p-4 transition-colors hover:bg-muted/30"
          onClick={() => navigate("/profile")}
        >
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={profile?.avatar_url || undefined} />
              <AvatarFallback className="bg-muted text-muted-foreground text-lg">
                {profile?.username?.charAt(0).toUpperCase() || "P"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">
                {profile?.display_name || profile?.username || "User"}
              </p>
              <p className="truncate text-xs text-muted-foreground">@{profile?.username}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        </Card>

        {/* Primary destinations */}
        <div className="space-y-0.5">{primaryItems.map(renderMenuRow)}</div>

        {/* Staff panels — only rendered when the account holds a role */}
        {roleItems.length > 0 && (
          <div className="space-y-2">
            <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Panels
            </p>
            <div className="space-y-0.5">{roleItems.map(renderMenuRow)}</div>
          </div>
        )}

        {/* Session — separated from navigation */}
        <div className="space-y-2 border-t border-border pt-4">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Demo session
          </p>
          <button
            onClick={handleResetDemoSession}
            className="flex w-full items-center gap-3.5 rounded-xl p-3 text-left transition-colors hover:bg-muted/40"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60">
              <RefreshCw className="h-[18px] w-[18px] text-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Reset demo session</p>
              <p className="truncate text-xs text-muted-foreground">
                Returns to Demo User A — nothing is deleted
              </p>
            </div>
          </button>
        </div>

        {/* Version */}
        <div className="pt-4 text-center">
          <p className="text-xs text-muted-foreground">{getVersionInfo().fullVersion}</p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">{getVersionInfo().copyright}</p>
        </div>
      </div>
    </div>
  );
};

export default Menu;

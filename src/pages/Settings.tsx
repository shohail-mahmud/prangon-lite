/**
 * Prangon Lite — Settings.
 *
 * Four sections only: Account, Appearance, Safety, About & Support.
 * Anything without a real implementation behind it is not shown — there are no
 * placeholder toggles, no verification flow, and no account-security controls,
 * because Lite runs on a predefined demo identity rather than persistent user
 * accounts.
 *
 * Deferred screens (notifications, data & storage, security, sound/haptics)
 * are hidden from the UI here; their components and database tables are left
 * untouched.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/layout/MainLayout";
import { PrivacyTerms } from "@/components/settings/PrivacyTerms";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  CAN_SWITCH_IDENTITIES,
  DEMO_IDENTITIES,
  DEFAULT_DEMO_IDENTITY,
  storeIdentityId,
  type DemoIdentityId,
} from "@/lib/demoAccounts";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  User,
  Palette,
  Shield,
  HelpCircle,
  ArrowLeft,
  ChevronRight,
  Check,
  Ban,
  Flag,
  HeadphonesIcon,
  BookOpen,
  FileText,
  Info,
  RefreshCw,
  Loader2,
} from "lucide-react";

const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "hi", name: "Hindi", native: "हिंदी" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "zh", name: "Chinese", native: "中文" },
];

type SettingsSection = "main" | "account" | "appearance" | "safety" | "help";

const SECTION_TITLES: Record<SettingsSection, string> = {
  main: "Settings",
  account: "Account",
  appearance: "Appearance",
  safety: "Safety",
  help: "About & Support",
};

interface MenuItem {
  id: Exclude<SettingsSection, "main">;
  icon: React.ElementType;
  label: string;
  description: string;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "account", icon: User, label: "Account", description: "Profile, email, visibility" },
  { id: "appearance", icon: Palette, label: "Appearance", description: "Theme and language" },
  { id: "safety", icon: Shield, label: "Safety", description: "Blocked users and reporting" },
  { id: "help", icon: HelpCircle, label: "About & Support", description: "Help, guidelines, terms" },
];

interface BlockedRow {
  id: string;
  blocked_user_id: string;
  profiles: { id: string; username: string | null; display_name: string | null; avatar_url: string | null } | null;
}

const Settings = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user, demoIdentityId, switchDemoUser } = useAuth();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<SettingsSection>("main");

  // ── Load the saved language preference (this part is real) ──────────────
  useEffect(() => {
    const loadLanguagePreference = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from("user_settings")
        .select("language")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.language && data.language !== i18n.language) {
        i18n.changeLanguage(data.language);
      }
    };
    loadLanguagePreference();
  }, [user?.id, i18n]);

  const handleLanguageChange = async (langCode: string) => {
    i18n.changeLanguage(langCode);
    localStorage.setItem("prangon-language", langCode);
    const lang = LANGUAGES.find((l) => l.code === langCode);
    document.documentElement.dir = lang?.rtl ? "rtl" : "ltr";
    if (user?.id) {
      await supabase
        .from("user_settings")
        .upsert({ user_id: user.id, language: langCode }, { onConflict: "user_id" });
    }
    toast({ title: "Language", description: lang?.native || langCode });
  };

  // ── Blocked users (backed by the real blocked_users table) ──────────────
  const blockedQuery = useQuery({
    queryKey: ["blocked-users", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<BlockedRow[]> => {
      const { data, error } = await supabase
        .from("blocked_users")
        .select(
          "id, blocked_user_id, profiles!blocked_users_blocked_user_id_fkey(id, username, display_name, avatar_url)",
        )
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []) as unknown as BlockedRow[];
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase.from("blocked_users").delete().eq("id", rowId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-users", user?.id] });
      toast({ title: "User unblocked" });
    },
    onError: () => toast({ title: "Could not unblock", variant: "destructive" }),
  });

  // ── Demo session ────────────────────────────────────────────────────────
  // Lite has no persistent accounts, so there is nothing to delete or
  // deactivate. Resetting only returns to the default demo identity.
  const handleResetDemoSession = () => {
    storeIdentityId(DEFAULT_DEMO_IDENTITY.id);
    toast({ title: "Demo session reset", description: "Returning to Demo User A." });
    window.location.reload();
  };

  const handleSwitchIdentity = async (id: DemoIdentityId) => {
    await switchDemoUser(id);
    toast({ title: "Switched demo identity" });
  };

  // ── Shared building blocks ──────────────────────────────────────────────
  const renderSectionHeader = (title: string) => (
    <div className="lg-nav sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-screen-md items-center gap-3 px-4">
        <button
          onClick={() => setActiveSection("main")}
          className="-ml-2 rounded-full p-2 transition-colors hover:bg-muted/60"
          aria-label="Back to settings"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
    </div>
  );

  /** Compact, consistently spaced row used across every settings screen. */
  const Row = ({
    icon: Icon,
    label,
    description,
    onClick,
    right,
  }: {
    icon: React.ElementType;
    label: string;
    description?: string;
    onClick?: () => void;
    right?: React.ReactNode;
  }) => {
    const Wrapper = onClick ? "button" : "div";
    return (
      <Wrapper
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-3.5 rounded-xl p-3 text-left",
          onClick && "transition-colors hover:bg-muted/40",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60">
          <Icon className="h-[18px] w-[18px] text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {description && (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {right ?? (onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" /> : null)}
      </Wrapper>
    );
  };

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );

  // ── Sections ────────────────────────────────────────────────────────────
  const renderMainMenu = () => (
    <div className="mx-auto max-w-screen-md px-4 py-4">
      <div className="space-y-0.5">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSection(item.id)}
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
        ))}
      </div>

      {/* Account actions — kept clearly separate from navigation */}
      <div className="mt-4 border-t border-border pt-3">
        <SectionLabel>Demo session</SectionLabel>
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Lite runs on a shared demo identity, so there is no password, no
          two-factor setup, and no account to delete.
        </p>

        {CAN_SWITCH_IDENTITIES && (
          <div className="space-y-0.5">
            {DEMO_IDENTITIES.map((identity) => {
              const active = identity.id === demoIdentityId;
              return (
                <button
                  key={identity.id}
                  onClick={() => handleSwitchIdentity(identity.id as DemoIdentityId)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors",
                    active ? "bg-primary/10" : "hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      active ? "border-primary text-primary" : "border-muted-foreground/40",
                    )}
                  >
                    {active && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{identity.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      @{identity.username}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="pt-2">
          <Row
            icon={RefreshCw}
            label="Reset demo session"
            description="Return to Demo User A"
            onClick={handleResetDemoSession}
          />
        </div>
      </div>
    </div>
  );

  const renderAccount = () => (
    <div className="mx-auto max-w-screen-md px-4 py-4">
      <SectionLabel>Profile</SectionLabel>
      <div className="space-y-0.5">
        <Row
          icon={User}
          label="Edit profile"
          description="Name, username, bio and photo"
          onClick={() => navigate("/profile")}
        />
      </div>

      <SectionLabel>Account details</SectionLabel>
      <div className="space-y-0.5">
        <Row icon={Info} label="Email" description={user?.email || "No email on this identity"} />
      </div>
    </div>
  );

  const renderAppearance = () => (
    <div className="mx-auto max-w-screen-md px-4 py-4">
      <SectionLabel>Theme</SectionLabel>
      <div className="flex items-center gap-3 rounded-xl border-2 border-primary bg-primary/5 p-3">
        <span className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--lavender))]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Midnight Indigo</p>
          <p className="text-xs text-muted-foreground">The only theme in Lite</p>
        </div>
        <Check className="h-4 w-4 shrink-0 text-primary" />
      </div>

      <SectionLabel>{t("settings.language")}</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={cn(
              "flex items-center justify-between rounded-xl border-2 p-3 text-left transition-all",
              i18n.language === lang.code
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{lang.native}</p>
              <p className="truncate text-xs text-muted-foreground">{lang.name}</p>
            </div>
            {i18n.language === lang.code && (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  );

  const renderSafety = () => {
    const blocked = blockedQuery.data ?? [];
    return (
      <div className="mx-auto max-w-screen-md px-4 py-4">
        <SectionLabel>Blocked users</SectionLabel>
        {blockedQuery.isLoading && (
          <div className="space-y-1">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-3.5 w-32" />
              </div>
            ))}
          </div>
        )}

        {!blockedQuery.isLoading && blocked.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            You haven't blocked anyone. You can block someone from their profile.
          </p>
        )}

        {blocked.length > 0 && (
          <div className="space-y-0.5">
            {blocked.map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-xl p-2.5">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={row.profiles?.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-muted text-muted-foreground">
                    {(row.profiles?.display_name ||
                      row.profiles?.username ||
                      "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {row.profiles?.display_name || row.profiles?.username || "Unknown user"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{row.profiles?.username}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unblockMutation.isPending}
                  onClick={() => unblockMutation.mutate(row.id)}
                >
                  {unblockMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Unblock"
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        <SectionLabel>Reporting</SectionLabel>
        <div className="space-y-0.5">
          <Row
            icon={Flag}
            label="Report a problem"
            description="Report bugs, issues, or violations"
            onClick={() => navigate("/help-support")}
          />
        </div>
      </div>
    );
  };

  const renderHelp = () => (
    <div className="mx-auto max-w-screen-md px-4 py-4">
      <SectionLabel>Support</SectionLabel>
      <div className="space-y-0.5">
        <Row
          icon={HeadphonesIcon}
          label="Contact support"
          description="Get help from our team"
          onClick={() => navigate("/help-support")}
        />
      </div>

      <SectionLabel>Information</SectionLabel>
      <div className="space-y-0.5">
        <Row
          icon={BookOpen}
          label="Community guidelines"
          description="Our community standards"
          onClick={() => navigate("/community-standards")}
        />
        <Row
          icon={Info}
          label="About Prangon Lite"
          description="Version and app info"
          onClick={() => navigate("/about")}
        />
      </div>

      <SectionLabel>Legal</SectionLabel>
      <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-foreground">
        <FileText className="h-[18px] w-[18px]" />
        <h3 className="text-sm font-semibold">Privacy & Terms</h3>
      </div>
      <PrivacyTerms />
    </div>
  );

  const SECTION_CONTENT: Record<Exclude<SettingsSection, "main">, () => JSX.Element> = {
    account: renderAccount,
    appearance: renderAppearance,
    safety: renderSafety,
    help: renderHelp,
  };

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        {activeSection === "main" ? (
          <>
            {renderSectionHeader(SECTION_TITLES.main)}
            {renderMainMenu()}
          </>
        ) : (
          <>
            {renderSectionHeader(SECTION_TITLES[activeSection])}
            {SECTION_CONTENT[activeSection]()}
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default Settings;

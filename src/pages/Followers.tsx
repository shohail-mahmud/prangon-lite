/**
 * Prangon Lite — Followers & Following.
 *
 * Reads the Lite `follows` table (not the legacy `friendships` table), so the
 * lists stay in sync with the follow buttons on profiles.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useFollowList, type FollowProfile } from "@/hooks/lite/useFollow";
import { cn } from "@/lib/utils";

type TabId = "followers" | "following";

const TABS: { id: TabId; label: string }[] = [
  { id: "followers", label: "Followers" },
  { id: "following", label: "Following" },
];

const PersonRow = ({ profile }: { profile: FollowProfile }) => (
  <Link
    to={`/profile/${profile.id}`}
    className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40"
  >
    <Avatar className="h-10 w-10">
      <AvatarImage src={profile.avatar_url ?? undefined} />
      <AvatarFallback className="bg-muted text-muted-foreground">
        {(profile.display_name || profile.username || "?").charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-foreground">
        {profile.display_name || profile.username || "Unknown user"}
      </p>
      <p className="truncate text-xs text-muted-foreground">@{profile.username}</p>
    </div>
  </Link>
);

const EmptyState = ({ tab }: { tab: TabId }) => (
  <div className="flex flex-col items-center gap-3 py-16 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
      <Users className="h-5 w-5 text-primary" />
    </div>
    <div>
      <p className="text-sm font-medium text-foreground">
        {tab === "followers" ? "No followers yet" : "Not following anyone yet"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {tab === "followers"
          ? "People who follow you will show up here."
          : "Follow someone from their profile to see them here."}
      </p>
    </div>
  </div>
);

const Followers = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("followers");

  const { data: people, isLoading, isError } = useFollowList(user?.id, tab);

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        {/* Header — restrained glass, matching the rest of Lite */}
        <div className="lg-nav sticky top-0 z-40">
          <div className="mx-auto flex h-14 max-w-screen-md items-center gap-3 px-4">
            <button
              onClick={() => navigate(-1)}
              className="-ml-2 rounded-full p-2 transition-colors hover:bg-muted/60"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </button>
            <h1 className="text-lg font-semibold text-foreground">Followers</h1>
          </div>
        </div>

        <div className="mx-auto max-w-screen-md px-4 py-4">
          {/* Tabs */}
          <div className="mb-2 flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {isLoading && (
            <div className="space-y-1 pt-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {isError && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Couldn't load this list. Please try again.
            </p>
          )}

          {!isLoading && !isError && people && people.length === 0 && (
            <EmptyState tab={tab} />
          )}

          {!isLoading && !isError && people && people.length > 0 && (
            <div className="space-y-0.5 pt-1">
              {people.map((profile: FollowProfile) => (
                <PersonRow key={profile.id} profile={profile} />
              ))}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default Followers;

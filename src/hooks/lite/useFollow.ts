/**
 * Prangon Lite — following.
 *
 * All mutations go through SECURITY DEFINER RPCs so uniqueness, self-follow
 * and existence checks are enforced by Postgres, not by the client.
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface FollowProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface FollowCounts {
  followers: number;
  following: number;
}

/** Followers / following counts for one profile. */
export function useFollowCounts(userId: string | undefined) {
  return useQuery({
    queryKey: ["lite", "follow-counts", userId],
    enabled: !!userId,
    queryFn: async (): Promise<FollowCounts> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("followers_count, following_count")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      const counts = data as { followers_count: number; following_count: number } | null;
      return {
        followers: counts?.followers_count ?? 0,
        following: counts?.following_count ?? 0,
      };
    },
    staleTime: 30_000,
  });
}

/** Is the current user following `targetId`? */
export function useIsFollowing(targetId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["lite", "is-following", user?.id, targetId],
    enabled: !!user?.id && !!targetId && user.id !== targetId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("follower_id", user!.id)
        .eq("following_id", targetId!)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    staleTime: 30_000,
  });
}

interface ToggleResult {
  ok: boolean;
  following?: boolean;
  error?: string;
}

/**
 * Follow / unfollow with optimistic UI.
 *
 * Rapid taps are safe: the RPC is idempotent (ON CONFLICT DO NOTHING / plain
 * DELETE) and `isPending` disables the control while a request is in flight.
 */
export function useFollowToggle(targetId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<ToggleResult> => {
      if (!user?.id || !targetId) throw new Error("Not ready");
      if (user.id === targetId) throw new Error("You cannot follow yourself");

      const key = ["lite", "is-following", user.id, targetId];
      const currently = qc.getQueryData<boolean>(key) ?? false;

      const { data, error } = await supabase.rpc(
        currently ? "unfollow_user" : "follow_user",
        { p_target: targetId },
      );

      if (error) throw error;
      const result = data as unknown as ToggleResult;
      if (result && result.ok === false) throw new Error(result.error ?? "Failed");
      return result;
    },
    onMutate: async () => {
      if (!user?.id || !targetId) return;
      const key = ["lite", "is-following", user.id, targetId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<boolean>(key);
      qc.setQueryData<boolean>(key, !previous);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!user?.id || !targetId) return;
      const key = ["lite", "is-following", user.id, targetId];
      if (context && typeof context === "object" && "previous" in context) {
        qc.setQueryData(key, (context as { previous?: boolean }).previous);
      }
    },
    onSettled: () => {
      if (!user?.id || !targetId) return;
      qc.invalidateQueries({ queryKey: ["lite", "is-following", user.id, targetId] });
      qc.invalidateQueries({ queryKey: ["lite", "follow-counts", targetId] });
      qc.invalidateQueries({ queryKey: ["lite", "follow-counts", user.id] });
      qc.invalidateQueries({ queryKey: ["lite", "follow-list"] });
    },
  });

  const toggle = useCallback(() => mutation.mutate(), [mutation]);
  return { ...mutation, toggle };
}

/** Follower or following list with profile rows attached. */
export function useFollowList(
  userId: string | undefined,
  direction: "followers" | "following",
) {
  return useQuery({
    queryKey: ["lite", "follow-list", userId, direction],
    enabled: !!userId,
    queryFn: async (): Promise<FollowProfile[]> => {
      // Two plain queries rather than a `profiles!fk` embed: this avoids
      // depending on the exact auto-generated foreign-key constraint name,
      // which cannot be verified without a live database.
      const column = direction === "followers" ? "follower_id" : "following_id";
      const matchOn = direction === "followers" ? "following_id" : "follower_id";

      const { data: links, error: linkError } = await supabase
        .from("follows")
        .select(`${column}, created_at`)
        .eq(matchOn, userId!)
        .order("created_at", { ascending: false })
        .limit(200);

      if (linkError) throw linkError;
      if (!links?.length) return [];

      const ids = links.map((row) => (row as unknown as Record<string, string>)[column]);

      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", ids);

      if (profileError) throw profileError;

      // Preserve the follow order returned above.
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      return ids
        .map((id) => byId.get(id))
        .filter((p): p is FollowProfile => Boolean(p));
    },
    staleTime: 30_000,
  });
}

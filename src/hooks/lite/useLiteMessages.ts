/**
 * Prangon Lite — one-to-one messaging.
 *
 * Reads and writes go through the lite_* RPCs so membership is enforced by
 * Postgres. Realtime is scoped per conversation and cleaned up on unmount so
 * a background screen cannot leak another conversation's traffic.
 */
import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type MessageStatus = "sending" | "sent" | "delivered" | "read";

interface ConversationProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface UnreadRow {
  conversation_id: string;
  unread: number | string;
}

export interface LiteMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export function statusOf(m: LiteMessage): MessageStatus {
  if (m.read_at) return "read";
  if (m.delivered_at) return "delivered";
  return "sent";
}

/** Conversations for the current user, with unread counts. */
export function useLiteConversations() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["lite", "conversations", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // 1. conversations I belong to
      const { data: mine, error: partErr } = await supabase
        .from("lite_participants")
        .select("conversation_id, last_read_at")
        .eq("user_id", user!.id);
      if (partErr) throw partErr;
      if (!mine?.length) return [];

      const ids = mine.map((m) => m.conversation_id);

      // 2. conversation rows
      const { data: convos, error: convErr } = await supabase
        .from("lite_conversations")
        .select("*")
        .in("id", ids)
        .order("last_message_at", { ascending: false });
      if (convErr) throw convErr;

      // 3. the other participant of each conversation
      const { data: others, error: otherErr } = await supabase
        .from("lite_participants")
        .select(
          "conversation_id, user_id, profiles:user_id(id, username, display_name, avatar_url)",
        )
        .in("conversation_id", ids)
        .neq("user_id", user!.id);
      if (otherErr) throw otherErr;

      // 4. unread counts in one round trip
      const { data: unreadRows } = await supabase.rpc("lite_unread_counts");
      const unreadMap = new Map<string, number>(
        ((unreadRows ?? []) as UnreadRow[]).map((r) => [r.conversation_id, Number(r.unread)]),
      );

      type OtherRow = { conversation_id: string; profiles: ConversationProfile | null };
      const otherMap = new Map(
        ((others ?? []) as unknown as OtherRow[]).map((o) => [o.conversation_id, o.profiles]),
      );

      return (convos ?? []).map((c) => ({
        id: c.id,
        last_message_at: c.last_message_at,
        preview: c.last_message_preview,
        other: otherMap.get(c.id) ?? null,
        unread: unreadMap.get(c.id) ?? 0,
      }));
    },
    staleTime: 5_000,
  });

  // Refresh the list when any conversation changes.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("lite-conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lite_messages" },
        () => qc.invalidateQueries({ queryKey: ["lite", "conversations", user.id] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  return query;
}

/** Message history for one conversation, kept live by Realtime. */
export function useLiteMessages(conversationId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["lite", "messages", conversationId],
    enabled: !!conversationId,
    queryFn: async (): Promise<LiteMessage[]> => {
      const { data, error } = await supabase
        .from("lite_messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LiteMessage[];
    },
    staleTime: 1_000,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`lite-messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lite_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["lite", "messages", conversationId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, qc]);

  return query;
}

/** Send a message. Server assigns id + timestamp; we reconcile locally. */
export function useSendLiteMessage(conversationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) throw new Error("Message cannot be empty");
      if (trimmed.length > 4000) throw new Error("Message is too long");
      const { data, error } = await supabase.rpc("lite_send_message", {
        p_conversation: conversationId!,
        p_body: trimmed,
      });
      if (error) throw error;
      return data as unknown as LiteMessage;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite", "messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["lite", "conversations"] });
    },
  });
}

/**
 * Mark inbound messages delivered (client received them) and read (user is
 * looking at the conversation). Both are explicit events — a successful
 * insert by the sender never counts as delivery.
 */
export function useAcknowledge(conversationId: string | undefined) {
  const qc = useQueryClient();

  const markDelivered = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("lite_mark_delivered", {
        p_conversation: conversationId!,
      });
      if (error) throw error;
    },
  });

  const markRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("lite_mark_read", {
        p_conversation: conversationId!,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite", "conversations"] });
      qc.invalidateQueries({ queryKey: ["lite", "messages", conversationId] });
    },
  });

  return { markDelivered, markRead };
}

/** Open (or create) the 1:1 conversation with another user. */
export function useOpenConversation() {
  return useMutation({
    mutationFn: async (otherUserId: string) => {
      const { data, error } = await supabase.rpc("lite_get_or_create_conversation", {
        p_other: otherUserId,
      });
      if (error) throw error;
      return data as string;
    },
  });
}

/** Total unread across all conversations (for a nav badge). */
export function useTotalUnread() {
  const { data } = useLiteConversations();
  return useMemo(
    () => (data ?? []).reduce((sum, c) => sum + (c.unread ?? 0), 0),
    [data],
  );
}

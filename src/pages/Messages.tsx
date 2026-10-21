/**
 * Prangon Lite — one-to-one messaging (WhatsApp-like core).
 *
 * Text only, conversation history, realtime updates, unread counts and
 * sent / delivered / read states. No group chat, calls, or media.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CheckCheck, Clock, Loader2, Send, ArrowLeft } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  statusOf,
  useAcknowledge,
  useLiteConversations,
  useLiteMessages,
  useSendLiteMessage,
} from "@/hooks/lite/useLiteMessages";

// Ticks inherit the bubble's foreground so they stay visible on the indigo
// sent-bubble; only opacity distinguishes the states.
const StatusTicks = ({ status }: { status: ReturnType<typeof statusOf> }) => {
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 opacity-70" />;
  if (status === "sent") return <Check className="h-3.5 w-3.5 opacity-70" />;
  return <Clock className="h-3.5 w-3.5 opacity-60" />;
};

const Messages = () => {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading } = useLiteConversations();
  const { data: messages, isLoading: loadingMessages } = useLiteMessages(activeId ?? undefined);
  const send = useSendLiteMessage(activeId ?? undefined);
  const { markDelivered, markRead } = useAcknowledge(activeId ?? undefined);

  // Keep the newest message in view.
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  // A real read event: only when the user actually has the conversation open.
  useEffect(() => {
    if (!activeId || !messages?.length) return;
    void markRead.mutateAsync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messages?.length]);

  // Delivery is acknowledged by the recipient's client, not by the sender.
  useEffect(() => {
    if (!activeId || !messages?.length) return;
    const inboundUnacked = messages.some(
      (m) => m.sender_id !== user?.id && !m.delivered_at,
    );
    if (inboundUnacked) void markDelivered.mutateAsync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messages]);

  const active = conversations?.find((c) => c.id === activeId) ?? null;

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft("");
    send.mutate(body, {
      onError: () => setDraft(body), // restore so the user can retry
    });
  };

  return (
    <MainLayout>
      <div className="mx-auto flex h-[calc(100dvh-64px)] max-w-5xl overflow-hidden rounded-xl border bg-background">
        {/* Conversation list */}
        <aside
          className={cn(
            "w-full shrink-0 border-r md:w-80",
            activeId && "hidden md:block",
          )}
        >
          <div className="border-b px-4 py-3">
            <h1 className="text-base font-semibold">Messages</h1>
            <p className="text-[11px] text-muted-foreground">Prangon Lite · demo mode</p>
          </div>
          <div ref={listRef} className="h-[calc(100%-57px)] overflow-y-auto">
            {isLoading && (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            )}
            {!isLoading && !conversations?.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No conversations yet. Open a profile and send a message.
              </p>
            )}
            {conversations?.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  activeId === c.id && "bg-muted",
                )}
              >
                <Avatar className="h-10 w-10">
                  <AvatarImage src={(c.other as any)?.avatar_url ?? ""} />
                  <AvatarFallback>
                    {((c.other as any)?.display_name ?? "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {(c.other as any)?.display_name ?? "Unknown user"}
                    </span>
                    {c.unread > 0 && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        {c.unread}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.preview ?? "No messages yet"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Conversation */}
        <section className={cn("flex min-w-0 flex-1 flex-col", !activeId && "hidden md:flex")}>
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Select a conversation, or open a profile to start one.
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b px-4 py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => setActiveId(null)}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Avatar className="h-9 w-9">
                  <AvatarImage src={(active?.other as any)?.avatar_url ?? ""} />
                  <AvatarFallback>
                    {((active?.other as any)?.display_name ?? "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <Link
                    to={`/profile/${(active?.other as any)?.id ?? ""}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {(active?.other as any)?.display_name ?? "Unknown user"}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    @{(active?.other as any)?.username ?? "unknown"}
                  </p>
                </div>
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {loadingMessages && <Skeleton className="h-24 w-full" />}
                {messages?.map((m) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <div
                      key={m.id}
                      className={cn("flex", mine ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[78%] rounded-2xl px-3 py-2 text-sm",
                          mine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted",
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <div
                          className={cn(
                            "mt-1 flex items-center justify-end gap-1 text-[10px]",
                            mine ? "text-primary-foreground/80" : "text-muted-foreground",
                          )}
                        >
                          <span>
                            {new Date(m.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {mine && <StatusTicks status={statusOf(m)} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form
                className="flex items-center gap-2 border-t p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Message"
                  maxLength={4000}
                  aria-label="Message"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim() || send.isPending}
                  aria-label="Send"
                >
                  {send.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </MainLayout>
  );
};

export default Messages;

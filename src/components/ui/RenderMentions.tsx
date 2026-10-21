import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { memo, useCallback } from "react";

interface RenderMentionsProps {
  text: string;
}

export const RenderMentions = memo(({ text }: RenderMentionsProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Extract all @mentions from text
  const mentionPattern = /@(\w+)/g;
  const usernames = Array.from(text.matchAll(mentionPattern)).map(m => m[1]);

  const { data: mentionedUsers } = useQuery({
    queryKey: ["mentioned-users", usernames.join(",")],
    queryFn: async () => {
      if (usernames.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("username", usernames);
      return data || [];
    },
    enabled: usernames.length > 0,
    staleTime: 60000,
  });

  const handleMentionClick = useCallback(async (userId: string) => {
    // Send notification
    if (user?.id && user.id !== userId) {
      try {
        await supabase.rpc("create_notification", {
          p_user_id: userId,
          p_from_user_id: user.id,
          p_type: "mention",
          p_title: "You were mentioned",
          p_message: "Someone mentioned you",
          p_action_url: `/profile/${userId}`,
        });
      } catch (e) {
        // Silently fail - notification is not critical
      }
    }
    navigate(`/profile/${userId}`);
  }, [navigate, user?.id]);

  // Split on, keeping the separators:
  //   1. [label](https://url)  -> a labelled link
  //   2. @mention              -> a profile mention
  //   3. https://url           -> a bare URL
  // Order matters: the labelled-link pattern must come first so it wins.
  const parts = text.split(
    /(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|@\w+|https?:\/\/[^\s<]+)/g,
  );

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("@")) {
          const username = part.slice(1);
          const found = mentionedUsers?.find(u => u.username === username);
          if (found) {
            return (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  handleMentionClick(found.id);
                }}
                className="text-primary font-semibold hover:underline cursor-pointer inline"
              >
                {part}
              </button>
            );
          }
        }

        // [label](url) — render only the label as the clickable text.
        if (part.startsWith("[")) {
          const md = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
          if (md) {
            return (
              <a
                key={i}
                href={md[2]}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-primary font-semibold hover:underline"
              >
                {md[1]}
              </a>
            );
          }
          // Malformed marker (e.g. nested brackets) — show it as plain text
          // rather than leaking raw syntax into the feed.
          return <span key={i}>{part.replace(/[\[\]()]/g, "")}</span>;
        }

        if (part.startsWith("http://") || part.startsWith("https://")) {
          // Trim trailing punctuation that belongs to the sentence, not the URL.
          const match = part.match(/^(https?:\/\/[^\s<]*?)([.,;:!?)\]}]+)?$/);
          const href = match ? match[1] : part;
          const trailing = match?.[2] ?? "";
          return (
            <span key={i}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-primary font-semibold hover:underline break-all"
              >
                {href}
              </a>
              {trailing}
            </span>
          );
        }

        return <span key={i}>{part}</span>;
      })}
    </>
  );
});

RenderMentions.displayName = "RenderMentions";

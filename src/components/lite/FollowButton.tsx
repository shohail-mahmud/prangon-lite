/**
 * Prangon Lite — follow / unfollow control.
 *
 * Disabled while a request is in flight, which together with the idempotent
 * RPC makes rapid repeated taps safe.
 */
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useFollowToggle, useIsFollowing } from "@/hooks/lite/useFollow";
import { toast } from "@/hooks/use-toast";

interface FollowButtonProps {
  targetId: string;
  className?: string;
  size?: "sm" | "default";
}

export const FollowButton = ({ targetId, className, size = "sm" }: FollowButtonProps) => {
  const { user } = useAuth();
  const { data: isFollowing, isLoading } = useIsFollowing(targetId);
  const { mutate: toggle, isPending } = useFollowToggle(targetId);

  if (!user?.id || user.id === targetId) return null;

  const handleClick = () => {
    toggle(undefined, {
      onError: (err) =>
        toast({
          title: "Could not update",
          description: err instanceof Error ? err.message : "Please try again",
          variant: "destructive",
        }),
    });
  };

  const busy = isPending || isLoading;

  return (
    <Button
      size={size}
      onClick={handleClick}
      disabled={busy}
      aria-pressed={!!isFollowing}
      className={cn("gap-1.5", className)}
      variant={isFollowing ? "outline" : "default"}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isFollowing ? (
        <UserMinus className="h-3.5 w-3.5" />
      ) : (
        <UserPlus className="h-3.5 w-3.5" />
      )}
      {isFollowing ? "Following" : "Follow"}
    </Button>
  );
};

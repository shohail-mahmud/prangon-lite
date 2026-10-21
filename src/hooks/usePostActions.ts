import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export const useDeletePost = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (postId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Permanent delete via the trusted RPC:
      //   * authorisation is enforced server-side (owner or staff)
      //   * comments, reactions, media rows and notifications are removed in
      //     one transaction
      //   * storage objects are queued in media_deletion_outbox for the
      //     retryable cleanup worker
      const { data, error } = await supabase.rpc("delete_post_permanently", {
        p_post_id: postId,
      });

      if (error) throw new Error(error.message || "Failed to delete post");
      return (data as { post_id?: string })?.post_id ?? postId;
    },

    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: ["posts"] });
      const previousPosts = queryClient.getQueryData(["posts"]);
      const previousArchivedPosts = queryClient.getQueryData(["archivedPosts"]);

      // Remove from active posts
      queryClient.setQueryData(["posts"], (old: any) => {
        if (!old) return old;
        return old.filter((post: any) => post.id !== postId);
      });

      // Remove from archived posts
      queryClient.setQueryData(["archivedPosts"], (old: any) => {
        if (!old) return old;
        return old.filter((post: any) => post.id !== postId);
      });

      return { previousPosts, previousArchivedPosts };
    },

    onError: (err, variables, context) => {
      if (context?.previousPosts) {
        queryClient.setQueryData(["posts"], context.previousPosts);
      }
      if (context?.previousArchivedPosts) {
        queryClient.setQueryData(["archivedPosts"], context.previousArchivedPosts);
      }
      toast({
        title: "Error",
        description: "Failed to delete post. Please try again.",
        variant: "destructive",
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["archivedPosts"] });
    },
  });
};

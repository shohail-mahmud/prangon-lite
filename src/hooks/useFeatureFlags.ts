/**
 * Fetches feature availability from the database so the UI and the backend
 * triggers can never disagree.
 *
 * If the `feature_flags` table hasn't been migrated yet, every feature stays
 * disabled (fail-closed) rather than exposing a control the backend will
 * reject.
 */
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setFeatureFlags, type FeatureKey } from "@/lib/featureFlags";

export const useFeatureFlags = () => {
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("feature_flags")
        .select("key, enabled");

      // On error we simply keep the fail-closed defaults.
      if (error || !data || cancelled) return;

      const next: Partial<Record<FeatureKey, boolean>> = {};
      for (const row of data) {
        if (row.key === "stories" || row.key === "notes") {
          next[row.key as FeatureKey] = !!row.enabled;
        }
      }
      if (!cancelled) setFeatureFlags(next);
    };

    void load();

    // Keep in sync if a flip happens while the app is open.
    const channel = supabase
      .channel("feature-flags")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feature_flags" },
        () => void load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);
};

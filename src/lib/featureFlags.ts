/**
 * Prangon Lite — centralised feature availability.
 *
 * Stories and Notes are SUSPENDED, not removed. One place controls it so the
 * UI can never drift out of sync with itself.
 *
 * The UI side is presentation only. The authoritative gate is the database:
 * migration 20261021000003 installs BEFORE INSERT/UPDATE triggers on
 * `stories` and `user_notes` that reject writes while the flag is off, so a
 * direct REST call with a valid JWT is blocked even if someone re-enables the
 * button in devtools.
 *
 * Implemented with React's built-in useSyncExternalStore so this needs no new
 * dependency.
 */
import { useSyncExternalStore } from "react";

export const SUSPENDED_MESSAGE = "Available in a future update.";

export type FeatureKey = "stories" | "notes";

/** Fail-safe default: if the flag table can't be read, stay disabled. */
const DEFAULT_FLAGS: Record<FeatureKey, boolean> = {
  stories: false,
  notes: false,
};

let currentFlags: Record<FeatureKey, boolean> = { ...DEFAULT_FLAGS };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => currentFlags;

export function setFeatureFlags(next: Partial<Record<FeatureKey, boolean>>): void {
  const merged = { ...currentFlags, ...next };
  const changed = (Object.keys(merged) as FeatureKey[]).some(
    (k) => merged[k] !== currentFlags[k],
  );
  if (!changed) return;
  currentFlags = merged;
  listeners.forEach((l) => l());
}

/**
 * Synchronous read for render-time decisions (disable a button, hide a
 * composer). Reflects the last value fetched from the backend.
 */
export function isFeatureEnabled(key: FeatureKey): boolean {
  return currentFlags[key] ?? DEFAULT_FLAGS[key];
}

export function featureMessage(key: FeatureKey): string {
  return isFeatureEnabled(key) ? "" : SUSPENDED_MESSAGE;
}

/** Reactive subscription for components. */
export function useFeatureFlagsState(): Record<FeatureKey, boolean> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useFeatureEnabled(key: FeatureKey): boolean {
  return useFeatureFlagsState()[key] ?? DEFAULT_FLAGS[key];
}

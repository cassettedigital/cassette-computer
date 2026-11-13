/**
 * Client-wide bust token for on-disk album covers served at a stable sidecar URL.
 *
 * The hub rewrites cover.jpg in place; without a changing query the desktop
 * webview / <img> keeps painting the prior bytes even after a successful replace
 * (BUG-106). Bump this after any path that writes the folder cover so CoverArt
 * and now-playing surfaces refetch immediately.
 */

let epoch = 0;
const listeners = new Set<() => void>();

export function getLocalCoverEpoch(): number {
  return epoch;
}

export function bumpLocalCoverEpoch(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}

export function subscribeLocalCoverEpoch(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

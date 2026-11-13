/**
 * Queue-mirror reconcile — the pure decision behind the shell's engine poll.
 *
 * The dashboard is a remote control: the hub's native engine plays, and the web
 * keeps a MIRROR of the queue it sent (display queue + a "shown" index) so the
 * transport bar can name the track. Each ~1s poll of the engine's live state
 * runs through this function to decide what the mirror should do next. It lives
 * outside React (no state, no DOM, no DB) so every branch is unit-tested.
 *
 * Why the mirror can't just trust itself:
 *   - The native queue is a FILTERED SUBSET of the display queue (catalog-only
 *     tracks the Mac doesn't have are dropped), so indices don't line up — match
 *     the engine's track BY ID (BUG-029 / the stuck cover).
 *   - Right after a click the poll can be stale (still naming the previous track,
 *     or nothing loaded), so an optimistic play is trusted for a settle window.
 *   - The engine can be on a track this surface doesn't know (foreign playback).
 *   - The engine can have NOTHING loaded while the mirror still names a track:
 *     the album ran out with repeat off, the hub restarted empty, or a play
 *     command never landed. Before BUG-333 that case was never handled, so the
 *     bar hung on the last track of every finished album as if it were still
 *     loaded. Now the mirror drops to neutral, which hides the transport (see
 *     DashboardShell) — the honest at-rest state.
 */

export type MirrorTrack = { subsonicTrackId?: string | null };

/** The slice of the engine's polled state the mirror reconciles against. */
export type EngineTruth = {
  currentTrackId: string | null;
  queueIndex: number;
  queueLength: number;
};

export type MirrorInput = {
  /** The display queue (may hold catalog-only tracks the engine never got). */
  queue: readonly MirrorTrack[];
  /** Index the mirror currently names as now playing; -1 when neutral. */
  shownIndex: number;
  engine: EngineTruth;
  /** Track id an optimistic play expects the engine to reach, or null. */
  pendingTrackId: string | null;
  /** Deadline (ms epoch) for that convergence — the settle window. */
  pendingUntil: number;
  now: number;
  /** Consecutive polls, this one included, on which the engine had no track. */
  idlePolls: number;
};

export type MirrorDecision =
  /** Leave the mirror where it is. */
  | { action: "hold"; clearPending: boolean }
  /** Move the shown index to the engine's track. */
  | { action: "snap"; index: number; clearPending: boolean }
  /**
   * Drop to neutral (no shown track). `keepFrom` is the first display-queue
   * entry that survives as the local Up Next builder: 0 keeps everything
   * (foreign playback — the queue is still ours), `queue.length` keeps nothing
   * (the album finished), and anything between keeps only what was queued past
   * the track the engine stopped on.
   */
  | { action: "neutral"; keepFrom: number; clearPending: true };

/**
 * Consecutive idle polls before an idle engine is trusted over a mirror that
 * still names a track. Two, not one: the sidecar answers a momentarily
 * unreadable engine with the same "nothing playing" shape as a real stop, and
 * one glitch must not retract the bar mid-song.
 */
export const IDLE_POLLS_TO_TRUST = 2;

export function reconcileQueueMirror(input: MirrorInput): MirrorDecision {
  const { queue, shownIndex, engine, pendingTrackId, pendingUntil, now, idlePolls } = input;
  const engineId = engine.currentTrackId;
  const shown = shownIndex >= 0 ? queue[shownIndex] ?? null : null;

  // An optimistic play is inside its settle window and the engine hasn't
  // reached it yet: whatever this poll says (the previous track, or nothing
  // loaded) predates the click and must not move the mirror.
  const settling =
    pendingTrackId !== null && engineId !== pendingTrackId && now < pendingUntil;
  // The click landed, or the window ran out — either way the suppression ends.
  const converged = pendingTrackId !== null && engineId === pendingTrackId;
  const expired = pendingTrackId !== null && now >= pendingUntil;
  const clearPending = converged || expired;

  if (engineId) {
    if (shown?.subsonicTrackId === engineId) return { action: "hold", clearPending };
    if (settling) return { action: "hold", clearPending: false };
    // Fast path when the native queue IS the display queue (same length and the
    // engine's index names its id); otherwise the native queue is a filtered
    // subset, so find the id.
    const idx =
      engine.queueLength === queue.length &&
      engine.queueIndex >= 0 &&
      queue[engine.queueIndex]?.subsonicTrackId === engineId
        ? engine.queueIndex
        : queue.findIndex((t) => t.subsonicTrackId === engineId);
    if (idx >= 0) return { action: "snap", index: idx, clearPending };
    // Foreign playback: a track this surface doesn't have (failed replace,
    // removed track, another controller). Neutral so the bar can't mislabel
    // it; the display queue stays — it is still ours.
    return { action: "neutral", keepFrom: 0, clearPending: true };
  }

  // Engine idle — nothing loaded.
  if (shownIndex < 0) return { action: "hold", clearPending };
  if (settling) return { action: "hold", clearPending: false };
  if (idlePolls < IDLE_POLLS_TO_TRUST) return { action: "hold", clearPending };
  // The mirror names a track the engine no longer has. Whatever the engine
  // consumed leaves the mirror; anything queued past it (enqueue is display-
  // only until the next Play — BUG-334) survives as the local builder.
  return { action: "neutral", keepFrom: shownIndex + 1, clearPending: true };
}

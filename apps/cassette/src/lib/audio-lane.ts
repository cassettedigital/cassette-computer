/**
 * Audio lane arbitration — one sound at a time on the web.
 *
 * Three things on this site can make a noise: the hub transport (owned music,
 * played by the Mac engine), the preview booth (YouTube, on screen), and radio
 * (a live stream in the page). None of them know about each other, and they
 * mount in different layouts, so they talk through one window event: a lane
 * announces when it STARTS, and every other lane stops itself on hearing it.
 * No lane ever stops another directly; each owns its own silence.
 */

export type AudioLane = "hub" | "booth" | "radio";

const EVENT = "cassette:audio-lane";

export function announceAudioLane(lane: AudioLane): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ lane: AudioLane }>(EVENT, { detail: { lane } }));
}

/** Subscribe to other lanes starting. Returns the unsubscribe. */
export function onOtherAudioLane(self: AudioLane, cb: (lane: AudioLane) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const lane = (e as CustomEvent<{ lane: AudioLane }>).detail?.lane;
    if (lane && lane !== self) cb(lane);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

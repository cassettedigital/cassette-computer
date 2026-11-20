"use client";

import { PlayButton, type PlayState } from "@/app/_taste/PlayButton";
import { useRadio } from "@/app/components/radio/RadioProvider";

/**
 * Tune in: the one key that starts a station. It is the standard play button (PlayButton, data-give="play"), the
 * one every action row starts music with (the founder, 2026-11-19), so in a row it gives way as theirs does ("Tune
 * in", then its glyph). Connecting reads as the
 * button's loading, playing as its Playing with the pause glyph (press again to stop); a stream that would not open
 * says Try again.
 */
export function RadioTuneInKey({ slug }: { slug: string }) {
  const radio = useRadio();
  const current = radio.station?.slug === slug && radio.status !== "idle";
  const state: PlayState = !current || radio.status === "error" ? "idle" : radio.status === "connecting" ? "loading" : radio.status === "playing" ? "playing" : "paused";
  const onClick = () => {
    if (current && radio.status === "error") radio.play(slug);
    else radio.toggle(slug);
  };
  return (
    <PlayButton
      state={state}
      verb={current && radio.status === "error" ? "Try again" : "Tune in"}
      aria-pressed={current}
      onClick={onClick}
    />
  );
}

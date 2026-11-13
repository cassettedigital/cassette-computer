/**
 * The play button (P3), drawn the same wherever a page starts music: the filled Button with the play
 * glyph and one line, just its verb ("Preview Radiohead", "Preview album"), cut short with an ellipsis
 * when it runs long. No song's name under it (the founder, 2026-10-21: the album's "Hear it / Paranoid
 * Android" was copy over copy). Playing (or loading) shows the pause glyph and "Playing"; paused shows
 * the play glyph and "Paused". It only draws: the page wires it to its player and says what state that
 * player is in for this button's music. Lists keep the playing Bars instead (a row is an indicator, a
 * button is a control).
 */

import type { ComponentPropsWithRef } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import b from "./button.module.css";

/** This button's music, as the player sees it: not docked, or docked and loading, playing or paused. */
export type PlayState = "idle" | "loading" | "playing" | "paused";

export function PlayButton({
  state,
  verb,
  ...rest
}: Omit<ComponentPropsWithRef<"button">, "children"> & {
  state: PlayState;
  /** The words while nothing of this is docked: "Preview album", "Preview Radiohead". */
  verb: string;
}) {
  const moving = state === "playing" || state === "loading";
  const word = state === "idle" ? verb : state === "paused" ? "Paused" : "Playing";
  return (
    <Button look="filled" icon={<Icon name={moving ? "pause" : "play"} size={14} />} data-live={state === "playing" || undefined} {...rest}>
      <span className={b.one}>{word}</span>
    </Button>
  );
}

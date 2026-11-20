/**
 * The play button (P3), drawn the same wherever a page starts music: the filled Button with the play
 * glyph and one line, just its verb ("Preview Radiohead", "Preview album"), cut short with an ellipsis
 * when it runs long. No song's name under it (the founder, 2026-10-21: the album's "Hear it / Paranoid
 * Android" was copy over copy). Playing (or loading) shows the pause glyph and "Playing"; paused shows
 * the play glyph and "Paused". It only draws: the page wires it to its player and says what state that
 * player is in for this button's music. Lists keep the playing Bars instead (a row is an indicator, a
 * button is a control). In a row of buttons (ActionRow) it is the first to give way when the row is short
 * of room: its `short` word ("Preview"), then its glyph alone (row-fit.ts); its label still says what it does.
 * `round` draws it as that glyph alone from the start, the Button's round key at the button's height, for a place
 * whose words already say what it plays (a Discover shelf's name); it still needs an aria-label.
 */

import type { ComponentPropsWithRef } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Say } from "./Say";

/** This button's music, as the player sees it: not docked, or docked and loading, playing or paused. */
export type PlayState = "idle" | "loading" | "playing" | "paused";

export function PlayButton({
  state,
  verb,
  short,
  round,
  ...rest
}: Omit<ComponentPropsWithRef<"button">, "children"> & {
  state: PlayState;
  /** The words while nothing of this is docked: "Preview album", "Preview Radiohead". */
  verb: string;
  /** The verb's short form for a row with little room: "Preview". */
  short?: string;
  /** The glyph alone, a round key at the button's height (no words, so an aria-label is a must). */
  round?: boolean;
}) {
  const moving = state === "playing" || state === "loading";
  const word = state === "idle" ? verb : state === "paused" ? "Paused" : "Playing";
  return (
    <Button
      look="filled"
      round={round}
      icon={<Icon name={moving ? "pause" : "play"} size={14} />}
      data-live={state === "playing" || undefined}
      data-give={round ? undefined : "play"}
      {...rest}
    >
      {!round && <Say whole={word} short={state === "idle" ? short : undefined} />}
    </Button>
  );
}

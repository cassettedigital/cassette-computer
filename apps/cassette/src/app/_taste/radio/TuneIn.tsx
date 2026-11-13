"use client";

/**
 * Tune in: the one key that starts a station, drawn as the kit's play button (the filled pill with the
 * play glyph, as everywhere a page starts music). Its word follows the station: Tune in, then
 * Connecting, then Tuned in with the stop glyph lit in the one orange while it plays (press again to
 * stop), or Try again when the stream would not open.
 */

import { Button } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import b from "@/app/_taste/button.module.css";
import { useRadio } from "@/app/components/radio/RadioProvider";

export function RadioTuneInKey({ slug }: { slug: string }) {
  const radio = useRadio();
  const current = radio.station?.slug === slug && radio.status !== "idle";
  const playing = current && radio.status === "playing";
  const label = !current
    ? "Tune in"
    : radio.status === "connecting"
      ? "Connecting"
      : radio.status === "error"
        ? "Try again"
        : "Tuned in";
  const onClick = () => {
    if (current && radio.status === "error") radio.play(slug);
    else radio.toggle(slug);
  };
  return (
    <Button
      look="filled"
      icon={<Icon name={playing ? "stop" : "play"} size={14} />}
      data-live={playing || undefined}
      aria-pressed={current}
      onClick={onClick}
    >
      <span className={b.one}>{label}</span>
    </Button>
  );
}

"use client";

/**
 * Move or copy the music you add (the founder, 2026-11-06). The desktop app asks the first time anyone adds music
 * and keeps the answer on this computer (lib/library-ingest savedAddMode); this is where it changes. Only the app
 * can move a file, so the setting shows only there.
 */

import { useEffect, useState } from "react";
import { Toggle } from "@discovery/cassette-kit";
import { saveAddMode, savedAddMode, type AddMode } from "@/lib/library-ingest";
import { inDesktopApp } from "@/lib/open-outside";
import { Setting } from "@/app/settings/_parts/parts";

export function AddMusicToggle() {
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<AddMode | null>(null);
  useEffect(() => {
    setShown(inDesktopApp());
    setMode(savedAddMode());
  }, []);
  if (!shown) return null;

  const line =
    mode === "move"
      ? "Music you add moves into the Cassette folder inside Music."
      : mode === "copy"
        ? "Music you add is copied into the Cassette folder inside Music, and the originals stay where they are."
        : "Cassette asks the first time you add music.";

  return (
    <Setting
      name="Move music you add"
      about={line}
      end={
        <Toggle
          on={mode === "move"}
          label="Move music you add"
          onChange={(on) => {
            const next: AddMode = on ? "move" : "copy";
            saveAddMode(next);
            setMode(next);
          }}
        />
      }
    />
  );
}

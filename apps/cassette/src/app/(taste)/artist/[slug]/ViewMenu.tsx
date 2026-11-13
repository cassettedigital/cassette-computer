"use client";

/**
 * The records list's view options: the shared menu, its trigger a small line of text with a chevron right after
 * the head's text, on the head's baseline: the sort ("Newest first"). What is showing is said there only when it
 * is not the default, the albums, so the common case is the sort alone. The key names it for the ear in full
 * ("View options: Albums, newest first"). Two radio groups, Sort and Show; the current choice of each is
 * a lit row. The keyboard is the shared menu's (the arrow keys move, Home and End jump, Enter or Space
 * picks, Escape and Tab close, and focus comes back to the key). On opening the focus lands on the
 * choice that is on. Picking closes the menu.
 */

import { Menu, MenuGroup, MenuRadio } from "@/app/_taste/Menu";
import { DEFAULT_VIEW, SHOW_LABEL, SORT_LABEL } from "../_lib/rules";
import type { RecordShow, RecordSort } from "../_lib/types";

type View = { sort: RecordSort; show: RecordShow };

const checkedItem = (list: HTMLElement[]) => list.find((x) => x.getAttribute("aria-checked") === "true");

export function ViewMenu({ view, shows, onChange }: { view: View; shows: RecordShow[]; onChange: (v: View) => void }) {
  const summary = `${shows.length ? `${SHOW_LABEL[view.show]}, ` : ""}${SORT_LABEL[view.sort].toLowerCase()}`;
  // what is showing, as the text of the key: the sort, and the kind of record only when it is not the albums
  const shown = `${shows.length && view.show !== DEFAULT_VIEW.show ? `${SHOW_LABEL[view.show]} · ` : ""}${SORT_LABEL[view.sort]}`;
  return (
    <Menu
      trigger="text"
      align="start"
      label="View options"
      title={shown}
      buttonLabel={`View options: ${summary}`}
      focusOnOpen={checkedItem}
    >
      <MenuGroup label="Sort">
        {(["newest", "oldest"] as const).map((x) => (
          <MenuRadio key={x} checked={view.sort === x} onPick={() => onChange({ ...view, sort: x })}>
            {SORT_LABEL[x]}
          </MenuRadio>
        ))}
      </MenuGroup>
      {shows.length > 0 && (
        <MenuGroup label="Show">
          {shows.map((x) => (
            <MenuRadio key={x} checked={view.show === x} onPick={() => onChange({ ...view, show: x })}>
              {SHOW_LABEL[x]}
            </MenuRadio>
          ))}
        </MenuGroup>
      )}
    </Menu>
  );
}

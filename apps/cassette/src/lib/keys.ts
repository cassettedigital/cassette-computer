/**
 * Whose key is it: the player's shortcuts, or whatever has the focus (BUG-603, BUG-604).
 *
 * Typing always keeps its keys: Space types a space, Cmd-arrows move the cursor to the line's ends. A
 * control keeps Space only when the keyboard brought the focus there (Tab, the arrows, Full Keyboard
 * Access), which is how a Mac and a screen reader press a button. A control that merely kept the focus
 * after a click (Chrome does that; the Mac's web view doesn't) leaves Space to play and pause, the
 * convention the shell settled on in August (bf7224e3), so Space after clicking Shuffle pauses rather
 * than shuffling again. An open menu owns Space however it was opened.
 *
 * Only native controls count: an ARIA role="button" (dnd-kit's draggable rows) may not press on Space
 * at all, and Space there should still play.
 */

const FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='searchbox'], [role='combobox']";
const CONTROL = "button, a[href], summary";
const MENU = "[role^='menuitem'], [role='option']";

/** True when a key press lands in something you type into. */
export function inField(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.(FIELD);
}

let keyed = false;
let keyboardFocus = false;
let watching = false;

/** Start noting how the focus arrives, once per page; the key handlers call it as they mount. */
export function watchFocusArrival(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Tab" || e.key.startsWith("Arrow")) keyed = true;
  }, true);
  window.addEventListener("pointerdown", () => {
    keyed = false;
  }, true);
  window.addEventListener("focusin", () => {
    keyboardFocus = keyed;
  }, true);
}

/** True when Space belongs to whatever has the focus rather than to play / pause. */
export function spaceIsTheFocus(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el?.closest) return false;
  if (inField(el) || el.closest(MENU)) return true;
  return keyboardFocus && !!el.closest(CONTROL);
}

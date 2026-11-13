/**
 * A yes/no question and a plain notice that work in the Mac app as well as in a browser (BUG-602).
 *
 * The app's dialog plugin (tauri-plugin-dialog 2.7) swaps window.confirm for an async function that
 * calls a `confirm` command the plugin no longer has, so in the app a bare `if (!window.confirm(...))`
 * shows no box at all, reads the Promise it gets back as a yes, and goes ahead (Delete album moved files
 * to the Trash unasked). Its window.alert swap needs a permission the app never granted, so it showed
 * nothing either. In the app these two go to the Mac's own alert through the plugin's `message` command
 * (the capability grants `dialog:allow-message`); in a browser, to window.confirm / window.alert.
 *
 * Anything that goes wrong in the app reads as a no, so nothing destructive runs without a yes. Every
 * yes/no in the web app comes through here; ask.test.ts fails on a bare window.confirm or window.alert.
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** The desktop shell's bridge, or null in a browser. */
function shellInvoke(): Invoke | null {
  const tauri = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__;
  return tauri?.core?.invoke ?? null;
}

/**
 * Ask before doing something. `ok` names the button that goes ahead ("Delete", "Retry"); the browser's
 * own box can't be relabelled, so there it stays OK / Cancel. True only on a clear yes.
 */
export async function askToConfirm(message: string, opts: { ok?: string; cancel?: string } = {}): Promise<boolean> {
  const invoke = shellInvoke();
  if (!invoke) return window.confirm(message);
  const ok = opts.ok ?? "OK";
  try {
    const answer = await invoke<string>("plugin:dialog|message", {
      message,
      kind: "warning",
      buttons: { OkCancelCustom: [ok, opts.cancel ?? "Cancel"] },
    });
    // the plugin hands back the pressed button's label (its own confirm compares the same way)
    return answer === ok || answer === "Ok";
  } catch {
    return false;
  }
}

/** Tell the person something that needs no answer. */
export async function tell(message: string): Promise<void> {
  const invoke = shellInvoke();
  if (!invoke) return window.alert(message);
  try {
    await invoke("plugin:dialog|message", { message, kind: "info" });
  } catch {
    // nothing left to show it with
  }
}

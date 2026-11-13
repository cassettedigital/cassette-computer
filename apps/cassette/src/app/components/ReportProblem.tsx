"use client";

/**
 * ReportProblem — the web's in-app note to the founder ("Send me a note"; it was "Report a problem").
 *
 * LOOK (founder, 2026-11-09): the player kit's own Dialog, in the founder's voice, asking for ideas as much as
 * bugs, since a first note is what opens a member's friend invites (account/invites). Wrapped in the kit's tokens
 * (`kit.kit kit.follow`, a `display: contents` box) because it is mounted once in the root layout, outside any
 * window, and the kit's dialog draws from those tokens; it follows the reader's light or dark as the windows do.
 *
 * A free-text message POSTed to the diagnostics spine as report_type='user_feedback'
 * via submitWebFeedback (NOT as a synthetic error — so it never shows the admin a
 * bogus crash summary and groups by its message). Manual feedback always sends; it
 * ignores the account diagnostics opt-out.
 *
 * SCREENSHOT: an OPTIONAL, user-chosen image (Add a screenshot). We deliberately do
 * NOT auto-capture the page: html2canvas can't parse the app's OKLCH colors, so it
 * failed silently (the modal would flash bigger, then the control vanished). A file
 * the user picks is reliable and rides the two-step presigned R2 attachment flow.
 *
 * TRIGGER: renders no launcher of its own. It opens INSTANTLY on the global
 * `cassette:report-problem` event (dispatched by the help dock). Mounted once in the
 * root layout so the event reaches it from anywhere.
 *
 * SENDING: it waits for the note to be stored before saying thanks, and says so
 * plainly if it didn't get there, keeping what they wrote. Closing without
 * sending keeps the draft too (an Escape or a stray click outside shouldn't throw
 * away a paragraph); only a sent note starts the box over.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Dialog, Key, Note, tokens as kit } from "@discovery/cassette-kit";
import { submitWebFeedback } from "@/lib/diagnostics/web-report";
import styles from "./ReportProblem.module.css";

/** Any surface can open the feedback modal by dispatching this on `window`. */
export const OPEN_REPORT_PROBLEM_EVENT = "cassette:report-problem";

/** Dispatched on `window` once a note has been stored, so a surface waiting on a first note (the account window's
 *  Invite friends) can look again. */
export const REPORT_SENT_EVENT = "cassette:report-sent";

const MAX_SHOT_BYTES = 8 * 1024 * 1024; // 8 MB — a screenshot, not a video.

export function ReportProblem() {
  const messageId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // the "Thanks" pause before the box closes itself, so a close or a reopen can cancel it
  const closing = useRef<number | null>(null);
  // a sent note starts the box over next time; an unsent draft stays
  const sentRef = useRef(false);

  const stopClosing = useCallback(() => {
    if (closing.current) window.clearTimeout(closing.current);
    closing.current = null;
  }, []);

  function clearShot() {
    setShot(null);
    setShotUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function reset() {
    sentRef.current = false;
    setMessage("");
    setSent(false);
    setError("");
    setSending(false);
    clearShot();
  }

  // Open instantly on the global event. No capture, no delay. A note that went out last time starts fresh; a draft
  // that was closed without sending is still there.
  useEffect(() => {
    const onOpenEvent = () => {
      stopClosing();
      if (sentRef.current) reset();
      setError("");
      setOpen(true);
    };
    window.addEventListener(OPEN_REPORT_PROBLEM_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener(OPEN_REPORT_PROBLEM_EVENT, onOpenEvent);
      stopClosing();
    };
    // reset/clearShot are stable enough here; deps intentionally [].
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      stopClosing();
      if (sentRef.current) reset();
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn’t an image. Pick a PNG or JPEG.");
      return;
    }
    if (file.size > MAX_SHOT_BYTES) {
      setError("That image is over 8 MB. Try a smaller screenshot.");
      return;
    }
    setError("");
    setShot(file);
    setShotUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  async function submit(close: () => void) {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Add a short description first.");
      return;
    }
    setSending(true);
    setError("");
    const stored = await submitWebFeedback(trimmed, { source: "feedback-form", screenshot: shot });
    if (!stored) {
      setSending(false);
      setError("That didn’t send. Check your connection and try again. Your note is still here.");
      return;
    }
    sentRef.current = true;
    setSending(false);
    setSent(true);
    window.dispatchEvent(new Event(REPORT_SENT_EVENT));
    stopClosing();
    closing.current = window.setTimeout(() => {
      closing.current = null;
      close();
    }, 1400);
  }

  const close = () => onOpenChange(false);

  return (
    <div className={`${kit.kit} ${kit.follow} ${styles.tokens}`}>
      <Dialog open={open} onClose={close} title="Send me a note" line="A bug, a gripe or an idea. It comes straight to me." width={480}>
        {sent ? (
          <p className={styles.sent} role="status">
            Thanks. Got it.
          </p>
        ) : (
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={messageId}>
                What&apos;s on your mind?
              </label>
              <textarea
                id={messageId}
                className={styles.area}
                rows={4}
                maxLength={4000}
                autoFocus
                placeholder="The album page went blank after I hit play. Or: I wish I could mark a record as lent out."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error) setError("");
                }}
              />
            </div>

            <div className={styles.shotRow}>
              {shotUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shotUrl} alt="Screenshot to attach" className={styles.thumb} />
                  <span className={styles.shotName}>{shot?.name ?? "Screenshot attached"}</span>
                  <Key tone="plain" onClick={clearShot}>
                    Remove
                  </Key>
                </>
              ) : (
                <>
                  <Key onClick={() => fileRef.current?.click()}>Add a screenshot</Key>
                  <Note as="span">Optional, and handy for anything that looks wrong.</Note>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={onPickFile} hidden />
            </div>

            {error ? <Note tone="danger">{error}</Note> : null}

            <div className={styles.actions}>
              <Key tone="plain" onClick={close} disabled={sending}>
                Cancel
              </Key>
              <Key tone="fill" onClick={() => void submit(close)} disabled={sending}>
                {sending ? "Sending…" : "Send"}
              </Key>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

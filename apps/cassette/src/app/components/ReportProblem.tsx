"use client";

/**
 * ReportProblem — the web's in-app note to the founder ("Send me a note"; it was "Report a problem").
 *
 * LOOK (founder, 2026-11-09): the player kit's own Dialog, in the founder's voice, asking for ideas as much as
 * bugs, since a first note is what opens a member's friend invites (account/invites). Wrapped in the kit's tokens
 * (`kit.kit`, a `display: contents` box) because it is mounted once in the root layout, outside any window, and
 * the kit's dialog draws from those tokens.
 *
 * DARK ON EVERY PAPER (founder, 2026-11-20): the masthead and its menus are near-black on light and dark pages
 * alike, and most pages stay dark, so a box that followed the device opened cream over a dark page. It is the
 * site's chrome, so it takes the kit's dark everywhere (no `kit.follow`), as the corner key does.
 *
 * WORDS (founder, 2026-11-20): only what a person needs to read. People know how to fill in a feedback form, and
 * every extra line asks them to read it. So: the title, the placeholder ("A bug, a gripe or an idea"), and the
 * screenshot key, whose "Something look wrong?" is a tooltip, not a line. No subtitle, no field label (the
 * textarea is named for screen readers), and errors say what happened, not what is obvious.
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
 * Feedback door's event (components/feedback-door: the corner key, every account
 * menu, the help dock and Invite friends all open it through openFeedback).
 * Mounted once in the root layout so the event reaches it from anywhere.
 *
 * SENDING: it waits for the note to be stored before saying thanks, and says so
 * plainly if it didn't get there, keeping what they wrote. Closing without
 * sending keeps the draft too (an Escape or a stray click outside shouldn't throw
 * away a paragraph); only a sent note starts the box over.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, Key, Note, tokens as kit } from "@discovery/cassette-kit";
import { submitWebFeedback } from "@/lib/diagnostics/web-report";
import { OPEN_FEEDBACK_EVENT } from "./feedback-door";
import styles from "./ReportProblem.module.css";


/** Dispatched on `window` once a note has been stored, so a surface waiting on a first note (the account window's
 *  Invite friends) can look again. */
export const REPORT_SENT_EVENT = "cassette:report-sent";

const MAX_SHOT_BYTES = 8 * 1024 * 1024; // 8 MB — a screenshot, not a video.

export function ReportProblem() {
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
    window.addEventListener(OPEN_FEEDBACK_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener(OPEN_FEEDBACK_EVENT, onOpenEvent);
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
      setError("That image is over 8 MB.");
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
      setError("Write something first.");
      return;
    }
    setSending(true);
    setError("");
    const stored = await submitWebFeedback(trimmed, { source: "feedback-form", screenshot: shot });
    if (!stored) {
      setSending(false);
      setError("That didn’t send. Try again.");
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
    <div className={`${kit.kit} ${styles.tokens}`}>
      <Dialog open={open} onClose={close} title="Send me a note" width={480}>
        {sent ? (
          <p className={styles.sent} role="status">
            Thanks. Got it.
          </p>
        ) : (
          <div className={styles.form}>
            <textarea
              className={styles.area}
              aria-label="Your note"
              rows={4}
              maxLength={4000}
              autoFocus
              placeholder="A bug, a gripe or an idea"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (error) setError("");
              }}
            />

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
                <Key onClick={() => fileRef.current?.click()} title="Something look wrong?">
                  Add a screenshot
                </Key>
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

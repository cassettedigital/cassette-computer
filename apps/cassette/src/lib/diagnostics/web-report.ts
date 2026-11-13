import { isCrawlerUserAgent } from "./crawler";
/**
 * Spine-only web error reporting (Option A: one backbone, no Sentry).
 *
 * Web runtime errors POST to the SAME /api/diagnostics/reports endpoint as
 * native iOS/Android/desktop crashes, so every platform's errors land together
 * in /admin/diagnostics. This is the browser half — it uses localStorage (the
 * anonymous install_id), navigator (os hints), and fetch with `keepalive` so a
 * report still flushes even if the crash immediately unloads the page.
 *
 * The functions are safe to import from a server module (WEB_APP_VERSION is a
 * plain constant); the browser-only paths are guarded by `typeof window`.
 * reportWebError is fire-and-forget and NEVER throws — a failing reporter must
 * not turn one error into two.
 *
 * CONSENT (Feature A): the account-level diagnostics opt-out rides the same
 * cross-device rails as the appearance theme. The root layout injects the signed
 * -in user's choice as `window.__cassetteDiag = { consent }` (default true;
 * anonymous is always-on). The flag gates AUTO reports only
 * (unhandled_error / crash / hang) — a user's MANUAL `user_feedback` is
 * user-initiated and ALWAYS sends, regardless of the flag.
 */

const INSTALL_ID_KEY = "cassette_install_id";

/** SSR-injected diagnostics config the root layout writes before first paint. */
declare global {
  interface Window {
    __cassetteDiag?: { consent?: boolean };
  }
}

/**
 * Required by the spine envelope. On Vercel, NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA is
 * auto-exposed, so prod reports carry the deploy's commit. Override with an
 * explicit NEXT_PUBLIC_APP_VERSION if you want a friendlier version string.
 */
export const WEB_APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ??
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
  "web-dev";

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Anonymous, client-persistent correlation id. NOT identity — just a stable
 *  handle so multiple reports from one browser group together and rate-limit. */
export function getWebInstallId(): string {
  if (typeof window === "undefined") return "web-ssr";
  try {
    let id = window.localStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = newUuid();
      window.localStorage.setItem(INSTALL_ID_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage disabled — a per-session id is still useful.
    return "web-nostorage";
  }
}

/**
 * The signed-in user's diagnostics opt-out, read from the SSR-injected global.
 * Defaults to TRUE (opt-out model): anonymous clients and any client that hasn't
 * received the global are always-on. Only an explicit `false` disables AUTO
 * reporting.
 */
export function webDiagnosticsConsent(): boolean {
  if (typeof window === "undefined") return true;
  return window.__cassetteDiag?.consent !== false;
}

/**
 * Whether this build should ship AUTO error reports to the spine at all. A real
 * deploy carries a Vercel commit sha (WEB_APP_VERSION !== "web-dev"); a dev/local
 * build falls back to "web-dev". We refuse to report from dev/local so the PRODUCTION
 * bug server isn't flooded with things no real user hits: Next HMR quirks
 * (mini-css-extract-plugin removeChild), and half-saved-file ReferenceErrors while a
 * component is mid-edit. Localhost is refused as belt-and-suspenders, except in the
 * Cassette app's own build: its window is served from its local server, and its
 * reports reach the cloud through the app's API proxy (next.config.ts stamps that
 * build desktop-<version>; BUG-658). Only AUTO reports are gated: manual user
 * feedback is user-initiated and always sends.
 */
function isReportableEnvironment(): boolean {
  if (WEB_APP_VERSION === "web-dev") return false;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const local =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local");
    if (local && !WEB_APP_VERSION.startsWith("desktop")) return false;
  }
  return true;
}

/** A dynamic-import / chunk-load failure — the "stale client after a deploy" classic:
 *  the browser holds an old chunk manifest and asks for a hash the new build dropped. */
function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null | undefined;
  if (!e) return false;
  if (e.name === "ChunkLoadError") return true;
  const msg = e.message ?? "";
  return (
    /Loading (?:CSS )?chunk [\w-]+ failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

let chunkReloadedThisLoad = false;

/**
 * Recover from a chunk-load failure by reloading ONCE to pick up the current deploy's
 * manifest, then swallow it — it's expected deploy churn, not a bug. Returns true when
 * handled so the caller skips reporting.
 *
 * Runs before the diagnostics opt-out so even an opted-out user gets the recovery
 * (a reload is UX, not telemetry). Only reloads a real deploy — in dev/local a chunk
 * error is the developer's problem, so we swallow without yanking their page. If a
 * chunk error RECURS after the one reload, we stop reloading and return false so it
 * DOES report: a reload didn't fix it, so it's a real problem, not just a stale client.
 */
function handledChunkLoadError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  if (!isReportableEnvironment()) return true; // dev/local: swallow, don't reload, don't report
  const KEY = "cassette_chunk_reloaded";
  try {
    if (window.sessionStorage.getItem(KEY)) return false; // already reloaded & it recurred → report
    window.sessionStorage.setItem(KEY, "1");
    window.location.reload();
    return true;
  } catch {
    // Private mode / storage disabled — fall back to a per-page-load guard.
    if (chunkReloadedThisLoad) return false;
    chunkReloadedThisLoad = true;
    try {
      window.location.reload();
    } catch {
      /* ignore */
    }
    return true;
  }
}

type WebReportOptions = {
  /** Which boundary/handler caught it — becomes the report's `component`. */
  source?: string;
  /** React error-boundary componentStack, if available. */
  componentStack?: string;
};

type FeedbackOptions = {
  /** Which surface sent it — becomes the report's `component`. */
  source?: string;
  /** An optional image the user chose to attach, via the two-step R2 flow. */
  screenshot?: Blob | null;
};

type AttachmentUpload = {
  slot: string;
  r2Key: string;
  presignedUrl: string;
  expiresAt: string;
};

/**
 * Upload a declared attachment to R2 (leg 2 of the two-step flow) and flip its
 * row 'pending' → 'stored'. Best-effort: any failure is swallowed so a missing
 * screenshot never turns feedback into an error.
 */
async function uploadAttachment(
  reportId: string,
  idempotencyKey: string,
  installId: string,
  upload: AttachmentUpload,
  blob: Blob,
  contentType: string
): Promise<void> {
  try {
    const put = await fetch(upload.presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!put.ok) return;
    await fetch(
      `/api/diagnostics/reports/${reportId}/attachments/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          install_id: installId,
          slot: upload.slot,
          byte_size: blob.size,
        }),
      }
    ).catch(() => {});
  } catch {
    // swallow — a failed sidecar upload must not surface
  }
}

/**
 * POST a built envelope to the spine. With NO screenshot it is fire-and-forget
 * (keepalive so a crash still flushes across an unload). WITH a screenshot it
 * awaits the response to drive the two-step R2 upload. Never throws.
 */
function postReport(
  envelope: Record<string, unknown>,
  idempotencyKey: string,
  installId: string,
  screenshot: Blob | null,
  contentType = "image/png"
): void {
  if (!screenshot) {
    void fetch("/api/diagnostics/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      keepalive: true,
    }).catch(() => {
      // swallow — the reporter must never surface its own failure
    });
    return;
  }

  void (async () => {
    try {
      const res = await fetch("/api/diagnostics/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as {
        id?: string;
        attachmentUploads?: AttachmentUpload[];
      } | null;
      if (!data?.id || !Array.isArray(data.attachmentUploads)) return;
      const shot = data.attachmentUploads.find((u) => u.slot === "screenshot");
      if (shot) {
        await uploadAttachment(data.id, idempotencyKey, installId, shot, screenshot, contentType);
      }
    } catch {
      // swallow — a failed upload must not surface its own error
    }
  })();
}

/**
 * Report an unhandled WEB error to the spine (window.onerror, unhandledrejection,
 * error boundaries). AUTO reports honor the account diagnostics opt-out. Carries
 * the error's name/message/stack as crash_summary so it fingerprints and
 * de-minifies like a native crash. Fire-and-forget; never throws.
 */
export function reportWebError(error: unknown, opts: WebReportOptions = {}): void {
  if (typeof window === "undefined") return;
  try {
    if (handledChunkLoadError(error)) return;
    if (!webDiagnosticsConsent()) return;
    if (!isReportableEnvironment()) return;
    // BUG-309: a crawler or headless browser running our JS is not a person hitting a bug.
    if (isCrawlerUserAgent(navigator.userAgent)) return;

    const err = error instanceof Error ? error : new Error(String(error));
    const stack = (err.stack ?? "").split("\n").slice(0, 30).join("\n");
    const digest = (error as { digest?: string } | null)?.digest;
    const idempotencyKey = newUuid();
    const installId = getWebInstallId();

    const envelope = {
      schema_version: 1,
      idempotency_key: idempotencyKey,
      report_type: "unhandled_error",
      platform: "web",
      component: opts.source,
      app_version: WEB_APP_VERSION,
      os_name: navigator.platform || undefined,
      install_id: installId,
      occurred_at: new Date().toISOString(),
      severity: "error",
      title: `${err.name}: ${err.message}`.slice(0, 300),
      context: {
        url: window.location.href,
        referrer: document.referrer || undefined,
        component_stack: opts.componentStack
          ? opts.componentStack.split("\n").slice(0, 20).join("\n")
          : undefined,
        digest,
      },
      crash_summary: { name: err.name, message: err.message, stack },
      consent: {
        user_consented: false,
        upload_enabled: true,
        contains_pii: false,
        redacted: false,
      },
      client_meta: {
        user_agent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
      },
    };

    postReport(envelope, idempotencyKey, installId, null);
  } catch {
    // never throw from the reporter
  }
}

/**
 * Submit MANUAL user feedback to the SAME spine, as report_type='user_feedback'.
 *
 * Feedback is NOT an error, so it deliberately carries NO synthetic stack or
 * crash_summary: it rides severity 'info', its title is the message, and it
 * fingerprints on that message (so distinct feedback stays distinct, and the
 * admin never shows it a bogus "crash summary" or call-site stack). Always
 * sends, since it is user-initiated — the diagnostics opt-out never gates it. An
 * optional user-chosen screenshot rides the two-step R2 attachment flow.
 *
 * Unlike an automatic report, a note is awaited: it resolves true once the report
 * is stored (the screenshot, if any, keeps uploading after), and false if it
 * didn't get there, so the note box only says thanks for a note that landed and
 * the account window's Invite friends can look the moment it has. Never throws.
 */
export async function submitWebFeedback(userMessage: string, opts: FeedbackOptions = {}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const message = userMessage.trim();
    if (!message) return false;

    const idempotencyKey = newUuid();
    const installId = getWebInstallId();
    const screenshot = opts.screenshot && opts.screenshot.size > 0 ? opts.screenshot : null;
    const contentType = screenshot?.type || "image/png";

    const envelope = {
      schema_version: 1,
      idempotency_key: idempotencyKey,
      report_type: "user_feedback",
      platform: "web",
      component: opts.source ?? "feedback-form",
      app_version: WEB_APP_VERSION,
      os_name: navigator.platform || undefined,
      install_id: installId,
      occurred_at: new Date().toISOString(),
      severity: "info",
      title: message.slice(0, 140),
      user_message: message,
      context: {
        url: window.location.href,
        referrer: document.referrer || undefined,
      },
      // No crash_summary: feedback is not a crash.
      consent: {
        user_consented: true,
        upload_enabled: true,
        contains_pii: false,
        redacted: false,
      },
      client_meta: {
        user_agent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
      },
      attachments: screenshot
        ? [
            {
              slot: "screenshot" as const,
              kind: "ui-snapshot",
              content_type: contentType,
              byte_size: screenshot.size,
            },
          ]
        : [],
    };

    return await postFeedback(envelope, idempotencyKey, installId, screenshot, contentType);
  } catch {
    // never throw from the reporter
    return false;
  }
}

/** POST a note and wait for the spine to store it: true once it has. A chosen screenshot then uploads on its own,
 *  best-effort, so a slow picture never holds up the thanks. Never throws. */
async function postFeedback(
  envelope: Record<string, unknown>,
  idempotencyKey: string,
  installId: string,
  screenshot: Blob | null,
  contentType: string
): Promise<boolean> {
  try {
    const res = await fetch("/api/diagnostics/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) return false;
    if (screenshot) {
      const data = (await res.json().catch(() => null)) as {
        id?: string;
        attachmentUploads?: AttachmentUpload[];
      } | null;
      const shot = Array.isArray(data?.attachmentUploads)
        ? data.attachmentUploads.find((u) => u.slot === "screenshot")
        : undefined;
      if (data?.id && shot) void uploadAttachment(data.id, idempotencyKey, installId, shot, screenshot, contentType);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Who may talk to the Mac app's local server (BUG-774).
 *
 * In token mode the bundled server on 127.0.0.1:41730 holds the person's device
 * token and fronts their hub, so a request that reaches it can act as them. A
 * browser will happily send one there from any website: a plain form POST, an
 * <img> GET, or (with DNS rebinding) a read whose reply the site gets to see.
 *
 * Only the app's own window should get through, so a request is refused when:
 *  - its Host is not a loopback name (a rebinding site arrives with its own name)
 *  - it carries an Origin that is not this same local origin
 *  - the browser marks it as coming from another site (Sec-Fetch-Site)
 *
 * The app's window loads only http://localhost:41730 (pairing opens the system
 * browser, never the window), so every request it makes passes all three.
 * Pure function over headers so middleware, route handlers and server
 * components can all call it.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostname(hostHeader: string): string {
  // "localhost:41730" → "localhost"; "[::1]:41730" → "[::1]"
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const colon = h.indexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

type HeaderSource = { get(name: string): string | null };

/** Why this request must be refused, or null when it came from the app itself. */
export function localRequestRefusal(
  headers: HeaderSource,
  opts: { checkOrigin?: boolean } = {},
): string | null {
  const host = headers.get("host");
  if (!host || !LOOPBACK_HOSTS.has(hostname(host))) return "host";
  if (opts.checkOrigin === false) return null;

  const origin = headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return "origin"; // "null" (sandboxed frame, file://) and anything unparsable
    }
    if (originHost !== host.trim().toLowerCase()) return "origin";
  }

  const site = headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return "site";
  return null;
}

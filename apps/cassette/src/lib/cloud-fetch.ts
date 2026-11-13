/**
 * A fetch to the cloud that gives up if no answer starts arriving within
 * CLOUD_ANSWER_TIMEOUT_MS (BUG-782). Without it, a captive portal or a dead
 * network left the desktop app's pages waiting for minutes with no word. Only
 * the wait for the response is bounded; a long download that has started is
 * left to finish.
 */
export const CLOUD_ANSWER_TIMEOUT_MS = 15_000;

export async function fetchCloud(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = CLOUD_ANSWER_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

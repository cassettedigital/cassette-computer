/**
 * Windows and Linux draw thick default scroll bars where macOS draws thin overlay ones, so the site
 * asks for thin bars on those two systems only (globals.css, html[data-os]). A rule for everyone would
 * also change what Mac browsers draw. The mark goes on <html> once the page is up. (BUG-239)
 */
export type ScrollbarOs = "win" | "linux";

/** "win" or "linux" for those systems, null for Apple systems, phones and anything unknown. */
export function scrollbarOs(platform: string, userAgent: string): ScrollbarOs | null {
  const text = `${platform} ${userAgent}`;
  // Phones keep their own overlay bars: Android reports "Linux" in its user agent, so rule it out first.
  if (/Android|iPhone|iPad|iPod|Mac/i.test(text)) return null;
  if (/Win/i.test(platform || userAgent)) return "win";
  if (/Linux|X11|CrOS/i.test(text)) return "linux";
  return null;
}

/** Put the system's mark on <html>. Does nothing outside a browser or on a system that keeps its own bars. */
export function markScrollbarOs(): void {
  if (typeof document === "undefined" || typeof navigator === "undefined") return;
  const os = scrollbarOs(navigator.platform || "", navigator.userAgent || "");
  if (os) document.documentElement.setAttribute("data-os", os);
}

/**
 * The Mac app's window runs to its top edge: its title bar is an overlay (the desktop shell's
 * tauri.conf.json, titleBarStyle "Overlay"), so the traffic lights sit over the page and nothing
 * moves the window unless the page says where (data-tauri-drag-region, the shell's drag script).
 *
 * A tiny script in the root layout (DESKTOP_SHELL_SCRIPT) sees the shell before first paint and sets
 * html[data-shell="mac"]. A page that lays out its own top for this (the desk, data-titlebar="own" on
 * its window) gets nothing more. Any other page in the app starts under a strip that holds the lights
 * and moves the window (globals.css, .cs-shell-top in the root layout).
 */

export const DESKTOP_SHELL_SCRIPT =
  'try{if(window.__TAURI__&&/Mac/.test(navigator.platform))document.documentElement.setAttribute("data-shell","mac");}catch(e){}';

/**
 * A link that leaves Cassette opens in the person's browser, never in the app's window: the window has no
 * address bar and no back button, so a press quote or a shop link used to take it over for good (BUG-870).
 * It listens on the window, after every page's own handlers, so a link that already sends itself outside
 * (openOutside, lib/open-outside.ts) has called preventDefault and is left alone. Plain left clicks only,
 * and a download link stays a download.
 */
export const DESKTOP_LINKS_SCRIPT =
  'try{var T=window.__TAURI__;if(T&&T.core&&T.core.invoke)window.addEventListener("click",function(e){if(e.defaultPrevented||e.button!==0)return;var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a||a.hasAttribute("download"))return;var u=new URL(a.href,location.href);if(u.origin===location.origin||!/^(https?|mailto):$/.test(u.protocol))return;e.preventDefault();T.core.invoke("plugin:opener|open_url",{url:u.href});});}catch(e){}';

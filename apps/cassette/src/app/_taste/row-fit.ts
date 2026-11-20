/**
 * How a row of buttons (ActionRow.tsx) fits on one line: the steps it tries, in order, until nothing
 * sticks out past the row's end and no button's words are cut short. Every button says its whole name
 * first. Then a word that only labels a glyph goes (Follow is its plus alone, as it was on a phone beside
 * Preview). Then the play button says "Preview", then it is its glyph alone. Then the names with a short
 * form shorten ("Buy on Barnes & Noble" -> "Buy") and the play button gets its whole name back, then
 * "Preview", then its glyph again. A store's name runs long and says where the money goes, and the play
 * button's glyph says what it does, so Preview gives way before Buy does (the founder, 2026-11-17, of the
 * artist page's record panel). Past the last step the row squeezes: the named buttons shrink, their words
 * cut short with an ellipsis, rather than any button wrapping onto a second line.
 *
 * The row says which step it is on in its own attributes (data-play, data-names, data-words,
 * data-squeeze) and the buttons' CSS answers them (actionrow.module.css); a button joins in with
 * data-give: "play" (the play button), "name" (a name with a short form, Buy), "word" (a word beside a
 * glyph, Follow). A step that only changes a kind of button the row doesn't have is skipped.
 *
 * `fitRow` is self-contained on purpose: layout.tsx defines it on the window before first paint
 * (ROW_FIT_SCRIPT) and each row calls it from a one-line script inside itself as the page is read
 * (ROW_FIT_NOW), so a row is drawn at its step from the first frame and nothing changes when the page's
 * code arrives. No imports, no module values, no syntax that compiles to a helper: its own text is the
 * script. The script also watches the row's size and fits it again on any change, because a page that
 * streams in (one with a loading.tsx) is read inside a hidden box and only then put in place, and a hidden
 * row has no width to fit; a resize is answered before the frame is painted. ActionRow takes over the
 * watching once the page's code runs (a window resized, a font arriving, Preview turning to Playing).
 */
export function fitRow(row: HTMLElement): void {
  // [play, names, words]
  const steps = [
    ["whole", "whole", "whole"],
    ["whole", "whole", "glyph"],
    ["short", "whole", "glyph"],
    ["glyph", "whole", "glyph"],
    ["whole", "short", "glyph"],
    ["short", "short", "glyph"],
    ["glyph", "short", "glyph"],
  ];
  const has = [
    !!row.querySelector('[data-give="play"]'),
    !!row.querySelector('[data-give="name"]'),
    !!row.querySelector('[data-give="word"]'),
  ];
  let last: Element | null = null;
  for (let i = row.children.length - 1; i >= 0; i--) {
    if (row.children[i].tagName !== "SCRIPT") {
      last = row.children[i];
      break;
    }
  }
  const fits = function () {
    if (!last) return true;
    if (last.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5) return false;
    const says = row.querySelectorAll("[data-say]");
    for (let j = 0; j < says.length; j++) if (says[j].scrollWidth > says[j].clientWidth + 1) return false;
    return true;
  };
  const tried: string[] = [];
  row.removeAttribute("data-squeeze");
  for (let s = 0; s < steps.length; s++) {
    // what this step changes for the buttons this row has
    const play = has[0] ? steps[s][0] : "whole";
    const names = has[1] ? steps[s][1] : "whole";
    const words = has[2] ? steps[s][2] : "whole";
    const key = play + names + words;
    if (tried.indexOf(key) >= 0) continue;
    tried.push(key);
    row.setAttribute("data-play", play);
    row.setAttribute("data-names", names);
    row.setAttribute("data-words", words);
    if (fits()) return;
  }
  row.setAttribute("data-squeeze", "");
}

/** The watcher the first-frame script leaves on a row, for ActionRow to stop when it takes over. */
export const ROW_WATCH = "__csRowWatch";

/** For layout.tsx's head, before any row is read: fitRow on the window, and __csRow, which fits a row and
 *  watches it and its buttons for a change of size until the page's code takes over. */
export const ROW_FIT_SCRIPT =
  `window.__csFitRow=${fitRow.toString()};` +
  `window.__csRow=function(r){window.__csFitRow(r);if(!window.ResizeObserver)return;` +
  `var o=new ResizeObserver(function(){window.__csFitRow(r)});o.observe(r);` +
  `for(var i=0;i<r.children.length;i++)o.observe(r.children[i]);r.${ROW_WATCH}=o};`;

/** A row's own call, the last thing inside it: by then its buttons have been read. */
export const ROW_FIT_NOW = "try{window.__csRow(document.currentScript.parentNode)}catch(e){}";

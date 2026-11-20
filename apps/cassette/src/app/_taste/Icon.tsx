/**
 * The taste pages' glyphs, one set at one 2px stroke on a 24 grid (P14), for every UI glyph on the
 * homepage and the new pages: the arrow (a link inside the site), out (an arrow leaning up and out, for a
 * link that leaves it), check, plus, the transport (play, prev, next, pause), close, search, the one
 * chevron, photos (a gallery's count) and sliders (a list's view options); and the homepage's own:
 * folder, code, idea, circleCheck (kept), heart, bag, and expand and collapse (the desktop app coming out
 * of the computer and going back; the dock's video enlarging and coming back); and person, the empty
 * face in the masthead's account key when no one is signed in; and share, an arrow out of a tray, for
 * sending a song. The masthead's places and its menu: compass (Discover), radio (Radio), menu (the two
 * lines on the menu key), book (Journal), signpost (Guides), how (How it works, play in a ring), help,
 * devices (Apps), gear (Settings) and leave (Sign out, an arrow out of a door); and note, a speech bubble, for
 * Feedback wherever its door is (components/feedback-door); sound and muted, a speaker with its waves or crossed out, for
 * a live stream's mute (the radio night's event page); list, three lines with their dots, for a schedule; and
 * loading, three quarters of a ring, which a button turns while it waits (button.module.css, aria-busy).
 * Illustrations (the PSA's wireframes, No catch's device drawings, the computer and the desktop app) are
 * pictures, not glyphs, and keep their own drawing.
 */

export type IconName =
  | "arrow"
  | "out"
  | "check"
  | "plus"
  | "play"
  | "prev"
  | "next"
  | "pause"
  | "stop"
  | "close"
  | "search"
  | "chevron"
  | "photos"
  | "sliders"
  | "folder"
  | "code"
  | "idea"
  | "circleCheck"
  | "heart"
  | "bookmark"
  | "bag"
  | "expand"
  | "collapse"
  | "person"
  | "share"
  | "compass"
  | "radio"
  | "menu"
  | "book"
  | "signpost"
  | "how"
  | "help"
  | "devices"
  | "gear"
  | "leave"
  | "note"
  | "sound"
  | "muted"
  | "list"
  | "loading";

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function Icon({ name, size = 16, className, filled }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
  let body;
  switch (name) {
    case "arrow":
      body = <path d="M5 12h13M13 6.5 18.5 12 13 17.5" {...line} />;
      break;
    case "out":
      body = <path d="M7 17 17 7M8 7h9v9" {...line} />;
      break;
    case "check":
      body = <path d="M5 12.5l4.5 4.5L19 7.5" {...line} />;
      break;
    case "plus":
      body = <path d="M12 5v14M5 12h14" {...line} />;
      break;
    case "play":
      body = <path d="M8 5v14l11-7z" fill="currentColor" />;
      break;
    case "prev":
      body = <path d="M18 6v12l-8.5-6zM7 6h2.2v12H7z" fill="currentColor" />;
      break;
    case "next":
      body = <path d="M6 6v12l8.5-6zM14.8 6H17v12h-2.2z" fill="currentColor" />;
      break;
    case "pause":
      body = <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />;
      break;
    case "stop":
      body = <path d="M6.5 6.5h11v11h-11z" fill="currentColor" />;
      break;
    case "share":
      body = <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8" {...line} />;
      break;
    case "close":
      body = <path d="M6 6l12 12M18 6 6 18" {...line} />;
      break;
    case "search":
      body = (
        <g {...line}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20.5 20.5-4.6-4.6" />
        </g>
      );
      break;
    case "chevron":
      body = <path d="m6 9 6 6 6-6" {...line} />;
      break;
    case "photos":
      body = (
        <g {...line}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 15.5l4.5-4.5 4 4 2.5-2.5 5 5" />
        </g>
      );
      break;
    case "sliders":
      body = (
        <g {...line}>
          <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="17" cy="18" r="2" />
        </g>
      );
      break;
    case "folder":
      body = <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...line} />;
      break;
    case "code":
      body = <path d="m8 7-5 5 5 5M16 7l5 5-5 5" {...line} />;
      break;
    case "idea":
      body = (
        <g {...line}>
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <path d="M9 18h6M10 22h4" />
        </g>
      );
      break;
    case "circleCheck":
      body = (
        <g {...line}>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </g>
      );
      break;
    case "heart":
      body = (
        <path
          d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"
          {...line}
        />
      );
      break;
    case "bookmark":
      // filled when the thing is kept (a saved station), its outline otherwise
      body = <path d="M18 21 12 17 6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5Z" {...line} fill={filled ? "currentColor" : "none"} />;
      break;
    case "bag":
      body = (
        <g {...line}>
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
        </g>
      );
      break;
    case "expand":
      body = <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" {...line} />;
      break;
    case "collapse":
      body = <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" {...line} />;
      break;
    case "person":
      body = (
        <g {...line}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="10" r="3.2" />
          <path d="M6.4 18.6c1.4-2.1 3.3-3.2 5.6-3.2s4.2 1.1 5.6 3.2" />
        </g>
      );
      break;
    case "compass":
      body = (
        <g {...line}>
          <circle cx="12" cy="12" r="10" />
          <path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4Z" />
        </g>
      );
      break;
    case "radio":
      body = (
        <g {...line}>
          <rect x="2.5" y="8" width="19" height="13" rx="3" />
          <circle cx="15.5" cy="14.5" r="2.6" />
          <path d="M6.5 13h3.5M6.5 16h3.5M6.5 8l10-5" />
        </g>
      );
      break;
    case "menu":
      body = <path d="M4.5 9h15M4.5 15h15" {...line} />;
      break;
    case "book":
      body = (
        <g {...line}>
          <path d="M12 6.5C10 5 7 4.5 3 5v13.5c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5Z" />
          <path d="M12 6.5V20" />
        </g>
      );
      break;
    case "signpost":
      body = <path d="M12 2.5v19M5 5h11l3 3-3 3H5zM19 13H8l-3 3 3 3h11z" {...line} />;
      break;
    case "how":
      body = (
        <g {...line}>
          <circle cx="12" cy="12" r="10" />
          <path d="m10 8.5 5.5 3.5-5.5 3.5Z" />
        </g>
      );
      break;
    case "help":
      body = (
        <g {...line}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.4 9.3a2.7 2.7 0 1 1 3.7 2.5c-.7.3-1.1.9-1.1 1.6v.4M12 17.3v.1" />
        </g>
      );
      break;
    case "devices":
      body = (
        <g {...line}>
          <rect x="2" y="5" width="13.5" height="10" rx="1.5" />
          <path d="M1.5 18.5h15" />
          <rect x="17.5" y="9" width="5" height="11" rx="1.2" />
        </g>
      );
      break;
    case "gear":
      body = (
        <g {...line}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
        </g>
      );
      break;
    case "leave":
      body = <path d="M14 3.5h4.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H14M9.5 16.5 14 12 9.5 7.5M14 12H3.5" {...line} />;
      break;
    case "note":
      body = <path d="M12 3a9 9 0 1 1-4.2 16.96L3 21l1.1-4.6A9 9 0 0 1 12 3z" {...line} />;
      break;
    case "sound":
      body = <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.3a8 8 0 0 1 0 11.4" {...line} />;
      break;
    case "muted":
      body = <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9.5l5 5M20.5 9.5l-5 5" {...line} />;
      break;
    case "list":
      body = <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" {...line} />;
      break;
    case "loading":
      body = <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" {...line} />;
      break;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}

/**
 * Who wrote it: hosts, outlet names, which sources are publications, and each outlet's own favicon.
 * Pure. Rules P1 to P3 of the shell spec, plus the review changes: a fan archive that reprints a paper's
 * review (Citizen Insane, greenplastic) is a carrier, never the outlet, and an outlet's icon is looked
 * up by its own home domain when the link sits on someone else's site.
 */

/** The host key the press editor uses (album-taste/a/[slug]/press.ts:109-116). */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|www-s1|amp|m)\./, "");
  } catch {
    return null;
  }
}

/**
 * Country suffixes that take a second label (co.uk, com.au, co.jp, com.sg): the name a site registers sits in front
 * of them, so shop.emp.co.uk belongs to emp.co.uk, never to "co.uk" (BUG-822). Only the ones that carry sites.
 */
const TWO_PART_SUFFIX = new Set([
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
  "co.nz", "org.nz", "net.nz", "ac.nz", "govt.nz",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "co.kr", "or.kr", "ac.kr", "go.kr",
  "com.sg", "edu.sg", "org.sg", "gov.sg",
  "com.hk", "org.hk", "com.tw", "org.tw", "com.cn", "net.cn", "org.cn",
  "co.in", "net.in", "org.in", "co.za", "org.za", "co.il", "org.il", "co.th", "com.my", "com.ph",
  "com.br", "net.br", "org.br", "com.mx", "org.mx", "com.ar", "com.co", "com.pe", "com.tr", "com.mt", "com.pl", "com.ua", "com.ng",
]);

/** The registrable domain: the last two labels, or the last three after a two-part suffix like co.uk. */
export function registrable(host: string | null | undefined): string {
  const h = (host ?? "").toLowerCase().replace(/\.$/, "");
  if (!h) return "";
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const tail = parts.slice(-2).join(".");
  return TWO_PART_SUFFIX.has(tail) ? parts.slice(-3).join(".") : tail;
}

/**
 * Outlets the editor sometimes names only by their address. artist-taste/a/[slug]/gates.ts:9-15, plus
 * every outlet seen on Radiohead's press rows and a few common elsewhere.
 */
export const HOST_LABELS: Record<string, string> = {
  "rollingstone.com": "Rolling Stone", "pitchfork.com": "Pitchfork", "theguardian.com": "The Guardian", "nme.com": "NME",
  "allmusic.com": "AllMusic", "bbc.com": "BBC", "bbc.co.uk": "BBC", "npr.org": "NPR", "nytimes.com": "The New York Times",
  "latimes.com": "Los Angeles Times", "stereogum.com": "Stereogum", "theatlantic.com": "The Atlantic", "newyorker.com": "The New Yorker",
  "ew.com": "Entertainment Weekly", "spin.com": "Spin", "independent.co.uk": "The Independent", "thequietus.com": "The Quietus",
  "consequence.net": "Consequence", "popmatters.com": "PopMatters", "billboard.com": "Billboard", "vulture.com": "Vulture",
  "americansongwriter.com": "American Songwriter", "avclub.com": "The A.V. Club", "blender.com": "Blender",
  "chicagotribune.com": "Chicago Tribune", "clashmusic.com": "Clash", "consequenceofsound.net": "Consequence",
  "digitalspy.com": "Digital Spy", "diymag.com": "DIY", "drownedinsound.com": "Drowned in Sound",
  "entertainment.ie": "Entertainment.ie", "exclaim.ca": "Exclaim!", "faroutmagazine.co.uk": "Far Out",
  "irishtimes.com": "The Irish Times", "loudersound.com": "Louder", "musicomh.com": "musicOMH", "newsweek.com": "Newsweek",
  "nowtoronto.com": "NOW Toronto", "nymag.com": "New York Magazine", "pastemagazine.com": "Paste",
  "pitchforkmedia.com": "Pitchfork", "robertchristgau.com": "Robert Christgau", "salon.com": "Salon",
  "slantmagazine.com": "Slant Magazine", "spinmagazine.com": "Spin", "sputnikmusic.com": "Sputnikmusic",
  "telegraph.co.uk": "The Telegraph", "thecurrent.org": "The Current", "thelineofbestfit.com": "The Line of Best Fit",
  "thetimes.com": "The Times", "thetimes.co.uk": "The Times", "theverge.com": "The Verge", "time.com": "Time",
  "tinymixtapes.com": "Tiny Mix Tapes", "uncut.co.uk": "Uncut", "undertheradarmag.com": "Under the Radar",
  "villagevoice.com": "The Village Voice", "whathifi.com": "What Hi-Fi?",
  "mojo4music.com": "Mojo", "washingtonpost.com": "The Washington Post", "kerrang.com": "Kerrang!",
  "thewire.co.uk": "The Wire", "uproxx.com": "Uproxx",
};

/** Named print sources that arrive without a host. */
export const PRINT_OUTLETS = [
  "Q", "Mojo", "Select", "Melody Maker", "Record Collector", "Classic Rock", "Smash Hits", "Music Week", "Vox", "Kerrang!",
  "The Rolling Stone Album Guide", "Encyclopedia of Popular Music",
];

/** P8: one key per outlet however it is written ("Consequence of Sound" and "Consequence" are one). */
export function outletKey(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
  const ALIAS: Record<string, string> = {
    consequenceofsound: "consequence",
    dailytelegraph: "telegraph",
    slantmagazine: "slant",
    pitchforkmedia: "pitchfork",
  };
  return ALIAS[k] ?? k;
}

const KNOWN_KEYS = new Set([...Object.values(HOST_LABELS), ...PRINT_OUTLETS].map(outletKey));

/**
 * The outlet's own home, for its favicon when the link sits elsewhere (a reprint, a book scan, a grade
 * with no link). HOST_LABELS turned round, plus the print magazines whose sites the icon table holds.
 */
const OUTLET_HOMES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [host, label] of Object.entries(HOST_LABELS)) {
    const k = outletKey(label);
    if (!m[k]) m[k] = host;
  }
  // a label shared by several hosts keeps the outlet's current address
  Object.assign(m, {
    [outletKey("Pitchfork")]: "pitchfork.com",
    [outletKey("Consequence")]: "consequence.net",
    [outletKey("Spin")]: "spin.com",
    [outletKey("The Times")]: "thetimes.com",
    [outletKey("Q")]: "qthemusic.com",
    [outletKey("Mojo")]: "mojo4music.com",
    [outletKey("Uncut")]: "uncut.co.uk",
    [outletKey("Kerrang!")]: "kerrang.com",
    [outletKey("Record Collector")]: "recordcollectormag.com",
    [outletKey("Music Week")]: "musicweek.com",
    [outletKey("Chicago Sun-Times")]: "suntimes.com",
    [outletKey("Calgary Herald")]: "calgaryherald.com",
  });
  // never another outlet's mark: Louder is Classic Rock's carrier, not Classic Rock
  return m;
})();

/** The outlet's own home domain, or null when we do not know it. */
export const homeOf = (name: string): string | null => OUTLET_HOMES[outletKey(name)] ?? null;

/**
 * P3: the display name. A real name the editor gave is kept as written; a name that is only the
 * address squashed ("Irishtimes", "Pitchforkmedia") becomes the outlet we know at that address, or
 * null when we do not know it (a personal site: refused).
 */
export function outletName(name: string, host: string, names: OutletNames = {}, url: string | null = null): string | null {
  const h = (host ?? "").toLowerCase();
  const r = registrable(h);
  const fixed = NAME_FIXES[h.replace(/^www\./, "")] ?? NAME_FIXES[r];
  if (fixed) return fixed;
  const given = (name ?? "").trim();
  // a stored name with junk round it ("| ocolly.com", "// MELODIC Magazine", "You Are A Ranker ✰✰✰✰✰",
  // "Metal Express ..."): the table's sure name for the address, else the name cleaned
  if (GARBLED.test(given)) {
    const named = names[h.replace(/^www\./, "")] ?? names[r];
    if (named && named.sure && PRESS_KINDS.has(named.kind)) return named.name;
  }
  const n = GARBLED.test(given) ? cleanName(given) : given;
  const stem = r.split(".")[0] ?? "";
  const squashed =
    !n || n.toLowerCase() === h || n.toLowerCase() === r || (/^[A-Z][a-z0-9]+$/.test(n) && n.toLowerCase() === stem) || addressFragment(n, h, url);
  if (!squashed) return n;
  const named = names[h.replace(/^www\./, "")] ?? names[r];
  const label = HOST_LABELS[h] ?? HOST_LABELS[r] ?? (named && PRESS_KINDS.has(named.kind) ? named.name : null);
  return label && !addressFragment(label, h, url) ? label : null;
}

/** Universities, colleges, libraries and governments: their address names the institution, not the paper or station. */
const INSTITUTION = /(^|\.)(edu|gov|mil|(ac|edu|gov)\.[a-z]{2})$/i;
/** Three labels make the institution under a country's own ac, edu or gov suffix (unsw.edu.au, u-tokyo.ac.jp). */
const COUNTRY_INSTITUTION = /\.(ac|edu|gov)\.[a-z]{2}$/i;
/** A personal page on a university or internet provider's server ("/~jh2054/", "%7Ejh2054", also inside a Wayback
 *  address), read from the address's path only, never its query or fragment. */
const PERSONAL_PAGE = /\/(~|%7e)[^/]/i;
/** Internet providers' and free servers that give a person a page without a "~" in the address (users.rcn.com/...,
 *  somebody.sdf.org, beatles.ncf.ca): the provider and the account's own name are never the outlet (BUG-822). */
const PERSONAL_HOSTING = /(^|\.)(users\.rcn\.com|sdf\.org|ncf\.ca)$/i;
/** The second label of a country's own suffixes (israelhayom.co.il, newbery.gen.nz, sd61.bc.ca): never a name. */
const SUFFIX_LABELS = new Set(["co", "com", "net", "org", "gen", "ne", "or", "go", "gov", "ac", "edu", "mil", "bc", "on", "qc", "ab", "nsw", "vic", "qld"]);
const squash = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * BUG-822: a stored name that is only a piece of the address, in any case: a piece of its suffix on any host ("COM",
 * "CO", "GOV"), or of an institution's or a personal page's address ("UNL", "HW", "MIT", "UNSW", "Uni Regensburg",
 * "wesman"), which is the university, library or provider, never the outlet. Only the institution's own label counts,
 * so a college station named by its call letters (kzsu.stanford.edu) keeps its name.
 */
function addressFragment(name: string, host: string, url: string | null): boolean {
  const n = squash(name);
  const labels = host.toLowerCase().replace(/^\.+|\.+$/g, "").split(".");
  if (!n || labels.length < 2) return false;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  if (n === tld || (tld.length === 2 && labels.length >= 3 && SUFFIX_LABELS.has(sld) && n === sld)) return true;
  const personalHosting = PERSONAL_HOSTING.test(host);
  if (!INSTITUTION.test(host) && !personalHosting && !PERSONAL_PAGE.test((url ?? "").split(/[?#]/)[0])) return false;
  const own = personalHosting ? labels : COUNTRY_INSTITUTION.test(host) ? labels.slice(-3) : registrable(host).split(".");
  return own.some((label) => squash(label) === n);
}

/**
 * BUG-822: outlets whose stored name came out wrong, named by hand (one outlet per address, checked
 * 2026-11-04 in the pre-submission audit of wave 1). Takes precedence over whatever the editor stored.
 */
const NAME_FIXES: Record<string, string> = {
  "live4ever.uk.com": "Live4ever", // stored as "UK"
  "getreadytorock.me.uk": "Get Ready to ROCK!", // "RadioGet Ready to ROCK!", "BlogGet Ready to ROCK!", "-Get Ready to ROCK!"
  "mg.co.za": "Mail & Guardian", // "MG"
  "nj.com": "NJ.com", // "NJ"
  "independent.com.mt": "The Malta Independent", // "COM"
  "fredric.co.uk": "God Is in the TV", // "Fredric": the site's old address (fredric.co.uk/giittv)
  "oudaily.com": "The Oklahoma Daily", // "| oudaily.com"
  "wallofsound.go.com": "Wall of Sound", // "GO": ABC's music site, read through the Wayback Machine
  "abcnews.go.com": "ABC News", // "GO"
  "al.com": "AL.com", // "AL"
};

/** A stored name with junk round it: leading pipes, slashes or dashes, star glyphs, a trailing "»" or ellipsis. */
const GARBLED = /^[\s|/\\·•»–—-]|[✰★☆✩✪⭐]|\s»|\s*(?:\.\.\.|…)$|-$/;
const cleanName = (n: string): string =>
  n
    .replace(/[✰★☆✩✪⭐]+/g, "")
    .replace(/\s+».*$/, "")
    .replace(/^[\s|/\\·•»–—-]+|[\s–—-]+$/g, "")
    .replace(/\s*(?:\.\.\.|…)$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * BUG-769: the outlet-name table (src/lib/press-outlet-names.json, scripts/name-press-outlets.ts) names
 * the outlets the editor could only store as an address, and sorts out the hosts that are not press.
 * The server passes it in, so the table never ships to the browser with this module.
 */
export type OutletNames = Record<string, { name: string; kind: string; sure?: boolean }>;
const PRESS_KINDS = new Set(["publication", "blog"]);
const NOT_PRESS_KINDS = new Set(["shop", "label", "reader-site", "archive", "artist-site"]);

/** P10 and P12: an outlet we know by name or address, as opposed to a fan site or archive. */
export function isKnownOutlet(name: string, host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase();
  if (h && (HOST_LABELS[h] || HOST_LABELS[registrable(h)])) return true;
  return KNOWN_KEYS.has(outletKey(name));
}

/* ── P2: not a publication ── */

const NON_PUBLICATION =
  /(^|\.)(news\.ycombinator\.com|reddit\.com|redd\.it|quora\.com|record\.club|blogspot\.[a-z.]+|wordpress\.com|tumblr\.com|medium\.com|substack\.com|livejournal\.com|weebly\.com|wixsite\.com|bandcamp\.com|discogs\.com|last\.fm|lastfm\.[a-z.]+|deezer\.com|amazon\.[a-z.]+)$/i;
const DISCUSSION_SUBDOMAIN = /^(forum|forums|community|boards|discuss|discussion)\./i;

/* BUG-822: shops, labels, distributors and document dumps the editor took for press (found in the pre-submission
 * audit of wave 1 and its review, 2026-11-04) are whole sites in the outlet-name table (kind shop, label or archive),
 * which the editor reads too. Sites that also publish real criticism are refused by page in SHOP_PAGES. */

/** Sites with both: refused only on their shop and catalogue pages (Forced Exposure's Features are Byron
 *  Coley's reviews, Presto's articles are its own criticism). */
const SHOP_PAGES: Array<[host: string, path: RegExp]> = [
  ["forcedexposure.com", /^\/(catalog|artists)\//i],
  ["prestomusic.com", /^\/[a-z-]+\/products\//i],
  ["roughtrade.com", /^\/([a-z]{2}(-[a-z]{2})?\/)?product\//i],
  ["numerogroup.com", /^\/products\//i],
  ["flyingnun.co.nz", /^\/products\//i],
];

/** BUG-822: a shop or catalogue page on a site that also publishes criticism. */
export function isShopPage(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  return SHOP_PAGES.some(([host, path]) => (h === host || h.endsWith(`.${host}`)) && path.test(u.pathname));
}

/**
 * Is this address, or the site it sits under, in the set? The site is the registrable domain, so a page on
 * shop.emp.co.uk is found by "emp.co.uk" and never by "co.uk". The press editor (scripts/hobby-press.ts) reads its
 * host lists through this, so the editor and the page look a host up the same way (BUG-822).
 */
export function hostInSet(set: ReadonlySet<string>, host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase().replace(/^www\./, "");
  return !!h && (set.has(h) || set.has(registrable(h)));
}

/**
 * What the outlet-name table says a host is when it is not press (a shop, a label, a reader-review site, an archive of
 * other outlets' pieces, an artist's own site), found by its address and then by its registrable domain; else null.
 * The page and the press editor both ask this (BUG-769, BUG-822).
 */
export function notPressKind(host: string | null | undefined, names: OutletNames = {}): string | null {
  const h = (host ?? "").toLowerCase().replace(/^www\./, "");
  if (!h) return null;
  const kind = (names[h] ?? names[registrable(h)])?.kind;
  return kind && NOT_PRESS_KINDS.has(kind) ? kind : null;
}

/** Forums, Hacker News, Reddit, personal blogs, user-review sites, and the hosts the product never uses. */
export function isNonPublicationHost(host: string | null | undefined, names: OutletNames = {}): boolean {
  const h = (host ?? "").toLowerCase().replace(/^www\./, "");
  if (!h) return false;
  // a shop, a label, a reader-review site or an archive of other outlets' pieces (BUG-769)
  if (notPressKind(h, names)) return true;
  return NON_PUBLICATION.test(h) || DISCUSSION_SUBDOMAIN.test(h);
}

/* ── P1: aggregators (album-taste/a/[slug]/press.ts:149-157, hosts mirroring scripts/hobby-press.ts) ── */

const AGGREGATOR_HOSTS = new Set([
  "metacritic.com", "anydecentmusic.com", "albumoftheyear.org", "rateyourmusic.com", "acclaimedmusic.net", "besteveralbums.com",
]);
const AGGREGATOR_NAMES = /^(metacritic|any\s?decent\s?music\??|album\s?of\s?the\s?year(\.org)?|rate\s?your\s?music|acclaimed\s?music|best\s?ever\s?albums)$/i;

export function isAggregator(name: string, host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase();
  return AGGREGATOR_HOSTS.has(h) || AGGREGATOR_HOSTS.has(registrable(h)) || AGGREGATOR_NAMES.test((name ?? "").trim());
}

/* ── carriers: sites that hold someone else's words ── */

/** Archives, book scans and fan sites. Their favicon is never the outlet's mark. */
const CARRIER = /(^|\.)(google\.[a-z.]+|archive\.org|youtube\.com|youtu\.be|worldradiohistory\.com|highbeam\.com|followmearound\.com|greenplastic\.com|citizeninsane\.eu)$/;
export const isCarrierHost = (host: string | null | undefined): boolean => !!host && CARRIER.test(host.toLowerCase());

/** Citizen Insane files each reprint under /media/<country>/<paper>/. Only the papers we can name. */
const CITIZEN_INSANE_PAPERS: Record<string, string> = {
  nme: "NME", times: "The Times", sundaytimes: "The Sunday Times", q: "Q", select: "Select", mojo: "Mojo",
  mm: "Melody Maker", melodymaker: "Melody Maker", guardian: "The Guardian", observer: "The Observer",
  independent: "The Independent", telegraph: "The Telegraph", vox: "Vox", uncut: "Uncut", kerrang: "Kerrang!",
  rollingstone: "Rolling Stone", spin: "Spin",
};

/**
 * A reprint on a fan archive, read back to the paper it ran in: on citizeninsane.eu the outlet comes
 * from the path and the year from its "pt_YYYY-" stamp. `outlet: null` means the archive holds it but
 * we cannot say which paper ran it (refused). Null for any other site.
 */
export function reprintOf(url: string | null | undefined): { outlet: string | null; year: string | null } | null {
  const host = hostOf(url);
  if (!host || registrable(host) !== "citizeninsane.eu") return null;
  let path = "";
  try {
    path = new URL(url as string).pathname.toLowerCase();
  } catch {
    return { outlet: null, year: null };
  }
  const seg = /\/media\/[a-z]{2}\/([a-z0-9_-]+)\//.exec(path)?.[1] ?? "";
  const year = /pt_(\d{4})-/.exec(path)?.[1] ?? null;
  return { outlet: CITIZEN_INSANE_PAPERS[seg.replace(/[-_]/g, "")] ?? null, year };
}

/**
 * The outlet's favicon. Never a carrier's (Google Books' G, the Wayback Machine, a fan site), never
 * another outlet's (The Observer on theguardian.com, Classic Rock on loudersound.com): those fall back
 * to the outlet's own home when the icon table holds it, else null (the page prints a monogram).
 */
export function iconFor(host: string | null | undefined, name: string, icons: Record<string, string>): string | null {
  const home = homeOf(name);
  const own = home ? (icons[home] ?? icons[registrable(home)] ?? null) : null;
  const h = (host ?? "").toLowerCase();
  if (!h) return own;
  const r = registrable(h);
  if (isCarrierHost(h) || isCarrierHost(r)) return own;
  const label = HOST_LABELS[h] ?? HOST_LABELS[r];
  if (label && outletKey(label) !== outletKey(name)) return own;
  return icons[h] ?? icons[r] ?? own;
}

/* ── the order the critics strip shows outlets in (album-taste/a/[slug]/press.ts:65-72) ── */

export const OUTLET_ORDER = [
  "pitchfork", "rolling stone", "the guardian", "nme", "mojo", "q", "uncut", "allmusic",
  "entertainment weekly", "the independent", "spin", "the times", "the observer", "clash", "the quietus",
];
export const outletRank = (name: string): number => {
  const i = OUTLET_ORDER.indexOf(name.trim().toLowerCase());
  return i === -1 ? OUTLET_ORDER.length : i;
};

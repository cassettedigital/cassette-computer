/**
 * Profile avatar catalog + wire helpers.
 *
 * Storage:
 *   - users.image          — photo URL when the person uploaded (or Google set) one
 *   - users.avatar_preset  — silhouette | initials | emoji:<char>
 *
 * Display priority: photo URL if present, else the preset. Picking a preset
 * clears the photo; uploading a photo keeps the preset as the fallback if they
 * later clear it.
 *
 * Defaults are emoji (founder call, 2026-07-27) plus the plain silhouette and
 * initials. Human-presenting emoji that support Fitzpatrick skin tones expose
 * a tone picker in the account UI; the chosen tone is stored as its own preset
 * id (e.g. emoji:🧙 / emoji:🧙🏻).
 */

export type AvatarPresetId = string;

export type AvatarPresetDef = {
  id: AvatarPresetId;
  name: string;
  /** Emoji glyph when this is an emoji preset; null for silhouette / initials. */
  emoji: string | null;
  /** True when this emoji accepts Fitzpatrick skin-tone modifiers. */
  toneable?: boolean;
};

/** Fitzpatrick modifiers + default (no modifier). */
export const SKIN_TONES: readonly { id: string; label: string; modifier: string }[] = [
  { id: "default", label: "Default", modifier: "" },
  { id: "1", label: "Light", modifier: "\u{1F3FB}" },
  { id: "2", label: "Medium-light", modifier: "\u{1F3FC}" },
  { id: "3", label: "Medium", modifier: "\u{1F3FD}" },
  { id: "4", label: "Medium-dark", modifier: "\u{1F3FE}" },
  { id: "5", label: "Dark", modifier: "\u{1F3FF}" },
] as const;

/** Base emoji chips offered in the picker (tone variants are derived). */
const EMOJI_BASE: readonly { name: string; emoji: string; toneable?: boolean }[] = [
  { name: "Alien", emoji: "👾" },
  { name: "Mic", emoji: "🎙️" },
  { name: "Guitar", emoji: "🎸" },
  { name: "Headphones", emoji: "🎧" },
  { name: "Skull", emoji: "☠️" },
  { name: "Black heart", emoji: "🖤" },
  { name: "Red heart", emoji: "❤️" },
  { name: "Mage", emoji: "🧙", toneable: true },
  { name: "Dino", emoji: "🦕" },
  { name: "Unicorn", emoji: "🦄" },
  { name: "Rainbow", emoji: "🌈" },
  { name: "Beach", emoji: "🏖️" },
];

function emojiId(emoji: string): AvatarPresetId {
  return `emoji:${emoji}`;
}

export const AVATAR_PRESETS: readonly AvatarPresetDef[] = [
  { id: "silhouette", name: "Silhouette", emoji: null },
  { id: "initials", name: "Initials", emoji: null },
  ...EMOJI_BASE.map((e) => ({
    id: emojiId(e.emoji),
    name: e.name,
    emoji: e.emoji,
    toneable: e.toneable,
  })),
];

export const DEFAULT_AVATAR_PRESET: AvatarPresetId = "silhouette";

/** Legacy color-disc ids from the first ship — map them to silhouette. */
const LEGACY_COLOR_PRESETS = new Set([
  "ember",
  "moss",
  "marine",
  "violet",
  "rose",
]);

export function isValidAvatarPreset(v: unknown): v is AvatarPresetId {
  if (typeof v !== "string" || !v) return false;
  if (v === "silhouette" || v === "initials") return true;
  if (LEGACY_COLOR_PRESETS.has(v)) return false;
  if (!v.startsWith("emoji:")) return false;
  const glyph = v.slice("emoji:".length);
  return glyph.length > 0;
}

export function coerceAvatarPreset(v: unknown): AvatarPresetId {
  if (typeof v === "string" && isValidAvatarPreset(v)) return v;
  return DEFAULT_AVATAR_PRESET;
}

export function avatarPresetDef(id: AvatarPresetId): AvatarPresetDef {
  const found = AVATAR_PRESETS.find((p) => p.id === id);
  if (found) return found;
  // Tone variant (e.g. emoji:🧙🏻) — synthesize a def from the glyph.
  if (id.startsWith("emoji:")) {
    const emoji = id.slice("emoji:".length);
    return { id, name: "Emoji", emoji };
  }
  return AVATAR_PRESETS[0]!;
}

export function presetEmoji(id: AvatarPresetId): string | null {
  return avatarPresetDef(id).emoji;
}

/** Base (untoned) preset id for a toneable emoji, or null. */
export function toneableBaseId(id: AvatarPresetId): AvatarPresetId | null {
  const def = avatarPresetDef(id);
  if (!def.emoji) return null;
  // Strip Fitzpatrick modifier to find the base chip.
  const baseGlyph = [...def.emoji].filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp < 0x1f3fb || cp > 0x1f3ff;
  }).join("");
  const base = AVATAR_PRESETS.find((p) => p.emoji === baseGlyph && p.toneable);
  return base?.id ?? null;
}

/** Build the preset id for a toneable base + skin tone. */
export function tonedPresetId(baseId: AvatarPresetId, toneId: string): AvatarPresetId {
  const base = avatarPresetDef(baseId);
  if (!base.emoji || !base.toneable) return baseId;
  const tone = SKIN_TONES.find((t) => t.id === toneId) ?? SKIN_TONES[0]!;
  return emojiId(base.emoji + tone.modifier);
}

/** Which skin-tone id is currently selected for a toneable preset. */
export function currentToneId(id: AvatarPresetId): string {
  const def = avatarPresetDef(id);
  if (!def.emoji) return "default";
  for (const t of SKIN_TONES) {
    if (!t.modifier) continue;
    if (def.emoji.includes(t.modifier)) return t.id;
  }
  return "default";
}

/** First 1–2 characters of a display name / email for the initials disc. */
export function avatarInitials(name: string | null | undefined, email?: string | null): string {
  const raw = (name?.trim() || email?.trim() || "?").slice(0, 2).toUpperCase();
  return raw || "?";
}

/** Resolved display kind for any surface. Photo wins over preset. */
export type ResolvedAvatar =
  | { kind: "photo"; url: string }
  | { kind: "preset"; preset: AvatarPresetId };

export function resolveAvatar(
  image: string | null | undefined,
  preset: string | null | undefined
): ResolvedAvatar {
  const url = typeof image === "string" ? image.trim() : "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return { kind: "photo", url };
  }
  return { kind: "preset", preset: coerceAvatarPreset(preset) };
}

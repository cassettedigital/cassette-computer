/**
 * An outlet's monogram, for an outlet with no favicon: its first letter after a leading "The " (the
 * September page, preview/hobby/[slug]/page.tsx:372-375). Pure, so the album page's tested helpers
 * (shape.ts) can hand it on unchanged.
 */
export const monogram = (name: string): string => name.replace(/^the\s+/i, "").charAt(0).toUpperCase() || "·";

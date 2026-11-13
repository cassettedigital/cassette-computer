/**
 * The media bucket's r2.dev development address: every stored cover and artist photo URL uses it, and
 * the site swaps it for media.cassette.digital when it renders (image-url.ts, BUG-430). Writers that
 * store a new R2 address keep this form, and check the bucket they write to is this one, or the swap
 * never happens for what they wrote (scripts/lib/cover-r2.ts).
 *
 * No imports, so scripts can use it without the app's module chain.
 */
export const R2_DEV_MEDIA = "https://pub-1de521a89e3a4d0eb77cf2557bbd8818.r2.dev/";

/**
 * The uploads bucket's r2.dev development address (people's avatars, playlist covers, cover and photo
 * picks, creator uploads). The bucket has no custom domain (Cloudflare, read 2026-11-04), so this is the
 * only public address its pictures have; the image ladder's edge resizer reads the bucket directly and
 * serves them as bucket `u` (docs/CASSETTE_IMAGE_LADDER_PLAN.md).
 */
export const R2_DEV_UPLOADS = "https://pub-57f787c42a8f47b88360d2c7098e4e52.r2.dev/";

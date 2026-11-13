/**
 * @discovery/storage
 *
 * S3-compatible object storage client for Cloudflare R2 (and other providers).
 * Provides client creation, file upload, and signed URL generation.
 */

export { createStorageClient } from "./client";
export { uploadToStorage } from "./upload";
export { downloadFromStorage } from "./download";
export { createSignedDownloadUrl, createSignedUploadUrl } from "./signed-urls";
export type { SignedUploadOptions } from "./signed-urls";
export { getImageUrl } from "./image-url";
export type { StorageConfig, UploadOptions } from "./types";
export type { ImageTransformOptions } from "./image-url";

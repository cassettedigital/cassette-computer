/** Configuration for an S3-compatible object storage backend (e.g. Cloudflare R2). */
export interface StorageConfig {
  /** Cloud provider account ID (used for R2 endpoint construction) */
  accountId: string;
  /** S3 access key ID */
  accessKeyId: string;
  /** S3 secret access key */
  secretAccessKey: string;
  /** Bucket name */
  bucketName: string;
  /** Public URL prefix for generating public links */
  publicUrl: string;
}

/** Options for an upload operation. */
export interface UploadOptions {
  /** MIME type (default: "application/octet-stream") */
  contentType?: string;
  /** Cache-Control header */
  cacheControl?: string;
}

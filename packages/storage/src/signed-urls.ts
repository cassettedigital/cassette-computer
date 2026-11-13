import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Generate a time-limited signed download URL for an object in S3/R2.
 *
 * @param client - S3Client instance from createStorageClient()
 * @param bucket - Bucket name
 * @param key - Object key
 * @param expiresInSeconds - URL lifetime in seconds (default: 7 days)
 * @returns Signed URL string
 */
export async function createSignedDownloadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresInSeconds: number = 7 * 24 * 60 * 60
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/** What else a presigned PUT is bound to. */
export interface SignedUploadOptions {
  /** Bind the PUT to this many bytes: content-length becomes a signed header, so a different size fails the signature. */
  contentLength?: number;
  /**
   * Bind the PUT to its Content-Type (the default). The presigner leaves content-type out of the signed headers
   * unless told otherwise, so unbound, the type is only what the client chooses to send and the bucket stores
   * and serves it as that (BUG-935). `false` only where a stored type is never served and the uploaders are
   * apps already installed (the problem reports' private bucket, see api/diagnostics/reports).
   */
  signContentType?: boolean;
}

/**
 * Generate a time-limited presigned PUT URL for direct browser-to-R2 uploads.
 *
 * The client uploads directly using this URL — the file never passes through
 * the API server, bypassing Vercel's 4.5MB body limit for large audio files.
 *
 * The signature covers the host and the Content-Type, so the client must send exactly `contentType` (a PUT
 * of any other type fails); the size is bound too when `contentLength` is given, and then the client must
 * send exactly that many bytes.
 *
 * @param client - S3Client instance from createStorageClient()
 * @param bucket - Bucket name
 * @param key - Object key (must be a UUID-based path, never user-supplied)
 * @param contentType - Expected MIME type
 * @param expiresInSeconds - URL lifetime in seconds (default: 15 minutes)
 * @param options - Bind the PUT to its declared size and type (see SignedUploadOptions)
 * @returns Presigned PUT URL string
 */
export async function createSignedUploadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  expiresInSeconds: number = 15 * 60,
  options: SignedUploadOptions = {}
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...(options.contentLength !== undefined ? { ContentLength: options.contentLength } : {}),
  });
  return getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
    ...(options.signContentType !== false ? { signableHeaders: new Set(["content-type"]) } : {}),
  });
}

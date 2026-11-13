import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { UploadOptions } from "./types";

/**
 * Upload a file to S3-compatible object storage.
 *
 * @param client - S3Client instance from createStorageClient()
 * @param bucketName - Target bucket
 * @param key - Object key (path within the bucket)
 * @param body - File content
 * @param publicUrl - Public URL prefix for generating the result URL
 * @param options - Content type, cache control, etc.
 * @returns The public URL of the uploaded file
 */
export async function uploadToStorage(
  client: S3Client,
  bucketName: string,
  key: string,
  body: Buffer | Uint8Array,
  publicUrl: string,
  options?: UploadOptions
): Promise<{ url: string }> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: options?.contentType ?? "application/octet-stream",
      ...(options?.cacheControl && { CacheControl: options.cacheControl }),
    })
  );

  const baseUrl = publicUrl.replace(/\/$/, "");
  return { url: `${baseUrl}/${key}` };
}

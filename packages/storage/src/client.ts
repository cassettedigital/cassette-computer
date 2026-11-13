import { S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "./types";

/**
 * Create an S3-compatible storage client.
 *
 * Works with Cloudflare R2, AWS S3, MinIO, and other S3-compatible providers.
 * For R2, the endpoint is automatically constructed from the accountId.
 */
export function createStorageClient(config: StorageConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

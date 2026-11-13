import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/**
 * Download an object from S3/R2 as a Buffer.
 *
 * @returns The object body as a Buffer, or null if not found / error.
 */
export async function downloadFromStorage(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer | null> {
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchKey") return null;
    throw err;
  }
}

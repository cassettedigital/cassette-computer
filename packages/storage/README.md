# @discovery/storage

S3-compatible object storage client for Cloudflare R2 (and other S3-compatible providers). Provides client creation and file upload with configurable key patterns.

## Public API

```typescript
function createStorageClient(config: StorageConfig): S3Client
function uploadToStorage(client, bucketName, key, body, publicUrl, options?): Promise<{ url: string }>

interface StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}
```

## Usage

```typescript
import { createStorageClient, uploadToStorage } from "@discovery/storage";

const client = createStorageClient({
  accountId: process.env.R2_ACCOUNT_ID!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucketName: "media",
  publicUrl: "https://cdn.example.com",
});

const { url } = await uploadToStorage(
  client, "media", "wonderlit/cards/abc.png", pngBuffer, "https://cdn.example.com",
  { contentType: "image/png", cacheControl: "public, max-age=31536000" }
);
```

## Dependencies

`@aws-sdk/client-s3`

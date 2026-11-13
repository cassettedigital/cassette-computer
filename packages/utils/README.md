# @discovery/utils

Generic utility functions shared across all discovery platform apps. Zero dependencies — pure TypeScript.

## Public API

```typescript
function sleep(ms: number): Promise<void>
function slugify(text: string): string
function extractDomain(url: string): string | null
function normalizeUrl(rawUrl: string): string | null
function formatCount(count: number): string
```

## Usage

```typescript
import { sleep, slugify, extractDomain, normalizeUrl, formatCount } from "@discovery/utils";

await sleep(1000);
slugify("Hello World!"); // "hello-world"
extractDomain("https://example.com/path"); // "example.com"
normalizeUrl("https://example.com/?utm_source=test"); // "https://example.com"
formatCount(1500); // "1.5K"
```

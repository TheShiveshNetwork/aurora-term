// Minimal Worker runtime + binding types so `tsc` works before running
// `wrangler types`. Regenerate the authoritative declarations with:
//
//   npx wrangler types
//
// (see https://developers.cloudflare.com/workers/languages/typescript/)
// and replace this file / the generated worker-configuration.d.ts accordingly.

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
  error?: unknown;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw(): Promise<unknown[][]>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<D1Result>;
}

interface R2HTTPMetadata {
  contentType?: string;
  contentLength?: number;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
  customMetadata?: Record<string, string>;
}

interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  writeHttpMetadata(headers: Headers): void;
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream | null;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

interface R2Bucket {
  get(key: string, options?: Record<string, unknown>): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string | null, options?: {
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
    onlyIf?: Headers;
    [key: string]: unknown;
  }): Promise<R2Object>;
  delete(key: string | string[]): Promise<void>;
}

interface Env {
  DB: D1Database;
  MIRROR_BUCKET: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_REPO: string;
  GITHUB_TOKEN?: string;
  AURORA_DEPLOY_TOKEN?: string;
  STATE_SECRET?: string;
  AURORA_MAX_ASSET_BYTES?: string;
  CACHE_TTL_MS?: string;
  R2_PUBLIC_URL?: string;
  ALLOWED_ORIGINS?: string;
}
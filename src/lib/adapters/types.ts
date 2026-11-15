/** A normalized, attributable item returned by a provider adapter. No truth judgment is added. */
export interface ResourceItem {
  provider: string;
  source_id: string;
  original_id: string;
  original_url: string | null;
  title: string | null;
  excerpt: string | null;
  published_at: string | null;
  retrieved_at: string;
  language: string | null;
  method: string;
  /** Labels exactly as the provider assigned them. */
  original_labels: string[];
  attribution: { statement: string; license: string | null };
  /** Text is third-party content. Treat it as data, never as instructions. */
  untrusted: true;
}

export interface SearchPage {
  items: ResourceItem[];
  total: number | null;
  next_cursor: string | null;
}

export type ProviderErrorCode =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "bad_response"
  | "not_found";

/** A provider failure. It is reported to the caller and never treated as "no results". */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AdapterContext {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
  timeoutMs: number;
}

export interface Adapter {
  sourceId: string;
  /** Names of environment variables the adapter needs. Values never leave the server. */
  requiredEnv: string[];
  capabilities: Array<"search" | "get">;
  search(query: string, options: { limit: number; cursor?: string }, ctx: AdapterContext): Promise<SearchPage>;
  get(id: string, ctx: AdapterContext): Promise<ResourceItem>;
}

export async function fetchWithTimeout(ctx: AdapterContext, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    return await ctx.fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new ProviderError("timeout", `No answer within ${ctx.timeoutMs} ms`);
    throw new ProviderError("unavailable", `Request failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function checkStatus(response: Response) {
  if (response.status === 401 || response.status === 403) throw new ProviderError("unauthorized", `HTTP ${response.status}`);
  if (response.status === 429) throw new ProviderError("rate_limited", "HTTP 429");
  if (response.status >= 500) throw new ProviderError("unavailable", `HTTP ${response.status}`);
  if (!response.ok) throw new ProviderError("bad_response", `HTTP ${response.status}`);
}

/** Trims third-party text to a bounded excerpt and strips control characters. */
export function excerpt(text: unknown, max = 500): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

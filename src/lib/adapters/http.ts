import { type AdapterContext, ProviderError, checkStatus, fetchWithTimeout, safeUrl } from "@/lib/adapters/types";

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

/** Checks a caller-supplied URL before this server fetches it or sends it to a provider. */
export function publicHttpsUrl(value: string): URL {
  const href = safeUrl(value);
  if (!href) throw new ProviderError("bad_response", "The URL must be an http(s) URL");
  const url = new URL(href);
  if (url.protocol !== "https:") throw new ProviderError("bad_response", "Only https URLs are accepted");
  if (PRIVATE_HOST.test(url.hostname) || /^\d+$/.test(url.hostname)) {
    throw new ProviderError("bad_response", "Private, local or numeric hosts are not accepted");
  }
  if (url.username || url.password) throw new ProviderError("bad_response", "URLs with credentials are not accepted");
  return url;
}

/** Downloads public media for providers that only accept uploads. Bounded in size and type. */
export async function fetchMedia(
  ctx: AdapterContext,
  value: string,
  options: { maxBytes: number; types: RegExp },
): Promise<{ blob: Blob; fileName: string; contentType: string }> {
  const url = publicHttpsUrl(value);
  const response = await fetchWithTimeout(ctx, url.toString(), { redirect: "error" });
  checkStatus(response);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!options.types.test(contentType)) throw new ProviderError("bad_response", `Unsupported media type '${contentType || "unknown"}'`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > options.maxBytes) throw new ProviderError("bad_response", `Media is larger than ${options.maxBytes} bytes`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > options.maxBytes) throw new ProviderError("bad_response", `Media is larger than ${options.maxBytes} bytes`);
  const fileName = url.pathname.split("/").filter(Boolean).at(-1) ?? "media";
  return { blob: new Blob([buffer], { type: contentType }), fileName, contentType };
}

/** Polls until done() returns a value or the poll budget runs out (then returns null). */
export async function poll<T>(
  ctx: AdapterContext,
  check: () => Promise<T | null>,
  intervalMs = 2000,
): Promise<T | null> {
  const budget = ctx.pollBudgetMs ?? 20_000;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    const result = await check();
    if (result !== null) return result;
    if (Date.now() - started + intervalMs > budget || attempt > 60) return null;
    await sleep(intervalMs);
  }
}

export function numbers(record: Record<string, unknown>, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) out[`${prefix}${key}`] = value;
  }
  return out;
}

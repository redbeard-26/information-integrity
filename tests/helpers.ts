import type { AdapterContext } from "@/lib/adapters/types";

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export function ctx(fetchImpl: FetchImpl, env: Record<string, string> = {}): AdapterContext {
  return { fetch: fetchImpl as typeof fetch, env, now: () => new Date("2026-11-15T00:00:00Z"), timeoutMs: 50, sleep: async () => {}, pollBudgetMs: 10_000 };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function text(body: string, type = "application/xml", status = 200) {
  return new Response(body, { status, headers: { "content-type": type } });
}

/** Routes requests by URL substring; unknown URLs fail the test. */
export function router(routes: Array<[string | RegExp, (url: string, init: RequestInit) => Response | Promise<Response>]>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    for (const [pattern, handler] of routes) {
      if (typeof pattern === "string" ? url.includes(pattern) : pattern.test(url)) return handler(url, init);
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  return { impl, calls };
}

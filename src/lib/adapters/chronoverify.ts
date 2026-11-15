import { inputKind, result } from "@/lib/adapters/detection";
import { publicHttpsUrl } from "@/lib/adapters/http";
import { type Adapter, ProviderError, checkStatus, fetchWithTimeout, readJson } from "@/lib/adapters/types";

// Docs: https://chronoverify.com/docs and /openapi.json. Keyless use is allowed with a per-IP rate limit;
// CHRONOVERIFY_API_KEY (free tier: 100 verifications a month) raises it. The hosted MCP wraps the same REST call.
const BASE = { provider: "ChronoVerify", source_id: "chronoverify-mcp", method: "Image provenance and forensic consistency check" };
const DEFAULT_ENDPOINT = "https://chronoverify.com";

interface Verification {
  request_id?: string;
  verdict?: string;
  confidence?: number;
  headline?: string;
  summary?: string;
  limits?: string | string[];
  permalink?: string;
}

export const chronoVerifyAdapter: Adapter = {
  sourceId: "chronoverify-mcp",
  requiredEnv: [],
  optionalEnv: ["CHRONOVERIFY_API_KEY", "CHRONOVERIFY_ENDPOINT"],
  capabilities: ["analyze"],

  async analyze(input, ctx) {
    const kind = inputKind(input);
    if (kind !== "url") throw new ProviderError("bad_response", "ChronoVerify checks images; pass an image url");
    const form = new FormData();
    form.append("url", publicHttpsUrl(input.url as string).toString());
    const key = ctx.env.CHRONOVERIFY_API_KEY;
    const response = await fetchWithTimeout(ctx, `${ctx.env.CHRONOVERIFY_ENDPOINT ?? DEFAULT_ENDPOINT}/v1/verify`, {
      method: "POST",
      headers: key ? { authorization: `Bearer ${key}` } : {},
      body: form,
    });
    checkStatus(response);
    const body = await readJson<Verification>(response);
    if (typeof body.verdict !== "string") throw new ProviderError("bad_response", "Response had no verdict");
    const limits = Array.isArray(body.limits) ? body.limits.join(" ") : body.limits;
    return result(ctx, BASE, {
      input_kind: "url",
      state: "complete",
      original_labels: [body.verdict],
      scores: typeof body.confidence === "number" ? { confidence: body.confidence } : {},
      report_id: body.permalink ?? body.request_id ?? null,
      details: [body.headline, body.summary, limits ? `Limits: ${limits}` : null].filter(Boolean).join(" ").slice(0, 1500) || null,
    });
  },
};

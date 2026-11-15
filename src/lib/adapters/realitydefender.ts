import { inputKind, result } from "@/lib/adapters/detection";
import { publicHttpsUrl, poll } from "@/lib/adapters/http";
import { type Adapter, type AdapterContext, ProviderError, checkStatus, fetchWithTimeout, readJson, requireEnv } from "@/lib/adapters/types";

// Docs: https://docs.realitydefender.com (api-reference/endpoint/social.md, get_media_detail.md).
// By-URL analysis covers social media links only (Facebook, Instagram, X, YouTube, TikTok, Threads).
const BASE = { provider: "Reality Defender", source_id: "realitydefender-mcp", method: "Deepfake and manipulated media detection" };
const DEFAULT_ENDPOINT = "https://api.prd.realitydefender.xyz";
const DONE = new Set(["AUTHENTIC", "SUSPICIOUS", "FAKE", "NOT_APPLICABLE", "UNABLE_TO_EVALUATE"]);

interface MediaDetail {
  overallStatus?: string;
  resultsSummary?: { status?: string; metadata?: { finalScore?: number } };
  models?: Array<{ name?: string; status?: string; finalScore?: number | null }>;
}

async function call(ctx: AdapterContext, path: string, init: RequestInit) {
  const key = requireEnv(ctx, "REALITY_DEFENDER_API_KEY", "a Reality Defender API key from its dashboard");
  const response = await fetchWithTimeout(ctx, `${ctx.env.REALITY_DEFENDER_ENDPOINT ?? DEFAULT_ENDPOINT}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": key },
  });
  checkStatus(response);
  return readJson<Record<string, unknown>>(response);
}

async function collect(ctx: AdapterContext, requestId: string, kind: "url" | "report") {
  const detail = await poll(ctx, async () => {
    const body = (await call(ctx, `/api/media/users/${encodeURIComponent(requestId)}`, { method: "GET" })) as MediaDetail;
    const status = body.overallStatus ?? body.resultsSummary?.status;
    return status && DONE.has(status) ? body : null;
  });
  if (!detail) return result(ctx, BASE, { input_kind: kind, state: "pending", original_labels: ["ANALYZING"], report_id: requestId });
  const scores: Record<string, number> = {};
  if (typeof detail.resultsSummary?.metadata?.finalScore === "number") scores.finalScore = detail.resultsSummary.metadata.finalScore;
  for (const model of detail.models ?? []) if (model.name && typeof model.finalScore === "number") scores[`model:${model.name}`] = model.finalScore;
  return result(ctx, BASE, {
    input_kind: kind,
    state: "complete",
    original_labels: [detail.overallStatus ?? detail.resultsSummary?.status ?? "UNKNOWN"],
    scores,
    report_id: requestId,
    details: "Reality Defender bands finalScore 0-44 authentic, 45-55 suspicious, 56-100 fake.",
  });
}

export const realityDefenderAdapter: Adapter = {
  sourceId: "realitydefender-mcp",
  requiredEnv: ["REALITY_DEFENDER_API_KEY"],
  optionalEnv: ["REALITY_DEFENDER_ENDPOINT"],
  capabilities: ["analyze"],

  async analyze(input, ctx) {
    const kind = inputKind(input);
    if (kind === "text") throw new ProviderError("bad_response", "This adapter sends Reality Defender social media links, not text");
    if (kind === "report") return collect(ctx, input.report_id as string, "report");
    const url = publicHttpsUrl(input.url as string);
    const submitted = await call(ctx, "/api/files/social", { method: "POST", body: JSON.stringify({ socialLink: url.toString() }) });
    const requestId = (submitted.requestId ?? (submitted.response as Record<string, unknown> | undefined)?.requestId) as string | undefined;
    if (typeof requestId !== "string") throw new ProviderError("bad_response", "Response had no requestId");
    return collect(ctx, requestId, "url");
  },
};

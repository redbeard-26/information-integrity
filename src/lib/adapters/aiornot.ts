import { inputKind, result } from "@/lib/adapters/detection";
import { fetchMedia, numbers } from "@/lib/adapters/http";
import { type Adapter, type AdapterContext, ProviderError, checkStatus, fetchWithTimeout, readJson, requireEnv } from "@/lib/adapters/types";

// Docs: https://docs.aiornot.com (api-reference/reports-by-modality/image.md, text.md). Synchronous endpoints.
const BASE = { provider: "AI or Not", source_id: "aiornot-mcp" };
const DEFAULT_ENDPOINT = "https://api.aiornot.com";

interface AiOrNotImage {
  id?: string;
  report?: {
    ai_generated?: { verdict?: string; ai?: { is_detected?: boolean; confidence?: number }; human?: { confidence?: number } };
    deepfake?: { is_detected?: boolean; confidence?: number };
  };
}
interface AiOrNotText {
  id?: string;
  report?: { ai_text?: { is_detected?: boolean; confidence?: number } };
}

async function post(ctx: AdapterContext, path: string, body: BodyInit) {
  const key = requireEnv(ctx, "AIORNOT_API_KEY", "an AI or Not API key from the AI or Not dashboard");
  const response = await fetchWithTimeout(ctx, `${ctx.env.AIORNOT_ENDPOINT ?? DEFAULT_ENDPOINT}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body,
  });
  checkStatus(response);
  return response;
}

export const aiOrNotAdapter: Adapter = {
  sourceId: "aiornot-mcp",
  requiredEnv: ["AIORNOT_API_KEY"],
  optionalEnv: ["AIORNOT_ENDPOINT"],
  capabilities: ["analyze"],

  async analyze(input, ctx) {
    const kind = inputKind(input);
    if (kind === "report") throw new ProviderError("bad_response", "AI or Not answers synchronously; there is no report to collect");
    if (kind === "text") {
      const text = input.text as string;
      if (text.length < 250) throw new ProviderError("bad_response", "AI or Not needs at least 250 characters of text");
      const response = await post(ctx, "/v2/text/sync", new URLSearchParams({ text }));
      const body = await readJson<AiOrNotText>(response);
      const report = body.report?.ai_text;
      if (!report) throw new ProviderError("bad_response", "Response had no ai_text report");
      return result(ctx, { ...BASE, method: "AI text detection" }, {
        input_kind: "text",
        state: "complete",
        original_labels: [report.is_detected ? "ai_detected" : "ai_not_detected"],
        scores: numbers(report as Record<string, unknown>),
        report_id: body.id ?? null,
      });
    }
    const media = await fetchMedia(ctx, input.url as string, { maxBytes: 10_000_000, types: /^image\// });
    const form = new FormData();
    form.append("image", media.blob, media.fileName);
    const response = await post(ctx, "/v2/image/sync?only=ai_generated&only=deepfake", form);
    const body = await readJson<AiOrNotImage>(response);
    const generated = body.report?.ai_generated;
    if (!generated) throw new ProviderError("bad_response", "Response had no ai_generated report");
    const labels = [generated.verdict ?? "unknown"];
    if (body.report?.deepfake?.is_detected) labels.push("deepfake_detected");
    return result(ctx, { ...BASE, method: "AI-generated image and deepfake detection" }, {
      input_kind: "url",
      state: "complete",
      original_labels: labels,
      scores: {
        ...(typeof generated.ai?.confidence === "number" ? { ai_confidence: generated.ai.confidence } : {}),
        ...(typeof generated.human?.confidence === "number" ? { human_confidence: generated.human.confidence } : {}),
        ...(typeof body.report?.deepfake?.confidence === "number" ? { deepfake_confidence: body.report.deepfake.confidence } : {}),
      },
      report_id: body.id ?? null,
    });
  },
};

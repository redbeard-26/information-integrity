import { inputKind, result } from "@/lib/adapters/detection";
import { poll, publicHttpsUrl } from "@/lib/adapters/http";
import { type Adapter, type AdapterContext, ProviderError, checkStatus, fetchWithTimeout, readJson, requireEnv } from "@/lib/adapters/types";

// Docs: https://deepmedia.ai/documentation (DeepID API). Submission by public URL ("webLocation") appears in the
// API overview but not in the quick-start guide, so it is unconfirmed until a live test with a key.
const BASE = { provider: "Deep Media", source_id: "deepmedia-api", method: "Deepfake detection (DeepID)" };
const DEFAULT_ENDPOINT = "https://api.deepidentify.ai";
const MODALITY: Record<string, string> = { image: "image", video: "video", audio: "audio" };

async function call(ctx: AdapterContext, path: string, init: RequestInit) {
  const key = requireEnv(ctx, "DEEPMEDIA_API_KEY", "a DeepID API key issued by Deep Media on request");
  const response = await fetchWithTimeout(ctx, `${ctx.env.DEEPMEDIA_ENDPOINT ?? DEFAULT_ENDPOINT}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  });
  checkStatus(response);
  return readJson<Record<string, unknown>>(response);
}

function guessModality(url: URL): string {
  const ext = url.pathname.split(".").at(-1)?.toLowerCase() ?? "";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
  return "image";
}

async function collect(ctx: AdapterContext, id: string, kind: "url" | "report") {
  const status = await poll(ctx, async () => {
    const body = await call(ctx, `/file/status/${encodeURIComponent(id)}`, { method: "GET" });
    const state = String(body.status ?? "").toUpperCase();
    if (state === "ERROR") throw new ProviderError("unavailable", "Deep Media reported an error for this file");
    return ["RESULTS", "PROCESSED", "COMPLETED"].includes(state) ? body : null;
  }, 3000);
  if (!status) return result(ctx, BASE, { input_kind: kind, state: "pending", original_labels: ["PROCESSING"], report_id: id });
  const results = (status.results ?? {}) as Record<string, unknown>;
  const scores: Record<string, number> = {};
  for (const [modality, value] of Object.entries(results)) if (typeof value === "number") scores[modality] = value;
  return result(ctx, BASE, {
    input_kind: kind,
    state: "complete",
    original_labels: [String(status.status)],
    scores,
    report_id: id,
    details: "Deep Media's guidance: scores below 0.3 are likely authentic, above 0.7 likely deepfakes.",
  });
}

export const deepMediaAdapter: Adapter = {
  sourceId: "deepmedia-api",
  requiredEnv: ["DEEPMEDIA_API_KEY"],
  optionalEnv: ["DEEPMEDIA_ENDPOINT"],
  capabilities: ["analyze"],

  async analyze(input, ctx) {
    const kind = inputKind(input);
    if (kind === "text") throw new ProviderError("bad_response", "This adapter sends Deep Media media URLs, not text");
    if (kind === "report") return collect(ctx, input.report_id as string, "report");
    const url = publicHttpsUrl(input.url as string);
    const modality = MODALITY[guessModality(url)];
    const body = await call(ctx, "/v2/file/process", {
      method: "POST",
      body: JSON.stringify({ modalities: [modality], mode: "async", webLocation: url.toString() }),
    });
    if (typeof body.id !== "string") throw new ProviderError("bad_response", "Response had no id");
    return collect(ctx, body.id, "url");
  },
};

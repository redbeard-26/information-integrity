import { inputKind, result } from "@/lib/adapters/detection";
import { poll } from "@/lib/adapters/http";
import { type Adapter, type AdapterContext, ProviderError, checkStatus, fetchWithTimeout, readJson, requireEnv } from "@/lib/adapters/types";

// Docs: https://docs.pangram.com/api-reference/ai-detection. Submit a task, then poll it.
const BASE = { provider: "Pangram Labs", source_id: "pangram-mcp", method: "AI-generated text detection" };
const DEFAULT_ENDPOINT = "https://text.external-api.pangram.com";

interface PangramTask {
  stage?: string;
  headline?: string;
  prediction?: string;
  prediction_short?: string;
  fraction_ai?: number;
  fraction_ai_assisted?: number;
  fraction_human?: number;
  version?: string;
}

async function call(ctx: AdapterContext, path: string, init: RequestInit) {
  const key = requireEnv(ctx, "PANGRAM_API_KEY", "a Pangram API key from the Pangram dashboard");
  const response = await fetchWithTimeout(ctx, `${ctx.env.PANGRAM_ENDPOINT ?? DEFAULT_ENDPOINT}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": key },
  });
  checkStatus(response);
  return readJson<Record<string, unknown>>(response);
}

async function collect(ctx: AdapterContext, taskId: string, kind: "text" | "report") {
  const task = await poll(ctx, async () => {
    const body = (await call(ctx, `/task/${encodeURIComponent(taskId)}`, { method: "GET" })) as PangramTask;
    if (body.stage === "STAGE_FAILED") throw new ProviderError("unavailable", "Pangram reported the task failed");
    return body.stage === "STAGE_SUCCESS" ? body : null;
  }, 1500);
  if (!task) return result(ctx, BASE, { input_kind: kind, state: "pending", original_labels: ["PENDING"], report_id: taskId });
  const scores: Record<string, number> = {};
  for (const key of ["fraction_ai", "fraction_ai_assisted", "fraction_human"] as const) {
    if (typeof task[key] === "number") scores[key] = task[key] as number;
  }
  return result(ctx, BASE, {
    input_kind: kind,
    state: "complete",
    original_labels: [task.prediction_short ?? task.prediction ?? "unknown"],
    scores,
    report_id: taskId,
    details: task.headline ?? null,
  });
}

export const pangramAdapter: Adapter = {
  sourceId: "pangram-mcp",
  requiredEnv: ["PANGRAM_API_KEY"],
  optionalEnv: ["PANGRAM_ENDPOINT", "PANGRAM_MODEL"],
  capabilities: ["analyze"],

  async analyze(input, ctx) {
    const kind = inputKind(input);
    if (kind === "url") throw new ProviderError("bad_response", "Pangram analyzes text; pass text");
    if (kind === "report") return collect(ctx, input.report_id as string, "report");
    const body = await call(ctx, "/task", {
      method: "POST",
      body: JSON.stringify({ text: input.text, model: ctx.env.PANGRAM_MODEL ?? "default", public_dashboard_link: false }),
    });
    if (typeof body.task_id !== "string") throw new ProviderError("bad_response", "Response had no task_id");
    return collect(ctx, body.task_id, "text");
  },
};

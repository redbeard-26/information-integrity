import { type AdapterContext, type AnalysisResult, type AnalyzeInput, ProviderError } from "@/lib/adapters/types";

export function detectionAttribution(provider: string) {
  return {
    statement: `Automated result from ${provider}. It is a model score, not a finding of fact; check the provider's report and other evidence.`,
    license: null,
  };
}

export function inputKind(input: AnalyzeInput): "url" | "text" | "report" {
  const given = [input.url, input.text, input.report_id].filter((value) => typeof value === "string" && value.length > 0);
  if (given.length !== 1) throw new ProviderError("bad_response", "Pass exactly one of url, text or report_id");
  return input.report_id ? "report" : input.url ? "url" : "text";
}

export function result(
  ctx: AdapterContext,
  base: { provider: string; source_id: string; method: string },
  fields: Partial<AnalysisResult> & Pick<AnalysisResult, "input_kind" | "state">,
): AnalysisResult {
  return {
    provider: base.provider,
    source_id: base.source_id,
    retrieved_at: ctx.now().toISOString(),
    method: base.method,
    original_labels: [],
    scores: {},
    report_id: null,
    details: null,
    attribution: detectionAttribution(base.provider),
    untrusted: true,
    ...fields,
  };
}

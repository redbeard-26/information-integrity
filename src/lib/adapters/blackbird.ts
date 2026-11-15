import { inputKind, result } from "@/lib/adapters/detection";
import { poll, publicHttpsUrl } from "@/lib/adapters/http";
import { type Adapter, type AdapterContext, ProviderError, checkStatus, fetchWithTimeout, readJson, requireEnv } from "@/lib/adapters/types";

// Source: https://github.com/blackbirdai-team/blackbird-mcp-server (server.py). The official MCP server runs over
// stdio and wraps the Compass REST API, so this adapter calls the same REST endpoints directly.
const BASE = { provider: "Blackbird.AI", source_id: "blackbird-mcp" };
const API = "https://api.blackbird.ai/compass";
const TOKEN_URL = "https://blackbird-ai.auth.us-west-2.amazoncognito.com/oauth2/token";

async function token(ctx: AdapterContext): Promise<string> {
  const id = requireEnv(ctx, "BLACKBIRD_CLIENT_KEY", "Blackbird.AI Compass client key, issued to customers");
  const secret = requireEnv(ctx, "BLACKBIRD_SECRET_KEY", "Blackbird.AI Compass secret key, issued to customers");
  const response = await fetchWithTimeout(ctx, ctx.env.BLACKBIRD_TOKEN_URL ?? TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  checkStatus(response);
  const body = await readJson<{ access_token?: string }>(response);
  if (!body.access_token) throw new ProviderError("unauthorized", "Token response had no access_token");
  return body.access_token;
}

async function call(ctx: AdapterContext, bearer: string, path: string, init: RequestInit) {
  const response = await fetchWithTimeout(ctx, `${ctx.env.BLACKBIRD_ENDPOINT ?? API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
  });
  checkStatus(response);
  return readJson<Record<string, unknown>>(response);
}

function flatten(record: Record<string, unknown> | undefined): { labels: string[]; scores: Record<string, number>; details: string | null } {
  const labels: string[] = [];
  const scores: Record<string, number> = {};
  let details: string | null = null;
  for (const [key, value] of Object.entries(record ?? {})) {
    if (typeof value === "number") scores[key] = value;
    else if (typeof value === "string" && /label|verdict|rating|classification|risk/i.test(key)) labels.push(value);
    else if (typeof value === "string" && !details && /summary|explanation|context|analysis/i.test(key)) details = value.slice(0, 1500);
  }
  return { labels, scores, details };
}

export const blackbirdAdapter: Adapter = {
  sourceId: "blackbird-mcp",
  requiredEnv: ["BLACKBIRD_CLIENT_KEY", "BLACKBIRD_SECRET_KEY"],
  optionalEnv: ["BLACKBIRD_ENDPOINT", "BLACKBIRD_TOKEN_URL"],
  capabilities: ["analyze"],

  async analyze(input, ctx) {
    const kind = inputKind(input);
    if (kind === "report") throw new ProviderError("bad_response", "Pass the claim text or image URL again; Blackbird report ids are not collected here");
    const bearer = await token(ctx);
    const path = kind === "text" ? "/contextChecks" : "/visionAnalyses";
    const payload = kind === "text" ? { input: input.text } : { input: publicHttpsUrl(input.url as string).toString(), options: { explain: true } };
    const submitted = await call(ctx, bearer, path, { method: "POST", body: JSON.stringify(payload) });
    if (typeof submitted.id !== "string") throw new ProviderError("bad_response", "Response had no id");
    const id = submitted.id;
    const method = kind === "text" ? "Claim context check" : "Image (vision) analysis";
    const done = await poll(ctx, async () => {
      const body = await call(ctx, bearer, `${path}/${encodeURIComponent(id)}`, { method: "GET" });
      if (body.status === "failed" || body.status === "error") throw new ProviderError("unavailable", "Blackbird.AI reported the check failed");
      return body.status === "success" ? body : null;
    }, 5000);
    if (!done) return result(ctx, { ...BASE, method }, { input_kind: kind, state: "pending", original_labels: ["processing"], report_id: id });
    const flat = flatten((kind === "text" ? done.context : done.analysis) as Record<string, unknown> | undefined);
    return result(ctx, { ...BASE, method }, {
      input_kind: kind,
      state: "complete",
      original_labels: flat.labels,
      scores: flat.scores,
      report_id: id,
      details: flat.details,
    });
  },
};

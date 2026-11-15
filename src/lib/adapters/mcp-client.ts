import { type AdapterContext, ProviderError, checkStatus, fetchWithTimeout } from "@/lib/adapters/types";

/**
 * Minimal read-only MCP client over Streamable HTTP: initialize, then tools/call.
 * It accepts JSON or text/event-stream answers and keeps the session id the server issues.
 * Only tools/call is used; this server never exposes a provider's tools directly to callers.
 */
export interface McpConnection {
  url: string;
  headers: Record<string, string>;
}

export interface McpToolResult {
  texts: string[];
  structured: unknown;
  isError: boolean;
}

const PROTOCOL_VERSION = "2025-06-18";

async function parseRpc(response: Response, id: number): Promise<Record<string, unknown>> {
  const type = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const candidates: string[] = [];
  if (type.includes("text/event-stream")) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) candidates.push(data);
    }
  } else {
    candidates.push(body);
  }
  for (const text of candidates) {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      continue;
    }
    const messages = Array.isArray(message) ? message : [message];
    for (const entry of messages as Array<Record<string, unknown>>) {
      if (entry && entry.id === id) {
        if (entry.error) {
          const error = entry.error as { message?: string };
          throw new ProviderError("bad_response", `MCP error: ${error.message ?? "unknown"}`);
        }
        return (entry.result ?? {}) as Record<string, unknown>;
      }
    }
  }
  throw new ProviderError("bad_response", "No JSON-RPC answer in the MCP response");
}

async function rpc(
  ctx: AdapterContext,
  connection: McpConnection,
  session: { id: string | null },
  id: number,
  method: string,
  params: Record<string, unknown>,
) {
  const response = await fetchWithTimeout(ctx, connection.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...(session.id ? { "mcp-session-id": session.id } : {}),
      ...connection.headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  checkStatus(response);
  session.id = response.headers.get("mcp-session-id") ?? session.id;
  return parseRpc(response, id);
}

async function notify(ctx: AdapterContext, connection: McpConnection, session: { id: string | null }) {
  const response = await fetchWithTimeout(ctx, connection.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...(session.id ? { "mcp-session-id": session.id } : {}),
      ...connection.headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  checkStatus(response);
}

/** Opens a session and calls one tool on a remote MCP server. */
export async function callRemoteTool(
  ctx: AdapterContext,
  connection: McpConnection,
  tool: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const session = { id: null as string | null };
  await rpc(ctx, connection, session, 1, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "asfai-information-integrity", version: "0.2.0" },
  });
  await notify(ctx, connection, session);
  const result = await rpc(ctx, connection, session, 2, "tools/call", { name: tool, arguments: args });
  const content = Array.isArray(result.content) ? (result.content as Array<{ type?: string; text?: unknown }>) : [];
  const texts = content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text as string);
  if (result.isError === true) {
    throw new ProviderError("bad_response", `Tool '${tool}' reported an error: ${(texts[0] ?? "no detail").slice(0, 200)}`);
  }
  return { texts, structured: result.structuredContent ?? null, isError: false };
}

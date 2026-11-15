import { describe, expect, it } from "vitest";
import { makeRemoteMcpAdapter } from "@/lib/adapters/remote-mcp";
import { PARTNER_MCP_ADAPTERS } from "@/lib/adapters/partner-mcp";
import { ctx, json, router } from "./helpers";

const spec = { sourceId: "x-mcp", provider: "X", envPrefix: "X", defaultUrl: null, keyRequired: true, defaultSearchTool: null, method: "m", attribution: { statement: "s", license: null } };

function sse(payload: unknown) {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" } });
}

describe("remote MCP adapter", () => {
  it("lists what must be configured", () => {
    expect(makeRemoteMcpAdapter(spec).requiredEnv).toEqual(["X_MCP_URL", "X_API_KEY", "X_SEARCH_TOOL"]);
    for (const adapter of Object.values(PARTNER_MCP_ADAPTERS)) expect(adapter.requiredEnv.length).toBeGreaterThan(0);
  });

  it("initializes, keeps the session id and maps JSON tool output", async () => {
    const env = { X_MCP_URL: "https://mcp.example.org/mcp", X_API_KEY: "k", X_SEARCH_TOOL: "search_narratives" };
    const { impl, calls } = router([
      ["mcp.example.org", (_url, init) => {
        const body = JSON.parse(init.body as string);
        if (body.method === "initialize") return sse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } });
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        expect(body).toMatchObject({ method: "tools/call", params: { name: "search_narratives", arguments: { query: "election fraud" } } });
        return json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ results: [{ id: "n1", title: "Narrative", url: "https://p.example/n1", summary: "S", label: "high risk" }] }) }] } });
      }],
    ]);
    const page = await makeRemoteMcpAdapter(spec).search!("election fraud", { limit: 5 }, ctx(impl, env));
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect((calls[2].init.headers as Record<string, string>)["mcp-session-id"]).toBe("sess-1");
    expect(page.items[0]).toMatchObject({ original_id: "n1", title: "Narrative", original_url: "https://p.example/n1", original_labels: ["high risk"], untrusted: true });
  });

  it("returns plain text output as an excerpt and surfaces tool errors", async () => {
    const env = { X_MCP_URL: "https://mcp.example.org/mcp", X_API_KEY: "k", X_SEARCH_TOOL: "t", X_AUTH_HEADER: "x-api-key" };
    let isError = false;
    const { impl, calls } = router([
      ["mcp.example.org", (_url, init) => {
        const body = JSON.parse(init.body as string);
        if (body.method === "initialize") return json({ jsonrpc: "2.0", id: 1, result: {} });
        if (!body.id) return new Response(null, { status: 202 });
        return json({ jsonrpc: "2.0", id: 2, result: { isError, content: [{ type: "text", text: "Plain answer" }] } });
      }],
    ]);
    const page = await makeRemoteMcpAdapter(spec).search!("q", { limit: 5 }, ctx(impl, env));
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(page.items[0]).toMatchObject({ excerpt: "Plain answer", title: null });
    isError = true;
    await expect(makeRemoteMcpAdapter(spec).search!("q", { limit: 5 }, ctx(impl, env))).rejects.toMatchObject({ code: "bad_response" });
  });

  it("is not configured without its endpoint, key and tool", async () => {
    await expect(makeRemoteMcpAdapter(spec).search!("q", { limit: 5 }, ctx(router([]).impl))).rejects.toMatchObject({ code: "not_configured" });
  });
});

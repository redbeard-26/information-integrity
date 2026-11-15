import { type RemoteMcpSpec, makeRemoteMcpAdapter } from "@/lib/adapters/remote-mcp";

/**
 * Providers that offer MCP servers to customers or on request. None publishes its endpoint or tool names
 * openly, so each adapter stays "not configured" until the endpoint, credential and search tool name
 * from the provider's onboarding are set in the environment. See docs/SOURCES.md for each provider's terms.
 */
const customer = (provider: string) => ({
  statement: `Returned by ${provider} under this deployment's customer agreement. Do not redistribute beyond its terms.`,
  license: null,
});

export const PARTNER_MCP_SPECS: RemoteMcpSpec[] = [
  { sourceId: "euvsdisinfo", provider: "EUvsDisinfo", envPrefix: "EUVSDISINFO", defaultUrl: null, keyRequired: true, defaultSearchTool: null, method: "EUvsDisinfo database of pro-Kremlin disinformation cases", attribution: { statement: "Source: EUvsDisinfo database (euvsdisinfo.eu), accessed with credentials issued on request.", license: null } },
  { sourceId: "alethea-mcp", provider: "Alethea", envPrefix: "ALETHEA", defaultUrl: null, keyRequired: true, defaultSearchTool: null, method: "Artemis narrative and threat intelligence", attribution: customer("Alethea") },
  { sourceId: "peakmetrics-mcp", provider: "PeakMetrics", envPrefix: "PEAKMETRICS", defaultUrl: null, keyRequired: true, defaultSearchTool: null, method: "Narrative intelligence", attribution: customer("PeakMetrics") },
  { sourceId: "meltwater-mcp", provider: "Meltwater", envPrefix: "MELTWATER", defaultUrl: null, keyRequired: true, defaultSearchTool: null, method: "Media monitoring", attribution: customer("Meltwater") },
  { sourceId: "recordedfuture-mcp", provider: "Recorded Future", envPrefix: "RECORDEDFUTURE", defaultUrl: null, keyRequired: true, defaultSearchTool: null, method: "Threat intelligence", attribution: customer("Recorded Future") },
  { sourceId: "signalai-integrations", provider: "Signal AI", envPrefix: "SIGNALAI", defaultUrl: null, keyRequired: true, defaultSearchTool: null, method: "Media and risk monitoring", attribution: customer("Signal AI") },
  { sourceId: "gopie-mcp", provider: "FACTLY (GoPie)", envPrefix: "GOPIE", defaultUrl: null, keyRequired: false, defaultSearchTool: null, method: "GoPie data analysis over datasets loaded into a GoPie instance", attribution: { statement: "Answer from a GoPie instance; check the underlying dataset's licence.", license: null } },
];

export const PARTNER_MCP_ADAPTERS = Object.fromEntries(PARTNER_MCP_SPECS.map((spec) => [spec.sourceId, makeRemoteMcpAdapter(spec)]));

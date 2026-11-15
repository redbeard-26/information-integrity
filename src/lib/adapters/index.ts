import { aiOrNotAdapter } from "@/lib/adapters/aiornot";
import { blackbirdAdapter } from "@/lib/adapters/blackbird";
import { checkFirstAdapter } from "@/lib/adapters/checkfirst";
import { chronoVerifyAdapter } from "@/lib/adapters/chronoverify";
import { cofactsAdapter } from "@/lib/adapters/cofacts";
import { correctivAdapter } from "@/lib/adapters/correctiv";
import { deepMediaAdapter } from "@/lib/adapters/deepmedia";
import { FACT_CHECK_FEED_ADAPTERS } from "@/lib/adapters/fact-check-feeds";
import { factiverseAdapter } from "@/lib/adapters/factiverse";
import { faraAdapter } from "@/lib/adapters/fara";
import { meedanCheckAdapter } from "@/lib/adapters/meedan-check";
import { pangramAdapter } from "@/lib/adapters/pangram";
import { PARTNER_MCP_ADAPTERS } from "@/lib/adapters/partner-mcp";
import { realityDefenderAdapter } from "@/lib/adapters/realitydefender";
import type { Adapter } from "@/lib/adapters/types";

/** Adapters keyed by source id. A source's "adapter" field in sources.json names its entry here. */
export const ADAPTERS: Record<string, Adapter> = {
  "cofacts-graphql": cofactsAdapter,
  "checkfirst-radar-api": checkFirstAdapter,
  "chronoverify-mcp": chronoVerifyAdapter,
  "fara-efile-api": faraAdapter,
  "correctiv-sanctions": correctivAdapter,
  "factiverse-mcp": factiverseAdapter,
  "meedan-check-api": meedanCheckAdapter,
  "aiornot-mcp": aiOrNotAdapter,
  "realitydefender-mcp": realityDefenderAdapter,
  "pangram-mcp": pangramAdapter,
  "deepmedia-api": deepMediaAdapter,
  "blackbird-mcp": blackbirdAdapter,
  ...FACT_CHECK_FEED_ADAPTERS,
  ...PARTNER_MCP_ADAPTERS,
};

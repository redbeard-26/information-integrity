import { describe, expect, it } from "vitest";
import { ADAPTERS } from "@/lib/adapters";
import { defaultContext } from "@/lib/sources";

/**
 * Live smoke tests against real provider endpoints. Skipped unless LIVE_SMOKE=1, because they need
 * network access and the providers' current data. Run: LIVE_SMOKE=1 npx vitest run tests/live.test.ts
 * Set LIVE_SOURCES to a comma-separated list to run only some (default: every keyless search source).
 */
const live = process.env.LIVE_SMOKE === "1";
const only = process.env.LIVE_SOURCES?.split(",").map((s) => s.trim()).filter(Boolean);
const QUERIES: Record<string, string> = {
  "correctiv-sanctions": "rosneft",
  "fara-efile-api": "ministry",
  "checkfirst-radar-api": "advertising",
};
const keyless = Object.entries(ADAPTERS).filter(([, adapter]) => adapter.search && adapter.requiredEnv.length === 0);

describe.skipIf(!live)("live smoke", () => {
  for (const [id, adapter] of keyless.filter(([id]) => !only || only.includes(id))) {
    it(`${id} search answers with well-formed items`, { timeout: 60_000 }, async () => {
      const page = await adapter.search!(QUERIES[id] ?? "election", { limit: 3 }, defaultContext());
      console.log(`${id}: ${page.items.length} items, total ${page.total}; first: ${page.items[0]?.title ?? "(none)"}`);
      for (const item of page.items) expect(item).toMatchObject({ source_id: id, untrusted: true });
    });
  }
});

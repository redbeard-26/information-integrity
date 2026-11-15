import { DIRECTORY, facetCounts } from "@/lib/directory";

export default function Page() {
  const regions = facetCounts("region");
  return (
    <main>
      <p className="eyebrow">American Society for AI</p>
      <h1>ASFAI Information Integrity</h1>
      <p className="lede">
        An MCP server that gives AI assistants access to the {DIRECTORY.counts.records} organization records in the{" "}
        <a href={DIRECTORY.source.url}>{DIRECTORY.source.name}</a>.
      </p>
      <h2>Connect</h2>
      <p>
        Add a remote MCP connector at <code>/information-integrity/api/mcp</code> on this host. Tools:{" "}
        <code>search_organizations</code>, <code>get_organization</code>, <code>list_categories</code> and{" "}
        <code>about_directory</code>.
      </p>
      <h2>Regions</h2>
      <ul>
        {regions.map((region) => (
          <li key={region.value}>
            {region.value}: {region.count}
          </li>
        ))}
      </ul>
      <p className="note">
        Records reflect the source workbook ({DIRECTORY.source.workbook}). Descriptions, classifications, funding and
        statuses are source claims, not independently verified.
      </p>
    </main>
  );
}

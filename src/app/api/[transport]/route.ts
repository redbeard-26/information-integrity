import { createMcpHandler } from "mcp-handler";
import { registerInformationIntegrityTools } from "@/lib/register-tools";

export const maxDuration = 30;

// The directory is public, read-only reference data, so the MCP endpoint needs no sign-in.
const handler = createMcpHandler(
  (server) => {
    registerInformationIntegrityTools(server);
  },
  { serverInfo: { name: "asfai-information-integrity", version: "0.2.0" } },
  { basePath: "/api", maxDuration: 30, verboseLogs: false },
);

export { handler as GET, handler as POST, handler as DELETE };

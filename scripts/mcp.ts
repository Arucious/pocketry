import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPocketryMcpServer } from "../server/mcp";

async function main(): Promise<void> {
  const server = createPocketryMcpServer();
  const close = () => { void server.close().catch(error => console.error(error)); };
  process.stdin.once("end", close);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await server.connect(new StdioServerTransport());
}

main().catch(error => {
  // Stdout belongs exclusively to the MCP protocol.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

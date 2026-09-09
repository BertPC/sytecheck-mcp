#!/usr/bin/env node
/**
 * SyteCheck MCP server — stdio entry point.
 *
 * An MCP client spawns this as a subprocess and speaks JSON-RPC over stdin and
 * stdout. The one rule that follows from that: **nothing may ever be written to
 * stdout except protocol messages.** A stray console.log corrupts the stream and
 * the client disconnects with a parse error that gives no hint of the cause.
 * Diagnostics go to stderr, which clients surface as server logs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SyteCheckClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { registerPrompts } from "./prompts.js";
import { registerTools } from "./tools.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SyteCheckClient(config);

  const server = new McpServer(
    { name: "sytecheck", version: VERSION },
    {
      instructions:
        "SyteCheck scans a web page across ten quality dimensions and returns a " +
        "scored, plain-language report. Scans cost the account real money and draw " +
        "on a monthly quota, so prefer get_scan_report on an existing scan over " +
        "run_scan on a URL that was scanned recently, and check get_account_usage " +
        "before running several.",
    },
  );

  registerTools(server, client, config);
  registerPrompts(server);

  await server.connect(new StdioServerTransport());
  console.error(`sytecheck-mcp ${VERSION} ready (API: ${config.apiUrl})`);
}

main().catch((error: unknown) => {
  // A configuration problem is the user's to fix, so it gets the message alone.
  // Anything else gets a stack, because it is ours to fix and we need the trace.
  if (error instanceof ConfigError) {
    console.error(`sytecheck-mcp: ${error.message}`);
  } else {
    console.error("sytecheck-mcp failed to start:", error);
  }
  process.exit(1);
});

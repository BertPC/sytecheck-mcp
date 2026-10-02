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

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { createServer, VERSION } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);

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

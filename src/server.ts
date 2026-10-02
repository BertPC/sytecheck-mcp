/**
 * Server construction, shared by the stdio entry point and the remote Worker.
 *
 * Both transports must expose the same tools and prompts, so both build their
 * server here rather than each assembling its own — two copies would drift.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import { SyteCheckClient } from "./client.js";
import type { Config } from "./config.js";
import { registerPrompts } from "./prompts.js";
import { registerTools } from "./tools.js";

// Kept in step with package.json by hand — importing it would put a JSON file
// outside `rootDir` into the build. `manifest.test.ts` fails if they drift.
export const VERSION = "0.1.1";

/**
 * Build a server whose tools act with `config.apiKey`.
 *
 * `jsonSchemaValidator` exists for the Worker: the SDK's default validator
 * (Ajv) generates code at runtime, which the Workers runtime forbids.
 */
export function createServer(
  config: Config,
  options: Pick<ServerOptions, "jsonSchemaValidator"> = {},
): McpServer {
  const server = new McpServer(
    { name: "sytecheck", version: VERSION },
    {
      ...options,
      instructions:
        "SyteCheck scans a web page across ten quality dimensions and returns a " +
        "scored, plain-language report. Scans cost the account real money and draw " +
        "on a monthly quota, so prefer get_scan_report on an existing scan over " +
        "run_scan on a URL that was scanned recently, and check get_account_usage " +
        "before running several.",
    },
  );

  registerTools(server, new SyteCheckClient(config), config);
  registerPrompts(server);
  return server;
}

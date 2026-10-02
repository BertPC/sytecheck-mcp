/**
 * SyteCheck MCP server — remote entry point (Cloudflare Worker).
 *
 * Serves the same tools and prompts as the stdio server over Streamable HTTP at
 * `/mcp`. It is stateless: every request builds a fresh server around the
 * caller's own bearer token, which is forwarded to the SyteCheck API as-is. The
 * Worker holds no credential of its own and decides nothing about who may do
 * what — the API answers that, exactly as it does for a direct API call.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { loadServerConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

function jsonError(status: number, message: string, headers: HeadersInit = {}): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    { status, headers },
  );
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    // The spec requires rejecting invalid Origins, as a defence against DNS
    // rebinding from a browser. Server-side clients send no Origin at all, so
    // only a request that claims one is checked.
    const origin = request.headers.get("origin");
    const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
    if (origin !== null && !allowedOrigins.includes(origin)) {
      return jsonError(403, "Origin not allowed.");
    }

    // Stateless: there is no session to resume a stream on or to delete.
    if (request.method !== "POST") {
      return jsonError(405, "Method not allowed.", { Allow: "POST" });
    }

    const token = bearerToken(request);
    if (token === null) {
      // A real 401 with a challenge is what tells a client to start its auth flow.
      return jsonError(401, "Missing bearer token.", {
        "WWW-Authenticate": 'Bearer realm="sytecheck"',
      });
    }

    // run_scan polls the API until the scan finishes or this deadline passes.
    // At the defaults that is at most ~25 subrequests, inside the free plan's
    // 50 — so the wait settings are left at their defaults here.
    const config = {
      apiKey: token,
      ...loadServerConfig({ SYTECHECK_API_URL: env.SYTECHECK_API_URL }),
    };
    const server = createServer(config, {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;

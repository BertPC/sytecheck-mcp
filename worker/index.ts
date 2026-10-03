/**
 * SyteCheck MCP server — remote entry point (Cloudflare Worker).
 *
 * Serves the same tools and prompts as the stdio server over Streamable HTTP at
 * `/mcp`. It is stateless: every request builds a fresh server around the
 * caller's own bearer token, which is forwarded to the SyteCheck API as-is. The
 * Worker holds no credential of its own and decides nothing about who may do
 * what — the API answers that, exactly as it does for a direct API call.
 *
 * Users connect with OAuth, and the SyteCheck API is the authorization server
 * (its docs/reference/OAUTH.md). This Worker's part is RFC 9728: publish where
 * that server is, and answer an unauthenticated or dead token with a 401 that
 * points to it, which is how a client knows to sign in or refresh.
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

// What the remote server may be asked to do, in the API's vocabulary.
const SCOPES = ["scans:read", "scans:write"];

/** RFC 9728 places the document at the well-known path with the resource path appended. */
const METADATA_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

/**
 * The 401 challenge. `resource_metadata` is what sends a client to discovery;
 * `error="invalid_token"` tells one holding a token that it must refresh.
 */
function unauthorized(
  resource: string,
  message: string,
  invalidToken: boolean,
): Response {
  const metadata = `${new URL(resource).origin}/.well-known/oauth-protected-resource/mcp`;
  const error = invalidToken ? ', error="invalid_token"' : "";
  return jsonError(401, message, {
    "WWW-Authenticate": `Bearer realm="sytecheck", resource_metadata="${metadata}"${error}`,
  });
}

/**
 * Whether the API rejects this token outright.
 *
 * Checked before serving, because the tools report an API 401 as a tool error
 * inside a successful response — and an OAuth client only refreshes on an
 * HTTP 401. Only a 401 counts: a 403 here can be a valid token that lacks
 * `scans:read`, and an unreachable API is for the tools to report.
 */
async function apiRejectsToken(apiUrl: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/users/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    return response.status === 401;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const resource = env.MCP_RESOURCE_URL;
    const config = loadServerConfig({ SYTECHECK_API_URL: env.SYTECHECK_API_URL });

    if (request.method === "GET" && METADATA_PATHS.has(url.pathname)) {
      return Response.json({
        resource,
        // The API is the authorization server; its issuer is its own origin.
        authorization_servers: [config.apiUrl],
        scopes_supported: SCOPES,
        bearer_methods_supported: ["header"],
        resource_name: "SyteCheck",
        resource_documentation: "https://github.com/BertPC/sytecheck-mcp",
      });
    }

    if (url.pathname !== "/mcp") {
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
      return unauthorized(resource, "Missing bearer token.", false);
    }
    if (await apiRejectsToken(config.apiUrl, token)) {
      return unauthorized(resource, "Invalid or expired token.", true);
    }

    // run_scan polls the API until the scan finishes or this deadline passes.
    // At the defaults that is at most ~25 subrequests plus the token check
    // above, inside the free plan's 50 — so the wait settings stay at defaults.
    const server = createServer(
      { apiKey: token, ...config },
      {
        jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;

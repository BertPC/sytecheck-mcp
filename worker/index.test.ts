import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";

const env = {
  SYTECHECK_API_URL: "https://api.example.test",
  ALLOWED_ORIGINS: "https://allowed.example",
  MCP_RESOURCE_URL: "https://mcp.sytecheck.app/mcp",
} as Env;

function rpc(
  body: unknown,
  headers: Record<string, string> = { authorization: "Bearer sck_test_token" },
): Request {
  return new Request("https://mcp.sytecheck.app/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

/** Stand in for the API: the token check gets `meStatus`, everything else `body`. */
function stubApi(meStatus = 200, body: unknown = {}) {
  const upstream = vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith("/users/me")
      ? new Response(null, { status: meStatus })
      : Response.json(body),
  );
  vi.stubGlobal("fetch", upstream);
  return upstream;
}

beforeEach(() => stubApi());
afterEach(() => vi.unstubAllGlobals());

describe("remote worker", () => {
  it("serves only /mcp", async () => {
    const res = await worker.fetch(new Request("https://mcp.sytecheck.app/"), env);
    expect(res.status).toBe(404);
  });

  it("rejects a browser origin that is not allow-listed", async () => {
    const res = await worker.fetch(
      rpc(listTools, { origin: "https://evil.example" }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("answers a missing token with a 401 that points to discovery", async () => {
    const res = await worker.fetch(rpc(listTools, {}), env);
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(
      'resource_metadata="https://mcp.sytecheck.app/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challenge).not.toContain("invalid_token");
  });

  it("answers a token the API rejects with an HTTP 401, so clients refresh", async () => {
    // Without this the tools would report the API's 401 inside a 200, and an
    // OAuth client never refreshes on that.
    stubApi(401);
    const res = await worker.fetch(rpc(listTools), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("serves a token the API only forbids, since a write-only token is still valid", async () => {
    stubApi(403);
    const res = await worker.fetch(rpc(listTools), env);
    expect(res.status).toBe(200);
  });

  it("serves when the token check cannot reach the API, leaving the tools to report it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("down"))),
    );
    const res = await worker.fetch(rpc(listTools), env);
    expect(res.status).toBe(200);
  });

  it.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])("publishes protected-resource metadata at %s", async (path) => {
    const res = await worker.fetch(new Request(`https://mcp.sytecheck.app${path}`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Must equal the API's OAUTH_RESOURCE_URL and issuer, or tokens are refused.
    expect(body.resource).toBe("https://mcp.sytecheck.app/mcp");
    expect(body.authorization_servers).toEqual(["https://api.example.test"]);
    expect(body.scopes_supported).toEqual(["scans:read", "scans:write"]);
  });

  it("refuses GET, since a stateless server has no stream to resume", async () => {
    const res = await worker.fetch(new Request("https://mcp.sytecheck.app/mcp"), env);
    expect(res.status).toBe(405);
  });

  it("lists the same six tools as the stdio server", async () => {
    const res = await worker.fetch(
      rpc(listTools, {
        authorization: "Bearer sck_test_token",
        origin: "https://allowed.example",
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toEqual([
      "run_scan",
      "get_scan_report",
      "list_scans",
      "get_scan_trends",
      "list_categories",
      "get_account_usage",
    ]);
  });

  it("forwards the caller's own token to the API", async () => {
    const upstream = stubApi(200, {
      tier: "free",
      plan_name: "Free",
      scans_used: 1,
      scans_limit: 3,
      scans_remaining: 2,
      period_end: "2026-11-01T00:00:00Z",
      categories: [],
    });

    const res = await worker.fetch(
      rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_account_usage", arguments: {} },
      }),
      env,
    );

    expect(res.status).toBe(200);
    const usageCall = upstream.mock.calls.find(([url]) =>
      String(url).endsWith("/users/me/usage"),
    );
    expect(usageCall).toBeDefined();
    const [, init] = usageCall!;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sck_test_token");
  });
});

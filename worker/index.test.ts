import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";

const env = {
  SYTECHECK_API_URL: "https://api.example.test",
  ALLOWED_ORIGINS: "https://allowed.example",
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

  it("answers a missing token with a 401 challenge, so clients start auth", async () => {
    const res = await worker.fetch(rpc(listTools, {}), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
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
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json({
        tier: "free",
        plan_name: "Free",
        scans_used: 1,
        scans_limit: 3,
        scans_remaining: 2,
        period_end: "2026-11-01T00:00:00Z",
        categories: [],
      }),
    );
    vi.stubGlobal("fetch", upstream);

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
    const [url, init] = upstream.mock.calls[0]!;
    expect(String(url)).toBe("https://api.example.test/users/me/usage");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sck_test_token");
  });
});

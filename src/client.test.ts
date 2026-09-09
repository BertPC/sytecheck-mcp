import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, SyteCheckClient } from "./client.js";
import type { Config } from "./config.js";

const config: Config = {
  apiKey: "wak_super_secret_value",
  apiUrl: "https://api.example.test",
  waitTimeoutMs: 1000,
  pollIntervalMs: 10,
};

function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  const fn = vi.fn(
    async () =>
      ({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        statusText: response.statusText ?? "OK",
        headers: new Headers(response.headers ?? {}),
        json: async () => response.jsonBody ?? {},
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("SyteCheckClient", () => {
  it("sends the key as a bearer token", async () => {
    const fetchMock = mockFetch({ jsonBody: { id: 1 } });
    await new SyteCheckClient(config).getScan(1);

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${config.apiKey}`,
    });
  });

  it("reads usage from the unversioned path", async () => {
    // /users/me/usage is mounted outside /api/v1; getting this wrong 404s, and
    // the mistake is easy because every neighbouring route is versioned.
    const fetchMock = mockFetch({ jsonBody: {} });
    await new SyteCheckClient(config).getUsage();

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://api.example.test/users/me/usage",
    );
  });

  it("surfaces the API's detail message on failure", async () => {
    mockFetch({ ok: false, status: 403, jsonBody: { detail: "Not on this plan." } });

    await expect(new SyteCheckClient(config).getScan(1)).rejects.toMatchObject({
      status: 403,
      message: "Not on this plan.",
    });
  });

  it("flattens a validation-error list into one message", async () => {
    mockFetch({
      ok: false,
      status: 422,
      jsonBody: { detail: [{ msg: "url: not a valid URL" }] },
    });

    await expect(new SyteCheckClient(config).getScan(1)).rejects.toThrow(
      /url: not a valid URL/,
    );
  });

  it("does not splash a non-JSON error page into the message", async () => {
    // A WAF or gateway returns HTML. Echoing it would dump a page of markup into
    // the model's context; the status line is the useful part.
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
          headers: new Headers(),
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SyteCheckClient(config).getScan(1)).rejects.toThrow(
      "502 Bad Gateway",
    );
  });

  it("parses Retry-After so a 429 can be acted on", async () => {
    mockFetch({
      ok: false,
      status: 429,
      headers: { "retry-after": "120" },
      jsonBody: { detail: "Monthly quota reached." },
    });

    await expect(new SyteCheckClient(config).getScan(1)).rejects.toMatchObject({
      retryAfterSeconds: 120,
    });
  });

  it("never puts the API key in a network-failure message", async () => {
    // This message reaches a model's context and often a transcript from there.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const error = await new SyteCheckClient(config).getScan(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).not.toContain(config.apiKey);
    expect((error as ApiError).message).toContain("https://api.example.test");
    // The underlying error is retained for debugging, just not surfaced.
    expect((error as ApiError).cause).toBeInstanceOf(TypeError);
  });
});

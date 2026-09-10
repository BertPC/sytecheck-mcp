import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_API_URL, loadConfig } from "./config.js";

const KEY = "sck_test_abcdefghijklmnop";

describe("loadConfig", () => {
  it("defaults to the API host, not the app host", () => {
    // api.sytecheck.app and sytecheck.app are different hosts; the latter serves
    // the SPA and answers API paths with its "page not found" screen.
    expect(loadConfig({ SYTECHECK_API_KEY: KEY }).apiUrl).toBe(DEFAULT_API_URL);
    expect(DEFAULT_API_URL).toBe("https://api.sytecheck.app");
  });

  it("strips a trailing slash so paths do not double up", () => {
    const config = loadConfig({
      SYTECHECK_API_KEY: KEY,
      SYTECHECK_API_URL: "http://localhost:8000/",
    });
    expect(config.apiUrl).toBe("http://localhost:8000");
  });

  it("refuses a missing key with an actionable message", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/Account → API keys/);
  });

  it("rejects a value that is not a sck_ key", () => {
    // Caught here because the alternative is a puzzling 401 on the first call.
    expect(() => loadConfig({ SYTECHECK_API_KEY: "some-jwt-token" })).toThrow(/sck_/);
  });

  it("rejects a non-positive timeout rather than hanging or spinning", () => {
    expect(() =>
      loadConfig({ SYTECHECK_API_KEY: KEY, SYTECHECK_WAIT_TIMEOUT_MS: "0" }),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({ SYTECHECK_API_KEY: KEY, SYTECHECK_POLL_INTERVAL_MS: "nonsense" }),
    ).toThrow(ConfigError);
  });
});

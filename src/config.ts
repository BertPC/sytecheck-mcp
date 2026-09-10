/**
 * Runtime configuration, read from the environment once at startup.
 *
 * An MCP client launches this server as a subprocess and hands it environment
 * variables from its own config file, so there is nothing else to read from —
 * no config file of our own, no command-line flags.
 */

/** Default base URL for the SyteCheck API. */
export const DEFAULT_API_URL = "https://api.sytecheck.app";

export interface Config {
  apiKey: string;
  apiUrl: string;
  /** How long `run_scan` waits for a scan to finish before handing back an id. */
  waitTimeoutMs: number;
  /** Gap between poll requests while waiting. */
  pollIntervalMs: number;
}

/** Thrown for a configuration problem the user has to fix themselves. */
export class ConfigError extends Error {}

function positiveIntFromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive number, got: ${raw}`);
  }
  return Math.floor(value);
}

/**
 * Build the runtime config, or throw a message the user can act on.
 *
 * The API URL is normalised by stripping a trailing slash, so that
 * `https://api.sytecheck.app/` and `https://api.sytecheck.app` behave the same
 * rather than producing `//api/v1/scans` on one of them.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.SYTECHECK_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      "SYTECHECK_API_KEY is not set. Create a key at https://sytecheck.app " +
        "under Account → API keys, then set it in your MCP client config.",
    );
  }
  if (!apiKey.startsWith("sck_")) {
    // Caught early because the alternative is a puzzling 401 on the first tool
    // call. The usual cause is pasting the key id, or a session token, instead.
    throw new ConfigError(
      "SYTECHECK_API_KEY does not look like a SyteCheck API key — they begin " +
        "with 'sck_'. Copy the full secret shown once at creation.",
    );
  }

  // NOTE: api.sytecheck.app, *not* sytecheck.app. The app's host serves the
  // single-page application, so an API path there returns its "page not found"
  // screen rather than JSON — a confusing failure worth not defaulting into.
  const apiUrl = (env.SYTECHECK_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");

  return {
    apiKey,
    apiUrl,
    waitTimeoutMs: positiveIntFromEnv(env, "SYTECHECK_WAIT_TIMEOUT_MS", 60_000),
    pollIntervalMs: positiveIntFromEnv(env, "SYTECHECK_POLL_INTERVAL_MS", 3_000),
  };
}

/**
 * Thin HTTP client for the SyteCheck public API.
 *
 * Deliberately not generated from the OpenAPI spec and deliberately dependency
 * free: the surface is a dozen endpoints, `fetch` is in every supported Node,
 * and a generated client would be far more code to review in a repo whose whole
 * job is to be auditable by the people pasting a credential into it.
 *
 * One rule runs through this file: **the API key never appears in anything this
 * module returns or throws.** Errors from an MCP server are handed to a model
 * and frequently end up in a transcript, a log, or a bug report.
 */

import type { Config } from "./config.js";

/** An error carrying the HTTP status, so callers can react to 402/403/429. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ScanStatus = "queued" | "scanning" | "summarizing" | "complete" | "failed";

/** Statuses from which a scan will not progress further. */
export const TERMINAL_STATUSES: readonly ScanStatus[] = ["complete", "failed"];

export interface Scan {
  id: number;
  url: string;
  label: string | null;
  status: ScanStatus;
  categories_requested: string[];
  overall_score: number | null;
  error_message: string | null;
  quota_refunded_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Finding {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  recommendation: string;
  snippet: string | null;
}

export interface CategoryReport {
  category: string;
  status: "pass" | "warn" | "fail" | "error" | "blocked";
  score: number | null;
  summary: string;
  findings: Finding[];
  metrics?: { id: string; label: string; value: string; rating: string | null }[];
}

export interface ScanReport {
  id: number;
  url: string;
  label: string | null;
  status: ScanStatus;
  overall_score: number | null;
  created_at: string;
  completed_at: string | null;
  categories: CategoryReport[];
  executive_summary?: { summary: string; top_actions: string[] } | null;
}

export interface Usage {
  tier: string;
  plan_name: string;
  scans_used: number;
  scans_limit: number;
  scans_remaining: number;
  period_end: string;
  categories: string[];
  webhooks?: boolean;
  scan_credits?: number;
}

export interface CategoryInfo {
  id: string;
  description: string;
  weight: number;
  included: boolean;
}

export class SyteCheckClient {
  constructor(private readonly config: Config) {}

  private async request<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<T> {
    const url = new URL(this.config.apiUrl + path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (cause) {
      // Only the origin goes in the message: the Authorization header would be
      // present if we stringified the request, and this message reaches a model's
      // context. The original error is kept as `cause` so a stack trace is still
      // available to whoever is debugging, without being surfaced upward.
      const failure = new ApiError(
        0,
        `Could not reach the SyteCheck API at ${url.origin}.`,
      );
      failure.cause = cause;
      throw failure;
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await describeFailure(response),
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    return (await response.json()) as T;
  }

  listCategories(): Promise<{ categories: CategoryInfo[]; plan: string }> {
    return this.request("/api/v1/scans/categories");
  }

  getUsage(): Promise<Usage> {
    // Note the unversioned path: first-party account routes are mounted outside
    // /api/v1. Writing /api/v1/users/me/usage here 404s.
    return this.request("/users/me/usage");
  }

  createScan(body: {
    url: string;
    categories?: string[];
    label?: string;
  }): Promise<Scan> {
    return this.request("/api/v1/scans", { method: "POST", body });
  }

  getScan(id: number): Promise<Scan> {
    return this.request(`/api/v1/scans/${id}`);
  }

  getReport(id: number, lang?: string): Promise<ScanReport> {
    return this.request(`/api/v1/scans/${id}/report`, { query: { lang } });
  }

  listScans(params: {
    page?: number;
    page_size?: number;
    q?: string;
    status?: string;
  }): Promise<{
    scans: Scan[];
    total: number;
    page: number;
    page_size: number;
  }> {
    return this.request("/api/v1/scans", { query: params });
  }

  getTrends(): Promise<{
    trends: {
      url: string;
      points: { scan_id: number; created_at: string; score: number }[];
    }[];
  }> {
    return this.request("/api/v1/scans/trends");
  }

  findRecentDuplicate(url: string): Promise<{
    found: boolean;
    scan_id: number | null;
    minutes_ago: number | null;
    cooldown_minutes: number;
  }> {
    return this.request("/api/v1/scans/recent-duplicate", { query: { url } });
  }
}

/**
 * Turn a failed response into a message worth showing a user.
 *
 * FastAPI puts the useful text in `detail`, which may be a string or a list of
 * validation errors. Falling back to the status line matters: an HTML error page
 * from a proxy would otherwise be splashed into the model's context whole.
 */
async function describeFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") {
      detail = body.detail;
    } else if (Array.isArray(body.detail)) {
      detail = body.detail
        .map((e) =>
          typeof e === "object" && e && "msg" in e ? String(e.msg) : String(e),
        )
        .join("; ");
    }
  } catch {
    // Not JSON — a gateway or WAF page. Say nothing about its contents.
  }
  return detail || `${response.status} ${response.statusText}`.trim();
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Tool definitions.
 *
 * Six tools rather than one per endpoint. A model reasons better about a short
 * list of tasks than a long list of routes, and several endpoints (the duplicate
 * check, the status poll) are steps inside a task rather than tasks themselves.
 *
 * **Every name says "scan", never "audit."** SyteCheck renamed the concept on
 * 2026-08-03 because "audit" resolves to the *accounting* sense in every CJK
 * locale (ja 監査, ko 감사, zh-CN 审计). Tool names are rendered in the client's
 * UI and read by the model, so they sit firmly on the customer-facing side of
 * that line.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError, SyteCheckClient, TERMINAL_STATUSES, type Scan } from "./client.js";
import type { Config } from "./config.js";
import { formatReport, formatScanSummary, formatUsage } from "./format.js";

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function text(body: string, isError = false): TextResult {
  return {
    content: [{ type: "text", text: body }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Render an API failure as a tool error the model can act on.
 *
 * The status codes are separated because the right next step differs sharply:
 * 429 means wait or upgrade, 403 means the plan will never allow this however
 * many times it is retried. Conflating them produces a model that retries a
 * permanent refusal forever.
 */
function apiErrorText(error: unknown): TextResult {
  if (!(error instanceof ApiError)) {
    return text(
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  switch (error.status) {
    case 401:
      return text(
        `Authentication failed: ${error.message}\n` +
          "The API key is missing, revoked, or belongs to a disabled account. " +
          "Create a new one at https://sytecheck.app under Account → API keys.",
        true,
      );
    case 403:
      // Deliberately not "not permitted on this plan": a 403 here is just as
      // often the key's scopes or the route allow-list, and naming the wrong
      // cause sends the user to upgrade a plan that was never the problem. The
      // API's own detail says which it is.
      return text(
        `Not permitted: ${error.message}\n` +
          "This is a permission or plan limitation, not a transient failure — " +
          "retrying will not help.",
        true,
      );
    case 429: {
      const wait = error.retryAfterSeconds
        ? ` Retry after about ${error.retryAfterSeconds} seconds.`
        : "";
      return text(
        `Rate or quota limit reached: ${error.message}${wait}\n` +
          "Check get_account_usage to see what is left this month.",
        true,
      );
    }
    default:
      return text(`SyteCheck API error (${error.status}): ${error.message}`, true);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a scan until it reaches a terminal state or the deadline passes.
 *
 * Polling rather than the SSE `/stream` endpoint: the stream would save a
 * handful of requests, but parsing an event stream is materially more code in a
 * server whose value is being easy to audit, and a dropped connection has to
 * fall back to polling anyway. Returns the last state seen either way, so the
 * caller can report progress rather than failing.
 */
async function waitForScan(
  client: SyteCheckClient,
  scanId: number,
  config: Config,
): Promise<Scan> {
  const deadline = Date.now() + config.waitTimeoutMs;
  let scan = await client.getScan(scanId);
  while (!TERMINAL_STATUSES.includes(scan.status) && Date.now() < deadline) {
    await sleep(config.pollIntervalMs);
    scan = await client.getScan(scanId);
  }
  return scan;
}

export function registerTools(
  server: McpServer,
  client: SyteCheckClient,
  config: Config,
): void {
  server.registerTool(
    "run_scan",
    {
      title: "Run a website scan",
      description:
        "Submit a URL to SyteCheck and wait for the report. Scans ten dimensions of " +
        "site quality: HTML validity, SEO, broken links, accessibility (WCAG 2.2 AA), " +
        "performance (Lighthouse), security headers, responsive design, AI visibility, " +
        "content freshness, and an AI visual critique of the design.\n\n" +
        "IMPORTANT: each scan consumes one of the account's monthly scans and costs " +
        "real money. Free accounts get three per month. Check get_account_usage " +
        "first if you are unsure of the remaining quota, and confirm with the user " +
        "before scanning the same URL more than once — repeat scans of an unchanged " +
        "page rarely tell you anything new.\n\n" +
        "A scan usually takes a few minutes. If it is still running when this " +
        "returns, you get the scan id — pass it to get_scan_report to collect the " +
        "result rather than scanning again.",
      inputSchema: {
        url: z.string().url().describe("Full URL to scan, including https://"),
        categories: z
          .array(z.string())
          .optional()
          .describe(
            "Category ids to run. Omit for everything the plan includes. " +
              "Use list_categories to see what this account may request.",
          ),
        label: z.string().max(255).optional().describe("Optional name for this scan."),
      },
      annotations: {
        title: "Run a website scan",
        // Not read-only: it spends quota and money. Clients surface this to ask
        // the user before running, which is exactly what should happen here.
        readOnlyHint: false,
        // Nothing is destroyed, but a repeat call is a fresh charge, so this is
        // emphatically not idempotent.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, categories, label }) => {
      try {
        // Advisory only — the API allows the scan, but telling the model a very
        // recent scan exists is usually enough for it to stop and ask.
        let duplicateNote = "";
        try {
          const duplicate = await client.findRecentDuplicate(url);
          if (duplicate.found && duplicate.scan_id) {
            duplicateNote =
              `\n\nNote: this URL was already scanned ${duplicate.minutes_ago} minutes ago ` +
              `(scan #${duplicate.scan_id}). Consider get_scan_report on that scan instead ` +
              "of spending another scan from the quota.";
          }
        } catch {
          // A failed advisory check must never block the scan itself.
        }

        const scan = await client.createScan({ url, categories, label });
        const finished = await waitForScan(client, scan.id, config);

        if (!TERMINAL_STATUSES.includes(finished.status)) {
          return text(
            `${formatScanSummary(finished)}\n\n` +
              `Still running after ${Math.round(config.waitTimeoutMs / 1000)}s. ` +
              `Call get_scan_report with scan_id ${finished.id} in a minute or two — ` +
              "do NOT call run_scan again, that would spend another scan." +
              duplicateNote,
          );
        }

        if (finished.status === "failed") {
          return text(`${formatScanSummary(finished)}${duplicateNote}`);
        }

        const report = await client.getReport(finished.id);
        return text(formatReport(report) + duplicateNote);
      } catch (error) {
        return apiErrorText(error);
      }
    },
  );

  server.registerTool(
    "get_scan_report",
    {
      title: "Get a scan report",
      description:
        "Fetch the full findings for a scan by id, including the executive summary " +
        "and per-category results. Use this to collect a scan that run_scan left " +
        "running, or to re-read an earlier scan without spending quota.",
      inputSchema: {
        scan_id: z.number().int().positive().describe("The scan's id."),
        lang: z
          .string()
          .optional()
          .describe("Optional BCP-47 language for the report text, e.g. 'fr' or 'ja'."),
      },
      annotations: {
        title: "Get a scan report",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ scan_id, lang }) => {
      try {
        return text(formatReport(await client.getReport(scan_id, lang)));
      } catch (error) {
        // 409 is the documented "not finished yet" answer, not a failure.
        if (error instanceof ApiError && error.status === 409) {
          const scan = await client.getScan(scan_id).catch(() => null);
          return text(
            `Scan #${scan_id} has not finished yet` +
              (scan ? ` (status: ${scan.status})` : "") +
              ". Wait a minute and try again — do not start a new scan.",
          );
        }
        return apiErrorText(error);
      }
    },
  );

  server.registerTool(
    "list_scans",
    {
      title: "List past scans",
      description:
        "List this account's scans, newest first. Use it to find a scan id, or to " +
        "check whether a site has been scanned before starting a new one.",
      inputSchema: {
        query: z.string().optional().describe("Filter by URL or label substring."),
        status: z
          .enum(["queued", "scanning", "summarizing", "complete", "failed"])
          .optional()
          .describe("Filter by scan status."),
        page: z.number().int().positive().optional().describe("1-based page number."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (max 100)."),
      },
      annotations: { title: "List past scans", readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, status, page, page_size }) => {
      try {
        const result = await client.listScans({ q: query, status, page, page_size });
        if (result.scans.length === 0) return text("No scans matched.");
        const header = `${result.total} scan(s) total — page ${result.page}:`;
        return text([header, "", ...result.scans.map(formatScanSummary)].join("\n\n"));
      } catch (error) {
        return apiErrorText(error);
      }
    },
  );

  server.registerTool(
    "get_scan_trends",
    {
      title: "Get score trends",
      description:
        "Score history per URL across repeated scans — whether a site is improving " +
        "or regressing over time. Returns nothing useful for a site scanned only once.",
      inputSchema: {},
      annotations: { title: "Get score trends", readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { trends } = await client.getTrends();
        if (trends.length === 0) {
          return text("No trends yet — a URL needs at least two scans to show one.");
        }
        const lines = trends.map((t) => {
          const points = t.points.map((p) => `${p.created_at.slice(0, 10)}: ${p.score}`);
          return `${t.url}\n  ${points.join("\n  ")}`;
        });
        return text(lines.join("\n\n"));
      } catch (error) {
        return apiErrorText(error);
      }
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "List scan categories",
      description:
        "The analysis categories SyteCheck can run, and which of them this account's " +
        "plan includes. Check this before passing `categories` to run_scan — " +
        "requesting one the plan withholds is refused outright rather than skipped.",
      inputSchema: {},
      annotations: {
        title: "List scan categories",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const { categories, plan } = await client.listCategories();
        const lines = categories.map(
          (c) =>
            `- ${c.id}${c.included ? "" : "  (not included in this plan)"}: ${c.description}`,
        );
        return text([`Plan: ${plan}`, "", ...lines].join("\n"));
      } catch (error) {
        return apiErrorText(error);
      }
    },
  );

  server.registerTool(
    "get_account_usage",
    {
      title: "Get account usage and quota",
      description:
        "How many scans this account has left this month, its plan, and which " +
        "categories it may run. Check this before running scans in bulk — quota is " +
        "per calendar month and does not roll over.",
      inputSchema: {},
      annotations: {
        title: "Get account usage and quota",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        return text(formatUsage(await client.getUsage()));
      } catch (error) {
        return apiErrorText(error);
      }
    },
  );
}

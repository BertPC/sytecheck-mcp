#!/usr/bin/env node
/**
 * Submit a scan, poll until it finishes, print the report.
 *
 *   export SYTECHECK_API_KEY=wak_...
 *   node scan.mjs https://example.com
 *
 * No dependencies — `fetch` is built into Node 18+.
 */

const API_URL = process.env.SYTECHECK_API_URL ?? "https://api.sytecheck.app";
const API_KEY = process.env.SYTECHECK_API_KEY;

// A scan runs a browser and a Lighthouse audit, so minutes is normal.
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 600_000;
const TERMINAL = new Set(["complete", "failed"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const response = await fetch(API_URL + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const error = new Error(await describeFailure(response));
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  return response.json();
}

/**
 * Turn a failed response into a readable message.
 *
 * `detail` is a string for most errors but an *array* of validation objects for
 * a 422 — interpolating that straight into a template literal yields
 * "[object Object]", which tells the user nothing. Falling back to the status
 * line matters too: a gateway or WAF answers with HTML, not JSON.
 */
async function describeFailure(response) {
  try {
    const { detail } = await response.json();
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((e) => e?.msg ?? JSON.stringify(e)).join("; ");
    }
  } catch {
    // Not JSON.
  }
  return `${response.status} ${response.statusText}`.trim();
}

async function main(url) {
  if (!API_KEY) {
    console.error("Set SYTECHECK_API_KEY (Account → API keys).");
    return 1;
  }

  let scan;
  try {
    scan = await api("/api/v1/scans", { method: "POST", body: JSON.stringify({ url }) });
  } catch (error) {
    // Worth separating: a 403 never becomes a 200 by retrying, a 429 does.
    if (error.status === 403) console.error(`Refused: ${error.message}`);
    else if (error.status === 429)
      console.error(
        `Quota or rate limit reached; retry after ${error.retryAfter ?? "?"}s.`,
      );
    else console.error(error.message);
    return 1;
  }

  console.error(`Scan ${scan.id} queued for ${url}`);

  const deadline = Date.now() + TIMEOUT_MS;
  let status = scan.status;
  while (!TERMINAL.has(status)) {
    if (Date.now() > deadline) {
      console.error(`Gave up waiting; scan ${scan.id} is still ${status}.`);
      return 1;
    }
    await sleep(POLL_INTERVAL_MS);
    const current = await api(`/api/v1/scans/${scan.id}`);
    if (current.status !== status) {
      status = current.status;
      console.error(`  … ${status}`);
    }
  }

  if (status === "failed") {
    const failed = await api(`/api/v1/scans/${scan.id}`);
    console.error(`Scan failed: ${failed.error_message}`);
    return 1;
  }

  const report = await api(`/api/v1/scans/${scan.id}/report`);
  console.log(`\n${report.url} — overall score ${report.overall_score}/100\n`);
  for (const category of report.categories) {
    const score = category.score === null ? "n/a" : Math.round(category.score);
    console.log(
      `${category.category.padEnd(20)} ${String(category.status).padEnd(8)} ${String(score).padStart(5)}`,
    );
    for (const finding of category.findings.slice(0, 3)) {
      console.log(`    [${finding.severity}] ${finding.title}`);
    }
  }
  return 0;
}

const url = process.argv[2];
if (!url) {
  console.error("usage: node scan.mjs <url>");
  process.exit(2);
}
process.exit(await main(url));

import { describe, expect, it } from "vitest";
import type { Finding, Scan, ScanReport } from "./client.js";
import { formatReport, formatScanSummary } from "./format.js";

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "f1",
    severity: "warning",
    title: "Image missing alt text",
    detail: "3 images have no alt attribute.",
    recommendation: "Add alt text to each image.",
    snippet: null,
    ...overrides,
  };
}

function report(findings: Finding[]): ScanReport {
  return {
    id: 1,
    url: "https://example.com",
    label: null,
    status: "complete",
    overall_score: 80,
    created_at: "2026-10-13T00:00:00Z",
    completed_at: "2026-10-13T00:05:00Z",
    categories: [
      {
        category: "accessibility",
        status: "warn",
        score: 70,
        summary: "Some issues.",
        findings,
      },
    ],
  };
}

describe("formatReport", () => {
  it("prints the fix for an unlocked finding", () => {
    expect(formatReport(report([finding({})]))).toContain(
      "Fix: Add alt text to each image.",
    );
  });

  it("says a locked fix is withheld rather than omitting it", () => {
    // Free plans get detail_locked findings with an empty recommendation; a
    // silent gap reads as "no fix" and invites the model to make one up.
    const text = formatReport(
      report([finding({ detail_locked: true, recommendation: "", snippet: null })]),
    );
    expect(text).toContain("Image missing alt text");
    expect(text).toContain("Fix: withheld on this plan");
  });
});

describe("formatScanSummary", () => {
  it("does not claim a refunded scan never ran", () => {
    // Scans whose categories all errored did run, and are refunded too.
    const scan: Scan = {
      id: 2,
      url: "https://example.com",
      label: null,
      status: "failed",
      categories_requested: [],
      overall_score: null,
      error_message: "Every category errored.",
      quota_refunded_at: "2026-10-13T00:05:00Z",
      created_at: "2026-10-13T00:00:00Z",
      completed_at: "2026-10-13T00:05:00Z",
    };
    const text = formatScanSummary(scan);
    expect(text).toContain("cost no quota");
    expect(text).not.toContain("unreachable");
  });
});

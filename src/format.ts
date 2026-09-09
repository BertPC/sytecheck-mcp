/**
 * Rendering API payloads into text a model reads well.
 *
 * MCP tool results are text in a context window, not a UI. Two consequences
 * shape everything here: return the *findings* rather than the raw JSON, because
 * a full report is largely fields nobody will act on; and never invent a summary
 * the API did not provide, because a model reading this cannot tell our prose
 * from the API's.
 */

import type { CategoryReport, Scan, ScanReport, Usage } from "./client.js";

/** Findings past this many per category are summarised as a count instead. */
const MAX_FINDINGS_PER_CATEGORY = 8;

export function formatScanSummary(scan: Scan): string {
  const lines = [`Scan #${scan.id} — ${scan.url}`, `Status: ${scan.status}`];
  if (scan.label) lines.push(`Label: ${scan.label}`);
  if (scan.overall_score !== null) lines.push(`Overall score: ${scan.overall_score}/100`);
  if (scan.error_message) lines.push(`Error: ${scan.error_message}`);
  if (scan.quota_refunded_at) {
    lines.push(
      "This scan was voided before it ran (the site was unreachable), so it cost " +
        "no quota and any scan credit was returned.",
    );
  }
  return lines.join("\n");
}

export function formatReport(report: ScanReport): string {
  const parts: string[] = [
    `# SyteCheck report — ${report.url}`,
    "",
    `Scan #${report.id} · ${report.status}` +
      (report.overall_score !== null
        ? ` · overall score ${report.overall_score}/100`
        : ""),
  ];

  if (report.executive_summary?.summary) {
    parts.push("", "## Summary", report.executive_summary.summary);
    const actions = report.executive_summary.top_actions ?? [];
    if (actions.length > 0) {
      parts.push("", "### Top actions", ...actions.map((a) => `- ${a}`));
    }
  }

  parts.push("", "## Categories");
  for (const category of report.categories) {
    parts.push("", formatCategory(category));
  }
  return parts.join("\n");
}

function formatCategory(category: CategoryReport): string {
  const score = category.score === null ? "n/a" : `${category.score}/100`;
  const lines = [
    `### ${category.category} — ${category.status} (${score})`,
    category.summary,
  ];

  if (category.status === "blocked") {
    lines.push(
      "The site's bot protection refused automated access, so this category " +
        "could not be assessed. It is excluded from the overall score.",
    );
  }

  if (category.metrics?.length) {
    lines.push("", "Metrics:");
    for (const m of category.metrics) {
      lines.push(`- ${m.label}: ${m.value}${m.rating ? ` (${m.rating})` : ""}`);
    }
  }

  const findings = category.findings ?? [];
  if (findings.length > 0) {
    lines.push("", "Findings:");
    for (const f of findings.slice(0, MAX_FINDINGS_PER_CATEGORY)) {
      lines.push(`- [${f.severity}] ${f.title}`);
      if (f.recommendation) lines.push(`  Fix: ${f.recommendation}`);
    }
    if (findings.length > MAX_FINDINGS_PER_CATEGORY) {
      lines.push(`- …and ${findings.length - MAX_FINDINGS_PER_CATEGORY} more.`);
    }
  }
  return lines.join("\n");
}

export function formatUsage(usage: Usage): string {
  return [
    `Plan: ${usage.plan_name} (${usage.tier})`,
    `Scans used this month: ${usage.scans_used} of ${usage.scans_limit}`,
    `Remaining: ${usage.scans_remaining}`,
    `Quota resets: ${usage.period_end}`,
    `Categories available: ${usage.categories.join(", ")}`,
    usage.scan_credits ? `One-off scan credits: ${usage.scan_credits}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

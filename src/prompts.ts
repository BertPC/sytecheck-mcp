/**
 * Prompts the client offers the user directly.
 *
 * A prompt is worth having where the useful thing is not one tool call but a
 * short sequence with judgement in between — here, scanning a site and then
 * turning ten categories of findings into an ordered plan.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "scan-and-remediate",
    {
      title: "Scan a site and plan the fixes",
      description:
        "Run a SyteCheck scan on a URL and turn the findings into a prioritized, " +
        "actionable remediation plan.",
      argsSchema: {
        url: z.string().describe("The URL to scan, including https://"),
        focus: z
          .string()
          .optional()
          .describe(
            "Optional area to weight, e.g. 'accessibility', 'performance', 'SEO'.",
          ),
      },
    },
    ({ url, focus }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Scan ${url} with SyteCheck and turn the results into a fix plan.`,
              "",
              "Steps:",
              "1. Call get_account_usage first. If fewer than two scans remain this",
              "   month, say so and ask before spending one.",
              "2. Call run_scan for the URL. If it is still running when the tool",
              "   returns, wait and call get_scan_report with the id — never call",
              "   run_scan a second time for the same URL.",
              "3. Group the findings by what fixing them requires: content edits,",
              "   template or CSS changes, server or header configuration, and",
              "   anything needing a developer.",
              "4. Order them by impact against effort, not by the scanner's severity",
              "   alone — a single critical finding that needs a rebuild may be worth",
              "   less this week than five warnings fixed in an afternoon.",
              "5. For each item give the concrete change, not the category name.",
              "",
              focus
                ? `Weight the plan toward ${focus}, but still report anything critical elsewhere.`
                : "Cover every category the scan returned.",
              "",
              "Do not invent findings. If a category was blocked or errored, say so",
              "plainly — a site behind bot protection is a real result, not a gap to",
              "fill with guesses.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

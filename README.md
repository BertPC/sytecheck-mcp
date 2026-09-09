# SyteCheck MCP Server

Run website audits from Claude, ChatGPT, Cursor, or any other MCP client, and get
the findings back as text you can act on.

[SyteCheck](https://sytecheck.app) scans a page across ten dimensions — HTML
validity, SEO, broken links, accessibility (WCAG 2.2 AA via axe-core), performance
(a real Lighthouse run), security headers, responsive layout, AI visibility,
content freshness, and an AI critique of the visual design — and returns a scored,
plain-language report.

**A free account works.** No card, no trial clock: the free tier includes three
scans a month across three categories, which is enough to wire this up and see a
real report before deciding whether to pay for more.

## Quickstart

1. **Create an account** at [sytecheck.app](https://sytecheck.app) and verify your
   email.
2. **Mint a key** at Account → API keys. Choose **`scans:read` only** if you want
   the model to read existing scans but never spend quota. The secret is shown
   once.
3. **Add the server** to your client, using one of the recipes below.

### Claude Code

```bash
claude mcp add sytecheck --env SYTECHECK_API_KEY=wak_your_key_here \
  -- npx -y @sytecheck/mcp-server
```

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "sytecheck": {
      "command": "npx",
      "args": ["-y", "@sytecheck/mcp-server"],
      "env": { "SYTECHECK_API_KEY": "wak_your_key_here" }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project, or the global equivalent:

```json
{
  "mcpServers": {
    "sytecheck": {
      "command": "npx",
      "args": ["-y", "@sytecheck/mcp-server"],
      "env": { "SYTECHECK_API_KEY": "wak_your_key_here" }
    }
  }
}
```

### Gemini CLI / Antigravity CLI

Add to `~/.gemini/settings.json` (or the Antigravity equivalent):

```json
{
  "mcpServers": {
    "sytecheck": {
      "command": "npx",
      "args": ["-y", "@sytecheck/mcp-server"],
      "env": { "SYTECHECK_API_KEY": "wak_your_key_here" }
    }
  }
}
```

### OpenAI Agents SDK

```python
from agents import Agent
from agents.mcp import MCPServerStdio

sytecheck = MCPServerStdio(
    params={
        "command": "npx",
        "args": ["-y", "@sytecheck/mcp-server"],
        "env": {"SYTECHECK_API_KEY": "wak_your_key_here"},
    }
)

agent = Agent(
    name="Site auditor",
    instructions="Audit sites with SyteCheck and explain what to fix.",
    mcp_servers=[sytecheck],
)
```

Then ask: _"Scan https://example.com and tell me what to fix first."_

## Tools

| Tool                | What it does                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| `run_scan`          | Submit a URL and wait for the report. **Spends quota.**                         |
| `get_scan_report`   | Full findings for a scan id — the way to collect a scan `run_scan` left running |
| `list_scans`        | Scan history, newest first, with filters                                        |
| `get_scan_trends`   | Score history per URL across repeat scans                                       |
| `list_categories`   | What SyteCheck can check, and what your plan includes                           |
| `get_account_usage` | Scans remaining this month, and when the quota resets                           |

There is also a **`scan-and-remediate` prompt** that scans a URL and turns the
findings into a prioritized fix plan.

### A note on cost

`run_scan` is the only tool that spends anything, and it spends real money: a scan
opens a browser, runs Lighthouse, and calls a vision model. It is marked
non-read-only so your client asks before running it, and its description tells the
model to check remaining quota first and not to re-scan an unchanged page. **On a
free account you have three scans a month** — an agent looping over `run_scan`
would exhaust that in one turn.

If you are handing a key to something unattended, mint a `scans:read` key. It
cannot create scans at all.

## Configuration

| Variable                     | Default                     | Purpose                                              |
| ---------------------------- | --------------------------- | ---------------------------------------------------- |
| `SYTECHECK_API_KEY`          | _(required)_                | Your `wak_` API key                                  |
| `SYTECHECK_API_URL`          | `https://api.sytecheck.app` | API base URL                                         |
| `SYTECHECK_WAIT_TIMEOUT_MS`  | `60000`                     | How long `run_scan` waits before returning a scan id |
| `SYTECHECK_POLL_INTERVAL_MS` | `3000`                      | Gap between status checks while waiting              |

Note the API host is **`api.sytecheck.app`**, not `sytecheck.app` — the latter
serves the web app and answers API paths with its "page not found" screen.

## Using the API directly

The MCP server is a thin client over a plain HTTP API you can call yourself.

- **[docs/API.md](docs/API.md)** — the full developer guide: authentication,
  submitting scans, polling, webhooks and their signature verification, rate
  limits, and versioning.
- **[public-openapi.json](public-openapi.json)** — the OpenAPI 3.1 spec, for
  generating a client.
- **[examples/](examples/)** — runnable clients in curl, Python, Node, Java, and
  C#, plus a webhook receiver that verifies the delivery signature.
- Interactive docs: [Swagger UI](https://api.sytecheck.app/api/docs) ·
  [ReDoc](https://api.sytecheck.app/api/redoc)

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

To run against a local SyteCheck instance:

```bash
SYTECHECK_API_KEY=wak_… SYTECHECK_API_URL=http://localhost:8000 node dist/index.js
```

The server speaks JSON-RPC over stdin and stdout, so **nothing may be written to
stdout except protocol messages** — a stray `console.log` corrupts the stream and
the client disconnects with an unhelpful parse error. Diagnostics go to stderr.

## Security

See [SECURITY.md](SECURITY.md) for how the key is handled, what a leaked key can
and cannot do, and how to report a vulnerability.

## License

MIT — see [LICENSE](LICENSE). The licence covers this code; the SyteCheck name and
mark are trademarks of Ascent Web Solutions, and use of the service is governed by
its [Terms of Service](https://sytecheck.app/terms).

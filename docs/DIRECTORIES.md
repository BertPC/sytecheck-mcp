# Directory listings

Where this server is listed, how it got there, and what a release has to redo.
[PUBLISHING.md](PUBLISHING.md) covers the two channels that are part of cutting a
release; this file covers the one-time submissions around them.

Most directories crawl rather than accept submissions, and nearly all of them
crawl _the official MCP Registry_. Publishing there is the step that feeds the
long tail, so it is the one that matters.

## State

| Where                                                                  | Status                                | Per release                                 |
| ---------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| [npm](https://www.npmjs.com/package/@ascentws/sytecheck-mcp)           | published                             | `npm publish`                               |
| [MCP Registry](https://registry.modelcontextprotocol.io)               | `com.sytecheck/sytecheck-mcp`, active | `mcp-publisher publish`                     |
| [Glama](https://glama.ai/mcp/servers/@BertPC/sytecheck-mcp)            | claimed; tools rated A, maintenance B | nothing — it rebuilds on its own            |
| GitHub Release `.mcpb`                                                 | —                                     | `npm run build:mcpb`, attach to the release |
| [mcp.so](https://mcp.so)                                               | —                                     | nothing once listed                         |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | —                                     | nothing once merged                         |
| Smithery                                                               | blocked, see below                    | —                                           |
| PulseMCP                                                               | submissions paused upstream           | —                                           |
| GitHub MCP Registry                                                    | not open to submissions               | —                                           |

Checking the registry took a release:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.sytecheck/sytecheck-mcp"
```

## Glama

Indexed automatically — Glama found this repo without being told. It clones the
repo, builds it in a sandbox, introspects the protocol, and grades the tool
definitions; a low grade is a real signal, and the first one it gave us was an F
on the licence because `LICENSE` was not machine-detectable as MIT.

The listing is claimed under the maintainer's Glama account, which is what moves
it out of the anonymous-crawl tier. No `glama.json` is needed: that file exists to
name maintainers when the repo belongs to a GitHub **organization**, and `BertPC`
is a personal account, so the GitHub OAuth check on the repo is the whole proof.

The README score badge is served per-repo and updates itself, so it needs no
maintenance.

## mcp.so

Submissions are plain GitHub issues on
[chatmcp/mcpso](https://github.com/chatmcp/mcpso/issues) — no template. Include
the repo URL, homepage, the `npx -y @ascentws/sytecheck-mcp` snippet with
`SYTECHECK_API_KEY`, stdio transport, the tool count, the licence, and the icon
URL from `server.json`.

## awesome-mcp-servers

Fork and PR against `README.md` on
[punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers),
per its `CONTRIBUTING.md`. Worth the effort out of proportion to its size because
a long tail of smaller directories scrapes that file rather than the registry.

Two things their guide asks for that are easy to miss: entries are alphabetical
within their category, and an agent-authored PR should append `🤖🤖🤖` to the title
to opt into their fast-track review. Our entry sits under **📊 Monitoring**.

## Smithery — blocked

Smithery lists either a hosted URL or an `.mcpb` bundle
(`smithery mcp publish <bundle>.mcpb -n ascentws/sytecheck`). We have the bundle,
but [smithery-ai/cli#787](https://github.com/smithery-ai/cli/issues/787) rejects
any bundle whose manifest declares tools — ours declares six, and dropping them
to get past the check would make the bundle describe itself less accurately for
the sake of one listing. Recheck the issue; it was still open as of 2026-09-11.

## What needs a remote server

Anthropic's Connectors Directory and OpenAI's ChatGPT app directory both require a
server they can reach over the network — Streamable HTTP over HTTPS, with OAuth
2.1. A stdio npm package is not eligible for either at any quality level, so
neither is reachable from this repo alone.

Worth knowing before that work is scheduled: Anthropic's submission flow lives in
claude.ai organization settings and needs a **Team or Enterprise** plan, and
OpenAI's needs domain verification plus a demo video covering web _and_ mobile.
One thing already in place for both is tool annotations — every tool in
`src/tools.ts` carries `title`, `readOnlyHint` and `openWorldHint`, and `run_scan`
is correctly marked not read-only, which Anthropic's review checks for.

Hosted (remote) server work is on hold at this point, but planned for the nearish future, once the main product gets more serious traffic. If anyone out there is interested in leveraging this feature, please [reach out to Erik](https://sytecheck.app/contact) at Ascent Web Solutions.

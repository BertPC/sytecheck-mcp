# The remote server

`mcp.sytecheck.app/mcp` serves the same tools and prompt as the npm package,
over Streamable HTTP, from a Cloudflare Worker in [`worker/`](../worker). It
exists because Anthropic's Connectors Directory and OpenAI's ChatGPT app
directory only list servers they can reach over the network
([DIRECTORIES.md](DIRECTORIES.md#what-needs-a-remote-server)).

## How it works

- **One tool surface.** The Worker builds its server with `createServer()` from
  `src/server.ts`, the same function the stdio entry point uses. There is no
  second copy of the tools to drift.
- **Stateless.** Each POST builds a fresh server and answers with JSON. There
  are no sessions, so `GET` and `DELETE` get a 405.
- **No credential of its own.** The caller's bearer token is forwarded to
  `api.sytecheck.app` as is, and the API decides what it may do. A request with
  no token gets a `401` with a `WWW-Authenticate` challenge, which is what tells
  a client to start its auth flow.
- **Origin check.** A request that sends an `Origin` header must match
  `ALLOWED_ORIGINS` in `worker/wrangler.jsonc` (empty by default). Server-side
  clients, including Claude, ChatGPT and MCP Inspector's proxy, send no Origin
  and are unaffected.
- **Workers runtime constraint.** The SDK's default JSON Schema validator (Ajv)
  generates code at runtime, which Workers forbids, so the Worker passes
  `CfWorkerJsonSchemaValidator` instead.

## Running it

```bash
npm run worker:dev        # local, on workerd, at http://localhost:8787/mcp
npm run worker:typecheck  # also run in CI
npm run worker:deploy     # needs `wrangler login` on the Cloudflare account
```

The first deploy creates the `mcp.sytecheck.app` custom domain, including its DNS
record and certificate. That only works if `sytecheck.app` is a zone on the same
Cloudflare account.
Rerun `npx wrangler types` inside `worker/` after changing `wrangler.jsonc`.

To try it as a client, point MCP Inspector at the URL with
`Authorization: Bearer sck_…`, or add it as a custom connector in Claude.

## Not done yet

- **OAuth 2.1.** Right now only `sck_` keys work, sent as a bearer token. The
  directories need OAuth: authorization, token and client-registration endpoints
  in the SyteCheck API, plus a protected-resource metadata document served here
  and named in the 401 challenge. Tokens the API issues will pass straight through
  this Worker unchanged.
- **The `remotes` entry in `server.json`** and the awesome-remote-mcp-servers
  listing (plan step B5) come once OAuth is live.

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
  `api.sytecheck.app` as is, and the API decides what it may do. That token is
  either an OAuth access token (`sco_…`) or an API key (`sck_…`); the API bounds
  both the same way.
- **OAuth.** Users connect with OAuth 2.1, and the SyteCheck API is the
  authorization server (its `docs/reference/OAUTH.md`). This Worker's part:
  - It publishes `/.well-known/oauth-protected-resource` (RFC 9728), and the
    `/mcp` path-suffixed form, naming the API as the authorization server.
  - A request with no token gets a `401` whose `WWW-Authenticate` challenge
    names that document, which is how a client starts its sign-in flow.
  - Before serving, it checks the token with `GET /users/me`. A `401` there
    becomes an HTTP `401` with `error="invalid_token"`, which is what makes a
    client refresh. Without the check, the tools would report it inside a
    `200`. A `403` or an unreachable API passes through: a write-only token is
    still valid, and the tools report outages themselves. The check costs one
    API request per MCP message.
- **`MCP_RESOURCE_URL` must equal the API's `OAUTH_RESOURCE_URL`**, or the API
  refuses every token. It is configured rather than read from the request,
  because under `wrangler dev` the request URL carries the route's host.
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

To try it as a client, add it as a custom connector in Claude, which runs the
OAuth flow, or point MCP Inspector at it with `Authorization: Bearer sck_…`.

Against a local API, override the two URLs. The API's defaults expect the
Worker at `http://localhost:8787/mcp`:

```bash
npx wrangler dev -c worker/wrangler.jsonc --port 8787 \
  --var SYTECHECK_API_URL:http://localhost:8000 \
  --var MCP_RESOURCE_URL:http://localhost:8787/mcp
```

## Not done yet

- **The `remotes` entry in `server.json`** and the awesome-remote-mcp-servers
  listing (plan step B5) wait until the API's OAuth changes are deployed and this
  Worker is live.

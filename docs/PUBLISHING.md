# Publishing a release

Two registries, in a fixed order: **npm first, then the MCP Registry.** The MCP
Registry stores only metadata — it fetches the npm tarball to verify that we own
the name we are claiming, so the npm version has to exist before the registry
call is made.

## The one thing that is easy to get wrong

`package.json` must carry an `mcpName` field equal to `server.json`'s `name`:

```json
"mcpName": "com.sytecheck/sytecheck-mcp"
```

That field is the entire ownership proof. The registry downloads the published
tarball, reads its `package.json`, and refuses the publish with _"Registry
validation failed for package"_ if the field is missing or different.

It has to be in the **published** tarball, so discovering it late means burning a
version number: npm does not allow a version to be republished. `npm run test`
covers this — `src/manifest.test.ts` asserts the two files agree on the name, the
package identifier and the version — but the check only helps if it runs before
`npm publish`, which is why the checklist below puts it first.

## Checklist

```bash
# 1. Bump both files together. They must state the same version.
#    package.json:  "version"
#    server.json:   "version" and packages[0].version
$EDITOR package.json server.json

# 2. Verify. The manifest test fails if the two files disagree.
npm ci
npm run lint && npm run format:check && npm test && npm run build

# 3. Publish to npm. `prepublishOnly` rebuilds dist/ first.
npm publish --access public

# 4. Publish the metadata.
mcp-publisher publish
```

Then confirm the registry took it:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.sytecheck/sytecheck-mcp"
```

## Authenticating to the MCP Registry

The `com.sytecheck` namespace is authenticated by a DNS TXT record on
`sytecheck.com`, not by a GitHub login. This is deliberate: a `com.sytecheck/*`
name reads as first-party, where `io.github.bertpc/*` reads as one person's fork
of somebody else's product.

Install the CLI once:

```bash
brew install mcp-publisher
```

Generate the keypair once, and keep `key.pem` out of this repo — it is the
credential that lets its holder publish under our namespace, and `.gitignore`
covers it as a belt-and-braces measure only:

```bash
openssl genpkey -algorithm Ed25519 -out key.pem
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "sytecheck.com. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

Add that TXT record at the DNS provider for `sytecheck.com` and wait for it to
propagate (`dig +short TXT sytecheck.com` should show it).

Then, before each `mcp-publisher publish`:

```bash
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain sytecheck.com --private-key "${PRIVATE_KEY}"
```

The record stays in place between releases; only the login is repeated, and only
when the saved token has expired.

## What updating the API does not require

`public-openapi.json` and `docs/API.md` are copies of artifacts generated in the
private SyteCheck repo. Changing them here without changing them there is how
the two drift. Update upstream first, copy down, and release the two together.

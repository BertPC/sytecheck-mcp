import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * `server.json` is the MCP Registry's copy of facts that also live in
 * `package.json`, and the registry validates every one of them at publish time:
 * it fetches the named version from npm and checks that *that tarball's*
 * `package.json` carries an `mcpName` equal to the manifest's `name`.
 *
 * Every way those two files can disagree is therefore a failed publish — and a
 * failed publish is expensive, because the npm version has already gone out by
 * then and npm versions cannot be reused. Cheaper to fail here.
 */

const repoRoot = new URL("..", import.meta.url);

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, repoRoot), "utf8"));
}

interface ServerPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
}

describe("server.json", () => {
  const pkg = readJson("package.json");
  const manifest = readJson("server.json");
  const npmPackage = (manifest.packages as ServerPackage[] | undefined)?.find(
    (entry) => entry.registryType === "npm",
  );

  it("declares the mcpName the registry validates ownership against", () => {
    // Without this field in the *published* package, `mcp-publisher publish`
    // fails with "Registry validation failed for package".
    expect(pkg.mcpName).toBe(manifest.name);
  });

  it("names a namespace we can prove we own", () => {
    // com.sytecheck is the reverse-DNS form of sytecheck.com, which is what the
    // publisher's DNS TXT record authenticates. An io.github.* name would work
    // too but reads as a third-party fork of someone else's product.
    expect(manifest.name).toMatch(/^com\.sytecheck\//);
  });

  it("points at the package this repo actually publishes", () => {
    expect(npmPackage).toBeDefined();
    expect(npmPackage?.identifier).toBe(pkg.name);
  });

  it("tracks the version being published", () => {
    // The registry resolves this exact version on npm. A manifest left behind
    // at the previous release republishes stale metadata; one running ahead
    // fails outright because the version does not exist yet.
    expect(manifest.version).toBe(pkg.version);
    expect(npmPackage?.version).toBe(pkg.version);
  });

  it("agrees with the version the running server reports over stdio", () => {
    // Read as text rather than imported: index.ts calls main() at module scope,
    // so importing it would start a server inside the test run. This is the
    // version a client shows in its server list, and nothing else would catch
    // it lagging a release behind.
    const source = readFileSync(new URL("index.ts", import.meta.url), "utf8");
    expect(source).toContain(`const VERSION = "${pkg.version as string}"`);
  });

  it("keeps the description inside the registry's limit", () => {
    // The schema caps `description` at 100 characters, and npm's own
    // description is longer than that — so the two cannot simply be shared.
    expect((manifest.description as string).length).toBeLessThanOrEqual(100);
  });
});

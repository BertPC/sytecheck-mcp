#!/usr/bin/env bash
#
# Assemble the MCP Bundle that Claude Desktop installs in one click.
# Run via `npm run build:mcpb`; see docs/PUBLISHING.md for where it goes.
#
# The bundle is self-contained — it carries its own node_modules, so installing
# it does not need npx or a network round trip the way the README recipes do.
#
#   build/mcpb/manifest.json
#   build/mcpb/server/           compiled dist/
#   build/mcpb/node_modules/     runtime dependencies only
#   build/sytecheck-mcp.mcpb     the packed result
#
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
stage="$root/build/mcpb"

if [ ! -f "$root/dist/index.js" ]; then
  echo "dist/ is missing — run 'npm run build' first." >&2
  exit 1
fi

rm -rf "$stage"
mkdir -p "$stage/server"

cp "$root/mcpb/manifest.json" "$stage/manifest.json"
cp "$root/README.md" "$root/LICENSE" "$stage/"
cp -R "$root/dist/." "$stage/server/"

# package.json travels with the bundle because dist/ is ESM and Node needs the
# "type": "module" declaration to load it. The lockfile is only here so that
# `npm ci` installs the exact versions this repo tests against; it is dropped
# again afterwards rather than shipped.
cp "$root/package.json" "$root/package-lock.json" "$stage/"
npm ci --omit=dev --ignore-scripts --prefix "$stage"
rm "$stage/package-lock.json"

npx mcpb validate "$stage/manifest.json"
npx mcpb pack "$stage" "$root/build/sytecheck-mcp.mcpb"

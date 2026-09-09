# Security Policy

## Reporting a vulnerability

Email **website@ascentwebs.com** with the details. Please do not open a public
issue for anything exploitable.

Include what you did, what happened, and what you expected. A proof of concept
helps. You will get an acknowledgement within a few business days.

Please do not run automated scanners against the SyteCheck API to look for
issues — the rate limits are there to protect a small service, and a scan run
against it is indistinguishable from abuse. If you need scope to test something,
ask first.

## What this server does with your API key

The key is read once from `SYTECHECK_API_KEY` at startup and sent as a bearer
token to the configured API host. It is never written to disk, never logged, and
is deliberately kept out of error messages — a tool error from an MCP server is
handed to a model and often ends up in a transcript or a bug report, so
`src/client.ts` reports only the origin of a failed request, never the request
itself. There is a test asserting that.

## What a leaked key can do

A SyteCheck API key is scoped, and scoped narrowly:

- It reaches the scan endpoints, `GET /users/me`, and `GET /users/me/usage`, and
  nothing else. Key management, billing, account changes, credential changes and
  the admin API all refuse it.
- A `scans:read` key cannot create or delete scans at all. **Prefer one for
  anything unattended**, including anything an agent drives on a loop.
- Revocation is immediate and permanent, from Account → API keys.

So a leaked key can read your scan history and, if it carries `scans:write`,
spend your monthly scan quota. It cannot take over the account, change your
email or password, spend money, or lock you out.

If you believe a key has leaked, revoke it. There is no way to un-revoke, which
is deliberate.

## Supported versions

Fixes go to the latest published version on npm. This is a thin client over a
hosted API; if a fix is needed on the service side it ships there and no client
update is required.

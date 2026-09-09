# SyteCheck — Public API Guide

The SyteCheck public API lets you run comprehensive, scored website audits
programmatically. This guide walks through authenticating with an API key,
submitting a scan, polling for the result, and receiving webhooks.

## Base URL

The API is served from **`https://api.sytecheck.app`** — a different host from the
web app at `https://sytecheck.app`, which serves only the single-page application.
Requesting an API path on the app's host returns the SPA's "page not found" screen
rather than an API response.

Interactive reference docs are served from the running API at:

- Swagger UI — <https://api.sytecheck.app/api/docs>
- ReDoc — <https://api.sytecheck.app/api/redoc>
- OpenAPI schema — <https://api.sytecheck.app/api/openapi.json>

Examples below use the production host. When working against a local development
server, substitute `http://localhost:8000`.

---

## 1. Authentication

Every `/api/v1` route accepts **either** a session JWT (used by the web app) **or**
a personal **API key**. Send the credential as a bearer token:

```
Authorization: Bearer <token>
```

API keys carry a recognisable `wak_` prefix so the server can tell them apart from
JWTs.

### Generating an API key

From the web app: **Account → API keys → Create key**. The full secret is shown
**once** at creation — store it securely; it is never retrievable again.

Or create one over the API. **Key management requires a session JWT** — an existing
API key cannot mint, list, or revoke keys (see *What a key can reach* below):

```bash
curl -X POST https://api.sytecheck.app/api/v1/keys \
  -H "Authorization: Bearer <session-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"label": "CI pipeline", "scopes": ["scans:read", "scans:write"]}'
```

```json
{
  "id": 12,
  "label": "CI pipeline",
  "key_prefix": "wak_a1b2c3",
  "scopes": ["scans:read", "scans:write"],
  "is_active": true,
  "request_count": 0,
  "scan_count": 0,
  "created_at": "2026-06-14T12:00:00Z",
  "last_used_at": null,
  "revoked_at": null,
  "api_key": "wak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

The `api_key` field is the secret. Every other field is also returned by the
listing endpoint, which never re-exposes the secret.

### Scopes

`scopes` is optional and defaults to both values. It controls what the key may do:

| Scope | Grants |
|---|---|
| `scans:read` | List and read scans, reports, trends, categories, and your plan usage |
| `scans:write` | Create, rename, and delete scans |

**Prefer a `scans:read`-only key for anything unattended.** Creating a scan spends
real quota, so a read-only key is the safer thing to hand to an agent, a shared
dashboard, or a job that might retry in a loop.

### What a key can reach

A key is **not** a general-purpose credential for your account. Whatever its scopes,
it can only reach the scan endpoints in §5 plus `GET /users/me` and
`GET /users/me/usage`. Everything else answers `403`:

- **Key management** (`/api/v1/keys`) — otherwise a leaked key could mint replacements
  and outlive its own revocation.
- **Billing** — checkout, plan changes, cancellation, the customer portal.
- **Account changes** — `PATCH`/`DELETE /users/me`, email and password changes, and
  the webhook signing secret.
- **The admin API**, on every account without exception.

These need an interactive session. The practical consequence: a key pasted into a
CI variable or an MCP client config cannot be used to take over the account, spend
money, or lock you out.

### Managing keys

Requires a session JWT, not a key.

| Method & path | Purpose |
|---|---|
| `POST /api/v1/keys` | Create a key (returns the secret once) |
| `GET /api/v1/keys` | List your keys with scopes and lifetime usage counts |
| `DELETE /api/v1/keys/{id}` | Revoke a key (permanent, effective immediately) |

---

## 2. Submitting a scan

```bash
curl -X POST https://api.sytecheck.app/api/v1/scans \
  -H "Authorization: Bearer wak_..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "label": "Homepage audit",
    "categories": ["seo", "security_headers", "performance"]
  }'
```

`categories` is optional — omit it to run every category **your plan includes**.
Fetch the list from `GET /api/v1/scans/categories` (authenticated): it returns every
category with its description and weight, plus an `included` flag saying whether your
plan may run it, and a `plan` field naming your tier. Requesting a category your plan
withholds returns `403` naming the categories in question; an unrecognised category ID
returns `422`.

The response returns immediately as **`201 Created`** with status `queued`:

```json
{
  "id": 345,
  "url": "https://example.com",
  "label": "Homepage audit",
  "status": "queued",
  "categories_requested": ["seo", "security_headers", "performance"],
  "overall_score": null,
  "error_message": null,
  "webhook_url": null,
  "quota_refunded_at": null,
  "created_at": "2026-06-14T12:00:00Z",
  "completed_at": null
}
```

---

## 3. Polling for completion

Poll `GET /api/v1/scans/{id}` until `status` is `complete` or `failed`:

```bash
curl https://api.sytecheck.app/api/v1/scans/345 \
  -H "Authorization: Bearer wak_..."
```

Status transitions: `queued → scanning → summarizing → complete` (or `failed`).
The `summarizing` state covers generation of the AI executive summary after all
category analyses have finished.

Once complete, fetch the full structured report — an `executive_summary` (an overview
plus recommended actions), per-category `findings`, a `metrics` array of measured values
where the analyzer produces them, the `score_breakdown`, and pre-signed screenshot URLs:

```bash
curl https://api.sytecheck.app/api/v1/scans/345/report \
  -H "Authorization: Bearer wak_..."
```

A PDF version is available at `GET /api/v1/scans/{id}/report/pdf`.

**Both report routes are localizable.** Report content is stored in English and translated
on demand: pass `?lang=` (e.g. `?lang=de`), or send an `Accept-Language` header and it is
honoured. Any translation failure falls back to English rather than erroring.

### Streaming instead of polling

`GET /api/v1/scans/{id}/stream` is a Server-Sent Events endpoint: it emits a `status`
event on every status change and a final `done` event at a terminal state. It gives up
after five minutes with a `timeout` event, so treat it as a fast path and keep polling as
the fallback for long scans.

### Category result statuses

Each category in a report carries its own `status`:

| Status | Meaning |
|---|---|
| `pass` / `warn` / `fail` | the category was analyzed; band reflects its `score` |
| `error` | the analyzer failed, or the site was unreachable (DNS/TCP/TLS) |
| `blocked` | the site's WAF/bot protection **refused automated access**, so this category could not be analyzed |

A `blocked` (or `error`) category has `score: null` and is **excluded from
`overall_score`** — it is not counted as a failed check. `blocked` is common when
scanning sites behind aggressive bot protection (Cloudflare, WordPress.com, etc.);
its `summary` explains the block and, when known, names the protection vendor.
Retrying the scan a few minutes later often succeeds, as such blocks are frequently
intermittent. If **every** requested category is blocked or errored, the scan's
top-level `status` is `failed` and `error_message` explains why.

A scan can also fail *before* any category runs, when the URL cannot be reached at
all (DNS, TCP, or TLS failure). Such a scan carries a non-null `quota_refunded_at`
and **costs you nothing** — it does not consume monthly quota, and a one-off scan
credit spent on it is returned. A scan whose categories all failed or were blocked
did run, so it is charged and `quota_refunded_at` stays `null`. Note that a
preflight failure sends **no webhook**, since delivery happens at the end of the
fan-out that never started — poll for this case.

---

## 4. Webhooks

> **Agency plan only.** Every other plan can submit scans through the API but must poll
> (§3) or read the event stream for completion; a `webhook_url` on a plan without the
> entitlement is refused with `403` and the scan is not created. Retry the request
> without the field.

Pass a `webhook_url` when submitting a scan to receive the result by HTTP POST as
soon as the scan finishes — no polling required:

```bash
curl -X POST https://api.sytecheck.app/api/v1/scans \
  -H "Authorization: Bearer wak_..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "webhook_url": "https://your-app.example.com/hooks/scan-complete"
  }'
```

When the scan reaches a terminal state, the worker POSTs this payload to your URL:

```json
{
  "event": "scan.completed",
  "scan_id": 345,
  "url": "https://example.com",
  "label": "Homepage audit",
  "status": "complete",
  "overall_score": 87.5,
  "completed_at": "2026-06-14T12:03:21Z",
  "categories": [
    { "category": "seo", "status": "pass", "score": 92.0, "summary": "..." }
  ]
}
```

Your endpoint should respond with a `2xx` status.

**Retries are not universal.** Timeouts, connection errors, `429`, and any `5xx` are
retried with exponential backoff — up to five retries, so **six attempts** in total.
Every *other* `4xx` is treated as **permanent and is never retried**: a `400`, `404`, or
`410` from your endpoint means the delivery is logged as an error and dropped. If your
receiver is temporarily unhealthy, fail with a `503` rather than a `400`, or the
notification is gone for good.

After receiving a webhook, call `GET /api/v1/scans/{id}/report` for the full
findings.

### Verifying the signature

**Your webhook URL is not a secret** — anyone who learns it can POST to it. Every
delivery therefore carries an HMAC-SHA256 signature over the exact bytes sent, keyed
on a secret only your account and SyteCheck can compute. **Verify it before trusting
a payload**, or treat the delivery as nothing more than a hint to go and poll.

Two headers arrive with every delivery:

```
X-SyteCheck-Timestamp: 1781452800
X-SyteCheck-Signature: t=1781452800,v1=6f3a...c21
```

Read your signing secret from `GET /users/me/webhook-secret`. It looks like
`whsec_<hex>`, is the same for every scan on your account, and — unlike an API key —
can be read as many times as you like. Rotate it with
`POST /users/me/webhook-secret/rotate`; there is **no overlap window**, so update your
receiver first.

The signed message is the literal string `"{timestamp}:"` followed by the raw request
body. Two mistakes account for nearly every failed verification:

1. **Sign the raw body, not a re-serialization.** Parsing the JSON and dumping it
   again changes whitespace and key order, and the digest will never match. Most
   frameworks require an explicit opt-in to see the raw bytes.
2. **Compare in constant time.** A plain `==` leaks the expected digest a byte at a
   time to anyone who can send deliveries and measure your response.

Reject a delivery whose timestamp is more than **300 seconds** from your clock; that
is what stops a captured request being replayed indefinitely.

```python
# Python
import hashlib, hmac, time

def verify(raw_body: bytes, signature_header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in signature_header.split(",") if "=" in p)
    ts, provided = parts.get("t"), parts.get("v1")
    if not ts or not provided or abs(time.time() - int(ts)) > 300:
        return False
    expected = hmac.new(
        secret.encode(), f"{ts}:".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, provided)
```

```javascript
// Node
const crypto = require("crypto");

function verify(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=")),
  );
  const { t, v1 } = parts;
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${t}:`), rawBody]))
    .digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

```java
// Java (JDK 11+, no dependencies)
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

static boolean verify(byte[] rawBody, String signatureHeader, String secret)
        throws Exception {
    Map<String, String> parts = new HashMap<>();
    for (String p : signatureHeader.split(",")) {
        String[] kv = p.split("=", 2);
        if (kv.length == 2) parts.put(kv[0].trim(), kv[1].trim());
    }
    String ts = parts.get("t"), provided = parts.get("v1");
    if (ts == null || provided == null) return false;

    long signedAt;
    try {
        signedAt = Long.parseLong(ts);
    } catch (NumberFormatException e) {
        return false;  // Malformed input is a rejection, never an exception.
    }
    if (Math.abs(System.currentTimeMillis() / 1000 - signedAt) > 300) return false;

    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    mac.update((ts + ":").getBytes(StandardCharsets.UTF_8));
    mac.update(rawBody);
    StringBuilder expected = new StringBuilder();
    for (byte b : mac.doFinal()) expected.append(String.format("%02x", b));

    // MessageDigest.isEqual is the constant-time comparison in the JDK.
    return MessageDigest.isEqual(
        expected.toString().getBytes(StandardCharsets.UTF_8),
        provided.getBytes(StandardCharsets.UTF_8));
}
```

```csharp
// C# / .NET
using System.Linq;
using System.Security.Cryptography;
using System.Text;

static bool Verify(byte[] rawBody, string signatureHeader, string secret)
{
    var parts = new Dictionary<string, string>();
    foreach (var segment in signatureHeader.Split(','))
    {
        // Not ToDictionary: a header carrying a duplicate key would throw, and a
        // malformed delivery must be rejected rather than raise.
        var kv = segment.Split('=', 2);
        if (kv.Length == 2) parts[kv[0].Trim()] = kv[1].Trim();
    }

    if (!parts.TryGetValue("t", out var ts) || !parts.TryGetValue("v1", out var provided))
        return false;
    if (!long.TryParse(ts, out var signedAt))
        return false;
    if (Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - signedAt) > 300)
        return false;

    var message = Encoding.UTF8.GetBytes($"{ts}:").Concat(rawBody).ToArray();
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var expected = Convert.ToHexString(hmac.ComputeHash(message)).ToLowerInvariant();

    return CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(provided));
}
```

---

## 5. Endpoint reference

Everything an API key can reach. Note that `/users/me/usage` is **not** under the
`/api/v1` prefix — first-party account routes are mounted unversioned, and the path
below is literal.

| Method & path | Purpose |
|---|---|
| `GET /api/v1/scans/categories` | Categories, weights, and an `included` flag per your plan |
| `POST /api/v1/scans` | Submit a scan (`201 Created`) |
| `GET /api/v1/scans` | List your scans; paginated, supports `?q=` and `?status=` |
| `GET /api/v1/scans/{id}` | One scan with its per-category results |
| `PATCH /api/v1/scans/{id}` | Update editable fields (currently the label) |
| `DELETE /api/v1/scans/{id}` | Soft-delete a scan (`204`; does **not** refund quota) |
| `GET /api/v1/scans/{id}/report` | Full structured report; accepts `?lang=` |
| `GET /api/v1/scans/{id}/report/pdf` | Same report as PDF; accepts `?lang=` |
| `GET /api/v1/scans/{id}/stream` | Server-Sent Events status stream |
| `GET /api/v1/scans/trends` | Score trends across your scan history |
| `GET /api/v1/scans/recent-duplicate` | Whether you recently scanned the same URL |
| `GET /api/v1/billing/plans` | Plan definitions and list prices |
| `GET /users/me/usage` | Your plan's limits, month-to-date usage, credit balance |
| `GET /users/me/webhook-secret` | Your webhook signing secret (Agency; re-readable) |
| `POST /users/me/webhook-secret/rotate` | Issue a new signing secret, invalidating the old one |

---

## 6. Plans and rate limits

**The API is available on every plan, including Free.** Create an account, verify your
email, mint a key, and you can call every endpoint below — no subscription required.

An API key grants **no allowance of its own**: it reaches exactly the monthly quota and
the category set your plan already has. On Free that is 3 scans a month across `visual`,
`seo`, and `content_freshness` — enough to try an integration end to end against a real
site before deciding whether to pay for one.

**Webhooks are the exception, and require an Agency plan.** Passing a `webhook_url` on
any other plan returns `403`; the scan itself is fine on every plan, so poll or use the
event stream (§3) instead.

Scans submitted through the API draw on the **same monthly quota** as scans submitted
through the web application — the API is a different way in, not extra allowance. The
quota runs on the calendar month (UTC) and does not roll over; deleting a scan does not
restore quota. A daily burst cap applies as well. Current per-plan figures are in the
[Terms of Service](./legal/TERMS_OF_SERVICE.md) §6.

Exceeding a limit returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 3600
```

The `Retry-After` header gives the number of seconds until the window resets. On the
monthly cap that is the time until the calendar month rolls over. A separate per-plan
concurrent-scan quota also applies and likewise returns `429`.

Entitlements that aren't quotas — category access, PDF export, webhooks, and API access
itself — return `403` with a message naming the plan and what it lacks, since retrying
cannot help. Checking `GET /users/me/usage` returns your plan's limits and your
month-to-date consumption, which is the cheapest way to avoid both.

### One-off scan credits

A purchased one-off scan grants a credit that buys a single scan across **all** analysis
categories, outside your monthly quota and regardless of your plan. Spend one by sending
`"use_scan_credit": true` on `POST /api/v1/scans`.

Credits are **never** spent implicitly. Omitting the field — or sending `false` — means a
scan that would exceed your monthly quota returns `429` rather than quietly consuming a
credit you were saving. Requesting a credit you do not have returns `403`. Your unspent
balance is the `scan_credits` field of `GET /users/me/usage`.

### Per-site scan pacing

To avoid overwhelming a target site (and tripping its WAF), scans of the *same
website* are paced across all callers: a scan may be **accepted but start after a
short delay** rather than immediately. This is transparent — the scan is created
in `queued` state and begins automatically once its slot is reached; no action is
needed. Only when a single site is being scanned so frequently that the delay would
be excessive is the request rejected with `429` (with `Retry-After`); retry after
the indicated interval.

---

## 7. Versioning

The public API is versioned in the path (`/api/v1`). The `v1` contract — request
and response shapes documented here and in the OpenAPI schema — is stable.
Breaking changes will be introduced under a new version prefix; `v1` will continue
to function for a documented deprecation period before removal.

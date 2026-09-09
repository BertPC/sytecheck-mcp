#!/usr/bin/env python3
"""A webhook receiver that verifies the delivery signature.

    export SYTECHECK_WEBHOOK_SECRET=whsec_...   # GET /users/me/webhook-secret
    python webhook_receiver.py                  # listens on :8080

Then submit a scan with "webhook_url" pointing at this receiver (Agency plan).

**Verify before trusting.** The webhook URL is not a secret — it travels in the
scan-create request — so anyone who learns it can POST to it. The signature is
what distinguishes a real delivery.

Two mistakes account for nearly every failed verification, and this file exists
mostly to show both being avoided:

  1. **Sign the raw body, not a re-serialization.** Parsing the JSON and dumping
     it again changes whitespace and key order, and the digest will never match.
     Note this reads `rfile` directly and only parses *after* verifying.
  2. **Compare in constant time.** `hmac.compare_digest`, never `==`.

Standard library only.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = os.environ.get("SYTECHECK_WEBHOOK_SECRET", "")
PORT = int(os.environ.get("PORT", "8080"))

# Reject a delivery signed longer ago than this. Matches what the API documents,
# and is what stops a captured request being replayed indefinitely.
MAX_AGE_SECONDS = 300


def verify(raw_body: bytes, signature_header: str | None, secret: str) -> bool:
    """Return True only if the signature is present, fresh, and correct."""
    if not secret or not signature_header:
        return False

    parts = dict(
        segment.split("=", 1)
        for segment in signature_header.split(",")
        if "=" in segment
    )
    timestamp, provided = parts.get("t"), parts.get("v1")
    if not timestamp or not provided:
        return False

    try:
        signed_at = int(timestamp)
    except ValueError:
        return False
    # Symmetric: a future-dated timestamp is clock skew, not evidence of anything.
    if abs(time.time() - signed_at) > MAX_AGE_SECONDS:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}:".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, provided)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler's naming
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)

        if not verify(raw_body, self.headers.get("X-SyteCheck-Signature"), SECRET):
            # 400 is permanent: SyteCheck will not retry it. That is correct for a
            # signature failure — a redelivery of the same bytes would fail too.
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"invalid signature")
            print("REJECTED a delivery with a bad or missing signature")
            return

        payload = json.loads(raw_body)
        print(
            f"{payload['event']}: scan {payload['scan_id']} for {payload['url']} "
            f"-> {payload['status']} (score {payload.get('overall_score')})"
        )
        for category in payload.get("categories", []):
            print(f"    {category['category']}: {category['status']} {category['score']}")

        # Respond 2xx promptly. If your processing is slow, acknowledge first and
        # work afterwards — and if you are temporarily unhealthy, answer 503, not
        # 400: only timeouts, 429 and 5xx are retried, every other 4xx is dropped
        # permanently.
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args: object) -> None:
        """Silence the default per-request logging; we print what matters above."""


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit(
            "Set SYTECHECK_WEBHOOK_SECRET. Read it from GET /users/me/webhook-secret."
        )
    print(f"Listening on :{PORT} — point a scan's webhook_url here.")
    HTTPServer(("", PORT), Handler).serve_forever()

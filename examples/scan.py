#!/usr/bin/env python3
"""Submit a scan, poll until it finishes, print the report.

    pip install httpx
    export SYTECHECK_API_KEY=sck_...
    python scan.py https://example.com

Uses httpx because it is what most Python services already have; the standard
library's urllib would work identically.
"""

from __future__ import annotations

import os
import sys
import time

import httpx

API_URL = os.environ.get("SYTECHECK_API_URL", "https://api.sytecheck.app")
API_KEY = os.environ.get("SYTECHECK_API_KEY")

# A scan runs a browser and a Lighthouse audit, so minutes is normal.
POLL_INTERVAL_SECONDS = 5
TIMEOUT_SECONDS = 600
TERMINAL = {"complete", "failed"}


def main(url: str) -> int:
    if not API_KEY:
        print("Set SYTECHECK_API_KEY (Account → API keys).", file=sys.stderr)
        return 1

    client = httpx.Client(
        base_url=API_URL,
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=30.0,
    )

    created = client.post("/api/v1/scans", json={"url": url})
    if created.status_code == 403:
        # Distinguishing this is worth the three lines: a 403 never becomes a 200
        # by retrying, whereas a 429 does.
        print(f"Refused: {created.json().get('detail')}", file=sys.stderr)
        return 1
    if created.status_code == 429:
        retry = created.headers.get("retry-after", "?")
        print(f"Quota or rate limit reached; retry after {retry}s.", file=sys.stderr)
        return 1
    created.raise_for_status()

    scan_id = created.json()["id"]
    print(f"Scan {scan_id} queued for {url}", file=sys.stderr)

    deadline = time.monotonic() + TIMEOUT_SECONDS
    status = created.json()["status"]
    while status not in TERMINAL:
        if time.monotonic() > deadline:
            print(f"Gave up waiting; scan {scan_id} is still {status}.", file=sys.stderr)
            return 1
        time.sleep(POLL_INTERVAL_SECONDS)
        scan = client.get(f"/api/v1/scans/{scan_id}").raise_for_status().json()
        if scan["status"] != status:
            status = scan["status"]
            print(f"  … {status}", file=sys.stderr)

    if status == "failed":
        scan = client.get(f"/api/v1/scans/{scan_id}").json()
        print(f"Scan failed: {scan.get('error_message')}", file=sys.stderr)
        return 1

    report = client.get(f"/api/v1/scans/{scan_id}/report").raise_for_status().json()
    print(f"\n{report['url']} — overall score {report['overall_score']}/100\n")
    for category in report["categories"]:
        score = "n/a" if category["score"] is None else f"{category['score']:.0f}"
        print(f"{category['category']:<20} {category['status']:<8} {score:>5}")
        for finding in category["findings"][:3]:
            print(f"    [{finding['severity']}] {finding['title']}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: scan.py <url>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))

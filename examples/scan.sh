#!/usr/bin/env bash
# Submit a scan, poll until it finishes, print the report.
#
#   export SYTECHECK_API_KEY=sck_...
#   ./scan.sh https://example.com
#
# Needs curl and jq.

set -euo pipefail

API_URL="${SYTECHECK_API_URL:-https://api.sytecheck.app}"
URL="${1:-}"

if [[ -z "$URL" ]]; then
  echo "usage: $0 <url>" >&2
  exit 2
fi
if [[ -z "${SYTECHECK_API_KEY:-}" ]]; then
  echo "Set SYTECHECK_API_KEY (Account -> API keys)." >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${SYTECHECK_API_KEY}")

# -w writes the status on its own last line so a non-200 can be reported with the
# body rather than silently parsed as JSON that isn't there.
response=$(curl -sS -X POST "${API_URL}/api/v1/scans" \
  "${auth[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${URL}\"}" \
  -w $'\n%{http_code}')

status_code=$(tail -n1 <<<"$response")
body=$(sed '$d' <<<"$response")

if [[ "$status_code" != "201" ]]; then
  # 403 never becomes 201 by retrying; 429 does, after Retry-After.
  echo "Request failed (HTTP ${status_code}): $(jq -r '.detail // .' <<<"$body")" >&2
  exit 1
fi

scan_id=$(jq -r '.id' <<<"$body")
echo "Scan ${scan_id} queued for ${URL}" >&2

# A scan runs a browser and a Lighthouse audit, so minutes is normal.
deadline=$((SECONDS + 600))
scan_status=$(jq -r '.status' <<<"$body")

while [[ "$scan_status" != "complete" && "$scan_status" != "failed" ]]; do
  if (( SECONDS > deadline )); then
    echo "Gave up waiting; scan ${scan_id} is still ${scan_status}." >&2
    exit 1
  fi
  sleep 5
  next=$(curl -sS "${API_URL}/api/v1/scans/${scan_id}" "${auth[@]}" | jq -r '.status')
  if [[ "$next" != "$scan_status" ]]; then
    scan_status="$next"
    echo "  ... ${scan_status}" >&2
  fi
done

if [[ "$scan_status" == "failed" ]]; then
  message=$(curl -sS "${API_URL}/api/v1/scans/${scan_id}" "${auth[@]}" | jq -r '.error_message')
  echo "Scan failed: ${message}" >&2
  exit 1
fi

curl -sS "${API_URL}/api/v1/scans/${scan_id}/report" "${auth[@]}" | jq -r '
  "\(.url) — overall score \(.overall_score)/100\n",
  (.categories[] |
    "\(.category)\t\(.status)\t\(.score // "n/a")",
    (.findings[:3][] | "    [\(.severity)] \(.title)"))
'

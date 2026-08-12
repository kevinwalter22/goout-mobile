#!/usr/bin/env bash
# Fetch read-only prod health + curation scorecard into ./audit-inputs/ for the
# auditor worker's Claude step. The prod service-role key lives ONLY in this
# step's env — never in the Claude step (security separation). Never fails the
# job: a missing/errored input is reported by the auditor, not a crash.
set -uo pipefail
mkdir -p audit-inputs

if [ -z "${REF:-}" ] || [ -z "${KEY:-}" ]; then
  echo '{"note":"SUPABASE_PROD_* not set — auditor runs without live catalog data"}' \
    > audit-inputs/_no_secrets.json
  exit 0
fi

base="https://$REF.supabase.co/functions/v1"

post () {
  local fn="$1"
  code=$(curl -sS -X POST "$base/$fn" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{}' \
    -o "audit-inputs/$fn.json" -w "%{http_code}" || echo 000)
  echo "$fn (POST) -> HTTP $code"
}

get () {
  local fn="$1"
  code=$(curl -sS "$base/$fn" \
    -H "Authorization: Bearer $KEY" \
    -o "audit-inputs/$fn.json" -w "%{http_code}" || echo 000)
  echo "$fn (GET) -> HTTP $code"
}

# audit-curation-quality is deployed with this batch; until the gated prod
# deploy lands it will 404, and the auditor notes it rather than failing.
post audit-curation-quality
post monitor-data-quality
post monitor-pipeline-health
post monitor-api-budgets
get  health-summary

exit 0

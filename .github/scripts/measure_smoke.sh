#!/usr/bin/env bash
# Toolchain smoke for the measurement harness: export the Expo web build and
# screenshot it with Playwright. No Claude, no subscription quota. Exits non-zero
# if the web export fails or no screenshot is produced, so the job status
# reflects toolchain health; artifacts upload regardless (if: always()).
set -uo pipefail
mkdir -p measure-artifacts
fail=0

echo "== expo export --platform web =="
if npx expo export --platform web > measure-artifacts/expo-export.log 2>&1; then
  echo "expo export: OK"
else
  echo "expo export: FAILED"
  tail -40 measure-artifacts/expo-export.log
  fail=1
fi
ls -la dist 2>/dev/null | head -8 || echo "(no dist/ produced)"

echo "== serve + screenshot =="
npx --yes serve -s dist -l 8080 > measure-artifacts/serve.log 2>&1 &
SERVE_PID=$!
sleep 6
if node scripts/measure/screenshot.mjs "http://localhost:8080" measure-artifacts/home.png; then
  echo "screenshot: OK"
else
  echo "screenshot: FAILED"
  fail=1
fi
kill "$SERVE_PID" 2>/dev/null || true

echo "== artifacts =="
ls -la measure-artifacts || true
[ -f measure-artifacts/home.png ] || fail=1
echo "smoke fail flag: $fail"
exit $fail

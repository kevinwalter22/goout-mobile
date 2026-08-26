#!/usr/bin/env bash
# Gather dependency/security signal into ./maint-inputs/ for the maintainer
# worker's Claude step. Never fails the job — npm outdated/audit exit non-zero
# by design when they find things, so every command is guarded.
set -uo pipefail
mkdir -p maint-inputs

# Install so npm outdated/audit have a resolved tree (lockfile is committed).
npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 || true

npm outdated --json > maint-inputs/outdated.json 2>/dev/null || true
npm audit --json    > maint-inputs/audit.json    2>/dev/null || true

node -e "const p=require('./package.json');console.log(JSON.stringify({expo:p.dependencies&&p.dependencies.expo,react_native:p.dependencies&&p.dependencies['react-native'],dependencies:p.dependencies,devDependencies:p.devDependencies},null,2))" \
  > maint-inputs/manifest.json 2>/dev/null || echo '{"note":"could not read package.json"}' > maint-inputs/manifest.json

npx --yes expo-doctor > maint-inputs/expo-doctor.txt 2>&1 || true

# Source-liveness FYI: prod sources that fetch fine but have gone quiet (no new event
# 14d+). Read-only. SUPABASE_ACCESS_TOKEN is scoped to THIS gather step only (never the
# Claude step). Degrades to a note if the token/ref aren't set.
node .github/scripts/fetch_source_liveness.mjs > maint-inputs/source-liveness.json 2>/dev/null \
  || echo '{"note":"source-liveness unavailable"}' > maint-inputs/source-liveness.json

echo "maintainer inputs gathered:"
ls -la maint-inputs
exit 0

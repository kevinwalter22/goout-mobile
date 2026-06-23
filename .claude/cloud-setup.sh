#!/usr/bin/env bash
# Cloud sandbox setup for Euda (Claude Code on web/Slack/mobile).
# Point the Cloud Environment "Setup script" field at: bash .claude/cloud-setup.sh
# Runs once after the repo is cloned (result is cached). Keep it under ~5 min.
# Idempotent: safe to re-run.
set -euo pipefail

echo "==> Euda cloud setup"

# 1. Dependencies (tsx, jest, eslint, dotenv, etc. all come from package.json).
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# 2. gh CLI (handy for repo ops; the GitHub App already covers push/PR auth).
if ! command -v gh >/dev/null 2>&1; then
  echo "==> installing gh"
  (apt-get update -y && apt-get install -y gh) || sudo apt-get install -y gh || \
    echo "WARN: could not install gh (non-fatal; scripts/gh_api.mjs works with GITHUB_TOKEN)"
fi

# 3. Supabase CLI, pinned to match the deploy workflows (avoids 'latest' rate limits).
SUPABASE_VERSION="2.76.9"
if ! command -v supabase >/dev/null 2>&1; then
  echo "==> installing supabase CLI v${SUPABASE_VERSION}"
  TMP="$(mktemp -d)"
  if curl -sfL "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/supabase_linux_amd64.tar.gz" -o "$TMP/supabase.tgz"; then
    tar -xzf "$TMP/supabase.tgz" -C "$TMP"
    install -m 0755 "$TMP/supabase" /usr/local/bin/supabase 2>/dev/null \
      || sudo install -m 0755 "$TMP/supabase" /usr/local/bin/supabase \
      || mv "$TMP/supabase" "$HOME/.local/bin/supabase"
  else
    echo "WARN: supabase CLI download failed (non-fatal; pipeline handles deploys)"
  fi
  rm -rf "$TMP"
fi

# 4. Sanity: confirm staging-pointed env is present (do NOT print values).
node -e '
  const need = ["SUPABASE_URL","SUPABASE_STAGING_URL"];
  const have = need.filter(k => process.env[k]);
  if (!have.length) { console.log("NOTE: no Supabase env detected — set the Cloud Environment variables (see docs/chief_engineer/multi_interface.md)"); }
  else { console.log("==> env OK ("+have.length+"/"+need.length+" supabase URL vars present)"); }
'

echo "==> setup complete"

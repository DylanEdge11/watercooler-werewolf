#!/usr/bin/env bash
# SessionStart hook for Claude Code cloud sessions. Installs dependencies when
# they are missing or older than package-lock.json, then the Playwright
# Chromium build this project's @playwright/test expects. Local sessions are
# skipped. Node itself is installed by the environment setup script.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 24 ]; then
  echo "Warning: Node $(node -v 2>/dev/null || echo missing) is installed; this project requires Node 24 (.nvmrc). Add 'N_PREFIX=/opt/node22 npx -y n 24' to the environment setup script (see docs/SETUP.md)."
fi

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies with npm ci..."
  npm ci --no-audit --no-fund --loglevel=error
fi

# Idempotent: a no-op when the matching browser is already installed.
if ! npx playwright install chromium >/dev/null 2>&1; then
  echo "Warning: could not install the Playwright Chromium browser. Check that cdn.playwright.dev and playwright.download.prss.microsoft.com are allowed."
fi

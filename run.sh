#!/bin/sh
set -eu
cd "$(dirname "$0")"
# Prefer installed tools; fall back to the Node/pnpm bundled with this Codex installation.
recovery_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if ! command -v node >/dev/null 2>&1; then export PATH="$recovery_runtime/node/bin:$PATH"; fi
if ! command -v pnpm >/dev/null 2>&1; then export PATH="$recovery_runtime/bin/fallback:$PATH"; fi
if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
  echo 'Node.js 24 LTS and pnpm 11.25.0 are required. No tools were installed globally.' >&2; exit 1
fi
export NEXT_TELEMETRY_DISABLED=1
if [ "$#" -eq 0 ]; then set -- dev; fi
exec pnpm --config.store-dir="$PWD/.local/pnpm-store" "$@"

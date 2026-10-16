#!/usr/bin/env bash
# One command: test the PayBox plugin, build the API, run the end-to-end suite
# against a mock facilitator, then leave the dashboard running.
#   ./run.sh          full run (needs Node 24 + pnpm 11.11.0)
#   ./run.sh --live   skip tests; start the API with your real .env.local
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"

# PayBox's checks require Node 24. If the system Node differs, use a
# project-local, checksum-verified copy in .node/ (system Node is untouched).
NODE_VERSION=24.21.0
if [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != "24" ]]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) DIST="node-v$NODE_VERSION-darwin-arm64" ;;
    Darwin-x86_64) DIST="node-v$NODE_VERSION-darwin-x64" ;;
    Linux-x86_64) DIST="node-v$NODE_VERSION-linux-x64" ;;
    Linux-aarch64) DIST="node-v$NODE_VERSION-linux-arm64" ;;
    *) echo "Unsupported platform; install Node 24 manually." >&2; exit 1 ;;
  esac
  if [[ ! -x "$ROOT/.node/$DIST/bin/node" ]]; then
    echo "==> Downloading Node $NODE_VERSION into $ROOT/.node (one time)"
    mkdir -p "$ROOT/.node" && cd "$ROOT/.node"
    curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/$DIST.tar.gz"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " $DIST.tar.gz\$" | shasum -a 256 -c -
    tar xzf "$DIST.tar.gz" && rm "$DIST.tar.gz"
  fi
  export PATH="$ROOT/.node/$DIST/bin:$PATH"
fi
echo "==> Using Node $(node -v), pnpm $(pnpm -v)"

# Refuse to start if something (e.g. an old ScopeCard server) already holds the port.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use by:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  echo "Stop it with:  kill \$(lsof -t -iTCP:$PORT -sTCP:LISTEN)   or run:  PORT=3005 ./run.sh" >&2
  exit 1
fi

if [[ "${1:-}" == "--live" ]]; then
  cd "$ROOT/scopecard-api"
  pnpm install && pnpm build && exec ./node_modules/.bin/next start -p "$PORT"
fi

echo "==> Plugin: install + PayBox checks"
cd "$ROOT/scopecard-plugin"
pnpm install --frozen-lockfile
pnpm --silent test

echo "==> API: install + build"
cd "$ROOT/scopecard-api"
pnpm install
pnpm build

echo "==> API: start with mock facilitator (no real funds)"
PAY_TO_ADDRESS=0x2222222222222222222222222222222222222222 \
FACILITATOR_URL=http://localhost:3199 \
  ./node_modules/.bin/next start -p "$PORT" > /dev/null 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/api/cards" > /dev/null && break; sleep 0.5; done

echo "==> End-to-end tests"
API="http://localhost:$PORT" BUNDLE="$ROOT/scopecard-plugin/dist/plugin.mjs" node scripts/e2e.mjs

echo
echo "All green. Upload: $ROOT/scopecard-plugin/dist/plugin.mjs"
echo "Landing: http://localhost:$PORT   Dashboard (with the test cards): http://localhost:$PORT/dashboard   — Ctrl+C to stop"
open "http://localhost:$PORT" 2>/dev/null || true
wait $API_PID

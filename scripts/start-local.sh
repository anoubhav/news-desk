#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4175}"

if [ ! -d node_modules ]; then
  npm install
fi

npm run build
exec node --import tsx server/index.ts

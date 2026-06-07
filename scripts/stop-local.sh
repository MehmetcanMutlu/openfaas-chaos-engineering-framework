#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f tmp/run/pids ]; then
  while read -r pid; do
    if [ -n "$pid" ]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < tmp/run/pids
  rm -f tmp/run/pids
fi

for port in 3000 8081 8082 8083 8084; do
  lsof -tiTCP:"$port" -sTCP:LISTEN | xargs kill >/dev/null 2>&1 || true
done

echo "Local demo stopped"


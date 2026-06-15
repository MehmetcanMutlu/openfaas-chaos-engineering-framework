#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="${HOME}/.arkade/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
export KUBECONFIG_FILE="${KUBECONFIG_FILE:-tmp/run/kubeconfig}"

exec node src/mod-b-supervisor.js

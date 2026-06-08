#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

K3D_CLUSTER="${K3D_CLUSTER:-openfaas-chaos}"
K3D_REGISTRY="${K3D_REGISTRY:-openfaas-chaos-registry}"
DELETE_CLUSTER="${DELETE_CLUSTER:-false}"

PID_FILE="tmp/run/openfaas-pids"

if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    if [ -n "$pid" ]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

for port in 8088 18088 9090 3002; do
  lsof -tiTCP:"$port" -sTCP:LISTEN | xargs kill >/dev/null 2>&1 || true
done

if [ "$DELETE_CLUSTER" = "true" ]; then
  if command -v k3d >/dev/null 2>&1; then
    k3d cluster delete "$K3D_CLUSTER" >/dev/null 2>&1 || true
    k3d registry delete "$K3D_REGISTRY" >/dev/null 2>&1 || true
    echo "Deleted k3d cluster ${K3D_CLUSTER} and registry ${K3D_REGISTRY}"
  fi
else
  echo "Stopped Mod B port-forwards. Set DELETE_CLUSTER=true to remove the k3d cluster."
fi

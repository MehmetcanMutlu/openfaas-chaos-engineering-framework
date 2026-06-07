#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:8080}"
IMAGE_OWNER="${OPENFAAS_IMAGE_OWNER:-}"
STACK_FILE="${OPENFAAS_STACK_FILE:-stack.yml}"
GENERATED_STACK=""

cleanup() {
  if [ -n "$GENERATED_STACK" ] && [ -f "$GENERATED_STACK" ]; then
    rm -f "$GENERATED_STACK"
  fi
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command faas-cli
require_command docker

if [ -n "$IMAGE_OWNER" ]; then
  echo "Deploying with image owner: $IMAGE_OWNER"
  GENERATED_STACK="$(mktemp -t openfaas-chaos-stack.XXXXXX.yml)"
  sed \
    -e "s#image: chaos-order-validator:latest#image: ${IMAGE_OWNER}/chaos-order-validator:latest#" \
    -e "s#image: chaos-inventory-checker:latest#image: ${IMAGE_OWNER}/chaos-inventory-checker:latest#" \
    -e "s#image: chaos-payment-processor:latest#image: ${IMAGE_OWNER}/chaos-payment-processor:latest#" \
    -e "s#image: chaos-notification-dispatcher:latest#image: ${IMAGE_OWNER}/chaos-notification-dispatcher:latest#" \
    "$STACK_FILE" > "$GENERATED_STACK"
  faas-cli build -f "$GENERATED_STACK"
  faas-cli push -f "$GENERATED_STACK"
  faas-cli deploy -f "$GENERATED_STACK" --gateway "$GATEWAY"
else
  echo "Deploying with images declared in $STACK_FILE"
  echo "For a remote Kubernetes cluster, set OPENFAAS_IMAGE_OWNER to a registry namespace."
  faas-cli build -f "$STACK_FILE"
  faas-cli deploy -f "$STACK_FILE" --gateway "$GATEWAY"
fi

faas-cli list --gateway "$GATEWAY"

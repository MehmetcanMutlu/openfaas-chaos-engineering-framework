#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:8080}"
TTL_DURATION="${TTL_SH_DURATION:-24h}"
RUN_ID="${TTL_SH_RUN_ID:-$(date +%s)}"
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

require_command docker
require_command faas-cli

FUNCTIONS=(
  "order-validator"
  "inventory-checker"
  "payment-processor"
  "notification-dispatcher"
)

echo "Building function image for ttl.sh demo run: ${RUN_ID}"
docker build \
  -t "chaos-order-validator:${RUN_ID}" \
  -t "chaos-inventory-checker:${RUN_ID}" \
  -t "chaos-payment-processor:${RUN_ID}" \
  -t "chaos-notification-dispatcher:${RUN_ID}" \
  .

for function_name in "${FUNCTIONS[@]}"; do
  image="ttl.sh/openfaas-chaos-${function_name}-${RUN_ID}:${TTL_DURATION}"
  echo "Pushing public demo image: ${image}"
  docker tag "chaos-${function_name}:${RUN_ID}" "$image"
  docker push "$image"
done

GENERATED_STACK="$(mktemp -t openfaas-chaos-ttl-stack.XXXXXX.yml)"
sed \
  -e "s#image: chaos-order-validator:latest#image: ttl.sh/openfaas-chaos-order-validator-${RUN_ID}:${TTL_DURATION}#" \
  -e "s#image: chaos-inventory-checker:latest#image: ttl.sh/openfaas-chaos-inventory-checker-${RUN_ID}:${TTL_DURATION}#" \
  -e "s#image: chaos-payment-processor:latest#image: ttl.sh/openfaas-chaos-payment-processor-${RUN_ID}:${TTL_DURATION}#" \
  -e "s#image: chaos-notification-dispatcher:latest#image: ttl.sh/openfaas-chaos-notification-dispatcher-${RUN_ID}:${TTL_DURATION}#" \
  "$STACK_FILE" > "$GENERATED_STACK"

echo "Deploying OpenFaaS functions to ${GATEWAY}"
faas-cli deploy -f "$GENERATED_STACK" --gateway "$GATEWAY"
faas-cli list --gateway "$GATEWAY"

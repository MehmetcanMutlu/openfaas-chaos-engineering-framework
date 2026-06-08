#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:18088}"
K3D_REGISTRY="${K3D_REGISTRY:-openfaas-chaos-registry}"
REGISTRY_PORT="${REGISTRY_PORT:-5001}"
IMAGE_TAG="${OPENFAAS_IMAGE_TAG:-local}"
STACK_FILE="${OPENFAAS_STACK_FILE:-stack.yml}"
REGISTRY_PUSH_HOST="localhost:${REGISTRY_PORT}"
REGISTRY_CLUSTER_HOST="k3d-${K3D_REGISTRY}:5000"
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

echo "Building function images..."
docker build \
  -t "chaos-order-validator:${IMAGE_TAG}" \
  -t "chaos-inventory-checker:${IMAGE_TAG}" \
  -t "chaos-payment-processor:${IMAGE_TAG}" \
  -t "chaos-notification-dispatcher:${IMAGE_TAG}" \
  .

for function_name in "${FUNCTIONS[@]}"; do
  local_image="chaos-${function_name}:${IMAGE_TAG}"
  push_image="${REGISTRY_PUSH_HOST}/chaos-${function_name}:${IMAGE_TAG}"
  cluster_image="${REGISTRY_CLUSTER_HOST}/chaos-${function_name}:${IMAGE_TAG}"

  echo "Publishing ${function_name} to k3d registry..."
  docker tag "$local_image" "$push_image"
  docker tag "$local_image" "$cluster_image"
  docker push "$push_image"
done

GENERATED_STACK="$(mktemp -t openfaas-chaos-k3d-stack.XXXXXX.yml)"
sed \
  -e "s#image: chaos-order-validator:latest#image: ${REGISTRY_CLUSTER_HOST}/chaos-order-validator:${IMAGE_TAG}#" \
  -e "s#image: chaos-inventory-checker:latest#image: ${REGISTRY_CLUSTER_HOST}/chaos-inventory-checker:${IMAGE_TAG}#" \
  -e "s#image: chaos-payment-processor:latest#image: ${REGISTRY_CLUSTER_HOST}/chaos-payment-processor:${IMAGE_TAG}#" \
  -e "s#image: chaos-notification-dispatcher:latest#image: ${REGISTRY_CLUSTER_HOST}/chaos-notification-dispatcher:${IMAGE_TAG}#" \
  "$STACK_FILE" > "$GENERATED_STACK"

echo "Deploying OpenFaaS functions to ${GATEWAY}"
faas-cli deploy -f "$GENERATED_STACK" --gateway "$GATEWAY"
faas-cli list --gateway "$GATEWAY"

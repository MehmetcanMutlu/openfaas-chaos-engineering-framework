#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

K3D_REGISTRY="${K3D_REGISTRY:-openfaas-chaos-registry}"
REGISTRY_PORT="${REGISTRY_PORT:-5001}"
IMAGE_TAG="${FAAS_NETES_OFFLINE_TAG:-0.18.17-offline2}"
REGISTRY_PUSH_HOST="localhost:${REGISTRY_PORT}"
REGISTRY_CLUSTER_HOST="k3d-${K3D_REGISTRY}:5000"
LOCAL_IMAGE="faas-netes-offline:${IMAGE_TAG}"

if docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
  echo "Reusing existing offline faas-netes image: ${LOCAL_IMAGE}"
else
  echo "Building offline faas-netes image..."
  docker build \
    -t "$LOCAL_IMAGE" \
    -f infra/openfaas/faas-netes-offline/Dockerfile \
    infra/openfaas/faas-netes-offline
fi

push_image="${REGISTRY_PUSH_HOST}/faas-netes-offline:${IMAGE_TAG}"
cluster_image="${REGISTRY_CLUSTER_HOST}/faas-netes-offline:${IMAGE_TAG}"

docker tag "$LOCAL_IMAGE" "$push_image"
docker tag "$LOCAL_IMAGE" "$cluster_image"
docker push "$push_image"

echo "Published offline faas-netes image: ${cluster_image}"

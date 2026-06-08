#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export PATH="${HOME}/.arkade/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

K3D_CLUSTER="${K3D_CLUSTER:-openfaas-chaos}"
K3D_REGISTRY="${K3D_REGISTRY:-openfaas-chaos-registry}"
REGISTRY_PORT="${REGISTRY_PORT:-5001}"
OPENFAAS_GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:18088}"
SKIP_CLUSTER_CREATE="${SKIP_CLUSTER_CREATE:-false}"
SKIP_DEPLOY="${SKIP_DEPLOY:-false}"
OPENFAAS_HELM_VERSION="${OPENFAAS_HELM_VERSION:-15.0.8}"
FAAS_NETES_OFFLINE_TAG="${FAAS_NETES_OFFLINE_TAG:-0.18.17-offline2}"

sync_registry_port_from_container() {
  local registry_container="$1"
  local mapped_port
  mapped_port="$(docker port "$registry_container" 5000/tcp 2>/dev/null | head -n1 | awk -F: '{print $NF}')"
  if [ -n "$mapped_port" ]; then
    REGISTRY_PORT="$mapped_port"
  fi
}

pick_registry_port() {
  local port="$1"
  while [ "$port" -le 5010 ]; do
    if ! lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      REGISTRY_PORT="$port"
      return 0
    fi
    port=$((port + 1))
  done
  echo "No free registry port found between 5001 and 5010" >&2
  return 1
}

ensure_k3d_registry() {
  local registry_container="k3d-${K3D_REGISTRY}"

  if docker ps --format '{{.Names}}' | grep -qx "$registry_container"; then
    echo "Reusing running k3d registry ${K3D_REGISTRY}"
    sync_registry_port_from_container "$registry_container"
    return 0
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$registry_container"; then
    echo "Starting existing k3d registry ${K3D_REGISTRY}..."
    docker start "$registry_container" >/dev/null
    sync_registry_port_from_container "$registry_container"
    return 0
  fi

  pick_registry_port "$REGISTRY_PORT"
  echo "Creating k3d registry ${K3D_REGISTRY} on port ${REGISTRY_PORT}..."
  k3d registry create "$K3D_REGISTRY" --port "${REGISTRY_PORT}"
}

require_port_free() {
  local port="$1"
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${port} is already in use. Stop the conflicting process or run npm run teardown:mod-b" >&2
    exit 1
  fi
}

wait_for_gateway() {
  for _ in $(seq 1 60); do
    if curl -fsS "${OPENFAAS_GATEWAY}/system/functions" >/dev/null 2>&1 \
      || curl -fsS "${OPENFAAS_GATEWAY}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "OpenFaaS gateway did not become ready at ${OPENFAAS_GATEWAY}" >&2
  return 1
}

wait_for_pods() {
  local namespace="$1"
  local timeout="${2:-300}"
  local elapsed=0

  while [ "$elapsed" -lt "$timeout" ]; do
    if kubectl get pods -n "$namespace" --no-headers 2>/dev/null \
      | awk '{print $3}' \
      | grep -vE '^(Running|Completed)$' >/dev/null; then
      sleep 5
      elapsed=$((elapsed + 5))
      continue
    fi

    if [ "$(kubectl get pods -n "$namespace" --no-headers 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]; then
      return 0
    fi

    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo "Timed out waiting for pods in namespace ${namespace}" >&2
  kubectl get pods -n "$namespace" || true
  return 1
}

echo "Stopping local demo if running..."
bash scripts/stop-local.sh >/dev/null 2>&1 || true

echo "Checking prerequisites..."
bash scripts/check-prerequisites.sh

if [ "$SKIP_CLUSTER_CREATE" != "true" ]; then
  ensure_k3d_registry

  if ! k3d cluster list | grep -q "${K3D_CLUSTER}"; then
    echo "Creating k3d cluster ${K3D_CLUSTER}..."
    k3d cluster create "$K3D_CLUSTER" \
      --servers 1 \
      --agents 1 \
      --registry-use "k3d-${K3D_REGISTRY}:5000"
  else
    echo "Reusing k3d cluster ${K3D_CLUSTER}"
    k3d cluster start "$K3D_CLUSTER" >/dev/null 2>&1 || true
  fi
else
  echo "Skipping k3d cluster/registry creation"
  k3d cluster start "$K3D_CLUSTER" >/dev/null 2>&1 || true
fi

KUBECONFIG_FILE="$(mktemp -t openfaas-kubeconfig.XXXXXX)"
if ! k3d kubeconfig get "$K3D_CLUSTER" > "$KUBECONFIG_FILE" 2>/dev/null; then
  echo "Failed to read kubeconfig for cluster ${K3D_CLUSTER}" >&2
  exit 1
fi
export KUBECONFIG="$KUBECONFIG_FILE"

for _ in $(seq 1 30); do
  if kubectl get nodes >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
kubectl get nodes

if docker ps -a --format '{{.Names}}' | grep -qx "k3d-${K3D_REGISTRY}"; then
  docker start "k3d-${K3D_REGISTRY}" >/dev/null 2>&1 || true
  sync_registry_port_from_container "k3d-${K3D_REGISTRY}"
fi

echo "Installing OpenFaaS namespaces..."
kubectl create namespace openfaas --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace openfaas-fn --dry-run=client -o yaml | kubectl apply -f -

echo "Ensuring offline faas-netes image is available for restricted networks..."
K3D_REGISTRY="$K3D_REGISTRY" \
REGISTRY_PORT="$REGISTRY_PORT" \
FAAS_NETES_OFFLINE_TAG="$FAAS_NETES_OFFLINE_TAG" \
  bash infra/openfaas/build-faas-netes-offline.sh

FAAS_NETES_IMAGE="k3d-${K3D_REGISTRY}:5000/faas-netes-offline:${FAAS_NETES_OFFLINE_TAG}"

echo "Installing OpenFaaS with Helm..."
helm repo add openfaas https://openfaas.github.io/faas-netes/ >/dev/null 2>&1 || true
helm repo update openfaas
helm upgrade --install openfaas openfaas/openfaas \
  --version "$OPENFAAS_HELM_VERSION" \
  --namespace openfaas \
  --set functionNamespace=openfaas-fn \
  --set openfaasPro=false \
  --set oem=false \
  --set operator.create=false \
  --set autoscaler.enabled=false \
  --set dashboard.enabled=false \
  --set generateBasicAuth=true \
  --set basic_auth=true \
  --set prometheus.create=true \
  --set alertmanager.create=true \
  --set queueWorker.replicas=1 \
  --set gateway.replicas=1 \
  --set faasnetes.image="${FAAS_NETES_IMAGE}" \
  --set faasnetes.imagePullPolicy=IfNotPresent \
  --wait \
  --timeout 15m

wait_for_pods openfaas 600

bash infra/openfaas/teardown-mod-b.sh >/dev/null 2>&1 || true

for port in 8088 18088 9090 3002; do
  require_port_free "$port"
done

echo "Starting port-forwards..."
OPENFAAS_GATEWAY="$OPENFAAS_GATEWAY" bash infra/openfaas/port-forward.sh
wait_for_gateway

echo "Logging into OpenFaaS..."
PASSWORD="$(kubectl get secret -n openfaas basic-auth -o jsonpath='{.data.basic-auth-password}' | base64 --decode)"
echo "$PASSWORD" | faas-cli login --gateway "$OPENFAAS_GATEWAY" --username admin --password-stdin

if [ "$SKIP_DEPLOY" != "true" ]; then
  echo "Deploying functions with public ttl.sh images (required by OpenFaaS CE)..."
  OPENFAAS_GATEWAY="$OPENFAAS_GATEWAY" \
    bash infra/openfaas/deploy-ttl-stack.sh
  wait_for_pods openfaas-fn 300
else
  echo "Skipping function deploy"
fi

echo "Patching Prometheus scrape config..."
kubectl apply -f infra/prometheus/prometheus-openfaas-chaos.yml
kubectl rollout restart -n openfaas deploy/prometheus
kubectl rollout status -n openfaas deploy/prometheus --timeout=5m

echo "Installing Grafana..."
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
kubectl -n monitoring create configmap openfaas-chaos-dashboard \
  --from-file=dashboard-openfaas-chaos.json=infra/grafana/dashboard-openfaas-chaos.json \
  --dry-run=client -o yaml | kubectl apply -f -

helm repo add grafana https://grafana.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update grafana
helm upgrade --install grafana grafana/grafana \
  --namespace monitoring \
  -f infra/grafana/grafana-values.yml \
  --wait \
  --timeout 10m

wait_for_pods monitoring 300

echo "Restarting port-forwards after Grafana install..."
bash infra/openfaas/port-forward.sh
wait_for_gateway

echo "Running smoke test..."
bash infra/openfaas/smoke-test.sh

cat <<EOF

Mod B stack is ready.

Sunum UI:         http://127.0.0.1:8088/ui/
OpenFaaS gateway: http://127.0.0.1:18088
Prometheus:       http://127.0.0.1:9090
Grafana:          http://127.0.0.1:3002  (admin / admin)

Useful commands:
  npm run smoke:openfaas
  npm run port-forward:mod-b
  bash infra/openfaas/set-fault.sh payment-processor latencyMs 500
  ORDER_VALIDATOR_URL=http://127.0.0.1:18088/function/order-validator SCENARIO=A-baseline k6 run tests/order-flow.k6.js
  npm run teardown:mod-b

EOF

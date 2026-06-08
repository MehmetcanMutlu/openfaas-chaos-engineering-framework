# OpenFaaS + k3s/k3d Deployment Kit

This directory adds the infrastructure layer required by the project presentation without changing the existing local dashboard or function pipeline.

## What This Adds

- k3s-compatible local Kubernetes via `k3d` for macOS and classroom machines.
- Native k3s guidance for Linux VMs.
- OpenFaaS deployment commands for the existing `stack.yml`.
- A clear separation between:
  - local demo: `npm run serve:local`
  - Mod B full stack: `npm run setup:mod-b`
  - OpenFaaS function redeploy: `npm run deploy:openfaas`

## Mod B Quick Start

One-command bootstrap with k3d local registry, OpenFaaS, Prometheus, and Grafana:

```bash
npm run setup:mod-b
npm run port-forward:mod-b
open http://127.0.0.1:3002
open http://127.0.0.1:8088
```

Runtime fault injection on OpenFaaS:

```bash
bash infra/openfaas/set-fault.sh payment-processor latencyMs 500
bash infra/openfaas/set-fault.sh inventory-checker errorRate 0.4
bash infra/openfaas/set-fault.sh notification-dispatcher downstreamFail true
```

Teardown:

```bash
npm run teardown:mod-b
DELETE_CLUSTER=true npm run teardown:mod-b
```

## Prerequisites

Install these tools:

```bash
brew install k3d kubectl helm
curl -sSL https://get.arkade.dev | sh
arkade get faas-cli
```

Linux VM alternative for k3s:

```bash
curl -sfL https://get.k3s.io | sh -
sudo k3s kubectl get nodes
```

## macOS / Local Kubernetes Path

Create a small k3d cluster:

```bash
k3d cluster create openfaas-chaos \
  --servers 1 \
  --agents 1 \
  --port "8080:80@loadbalancer" \
  --port "3001:3000@loadbalancer"
kubectl get nodes
```

Install OpenFaaS CE with Helm:

```bash
kubectl create namespace openfaas --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace openfaas-fn --dry-run=client -o yaml | kubectl apply -f -

helm repo add openfaas https://openfaas.github.io/faas-netes/ || true
helm repo update openfaas
helm upgrade --install openfaas openfaas/openfaas \
  --version 15.0.8 \
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
  --wait
```

Expose the OpenFaaS gateway locally:

```bash
kubectl port-forward -n openfaas svc/gateway 8080:8080
```

Login:

```bash
PASSWORD="$(kubectl get secret -n openfaas basic-auth -o jsonpath='{.data.basic-auth-password}' | base64 --decode)"
echo "$PASSWORD" | faas-cli login --gateway http://127.0.0.1:8080 --username admin --password-stdin
```

OpenFaaS CE only accepts public function images. Bootstrap and deploy use `deploy-ttl-stack.sh` automatically.

Redeploy functions:

```bash
OPENFAAS_GATEWAY=http://127.0.0.1:8088 bash infra/openfaas/deploy-ttl-stack.sh
```

Optional k3d local registry build path (requires OpenFaaS Standard for private images):

```bash
npm run deploy:openfaas
```

Alternative public demo images via ttl.sh:

```bash
bash infra/openfaas/deploy-ttl-stack.sh
```

OpenFaaS CE accepts unauthenticated public function images. The `ttl.sh` script builds the project image, pushes public 24-hour demo tags, rewrites the stack image references, and deploys the same four-function pipeline.

Smoke test:

```bash
curl -s -X POST http://127.0.0.1:8080/function/order-validator \
  -H 'content-type: application/json' \
  -d '{
    "orderId": "order-openfaas-1",
    "customerId": "customer-openfaas",
    "items": [{ "sku": "SKU-CHAOS-001", "quantity": 1 }],
    "payment": { "amount": 49.99, "currency": "USD", "method": "card" }
  }'
```

## Prometheus And Grafana

Patch OpenFaaS Prometheus so it scrapes the four function `/metrics` endpoints:

```bash
kubectl apply -f infra/prometheus/prometheus-openfaas-chaos.yml
kubectl rollout restart -n openfaas deploy/prometheus
kubectl rollout status -n openfaas deploy/prometheus
```

Install Grafana with the Prometheus datasource and dashboard pre-provisioned:

```bash
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
kubectl -n monitoring create configmap openfaas-chaos-dashboard \
  --from-file=dashboard-openfaas-chaos.json=infra/grafana/dashboard-openfaas-chaos.json \
  --dry-run=client -o yaml | kubectl apply -f -

helm repo add grafana https://grafana.github.io/helm-charts || true
helm repo update grafana
helm upgrade --install grafana grafana/grafana \
  --namespace monitoring \
  -f infra/grafana/grafana-values.yml \
  --wait
```

Expose Prometheus and Grafana locally:

```bash
kubectl port-forward -n openfaas svc/prometheus 9090:9090
kubectl port-forward -n monitoring svc/grafana 3001:80
```

Grafana login is `admin` / `admin` for the demo.

## Native k3s VM Path

On a Linux VM, install k3s, install OpenFaaS with Helm, then use either a public registry or `deploy-ttl-stack.sh` for a short-lived public demo image.

## Important Notes

- The current local dashboard is still the fastest live demo.
- The OpenFaaS path now runs the same functions on k3s/k3d Kubernetes.
- Prometheus and Grafana configs live in `infra/prometheus` and `infra/grafana`.
- The function pipeline remains unchanged:
  `Order Validator -> Inventory Checker -> Payment Processor -> Notification Dispatcher`.

## Official References

- OpenFaaS Kubernetes deployment: https://docs.openfaas.com/deployment/kubernetes/
- OpenFaaS CLI installation: https://docs.openfaas.com/cli/install/
- OpenFaaS YAML reference: https://docs.openfaas.com/reference/yaml/
- k3d registry and local cluster usage: https://k3d.io/stable/usage/registries/

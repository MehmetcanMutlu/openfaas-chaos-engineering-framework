# OpenFaaS + k3s/k3d Deployment Kit

This directory adds the infrastructure layer required by the project presentation without changing the existing local dashboard or function pipeline.

## What This Adds

- k3s-compatible local Kubernetes via `k3d` for macOS and classroom machines.
- Native k3s guidance for Linux VMs.
- OpenFaaS deployment commands for the existing `stack.yml`.
- A clear separation between:
  - local demo: `npm run serve:local`
  - OpenFaaS deployment proof: `faas-cli deploy -f stack.yml`

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

Install OpenFaaS with arkade:

```bash
arkade install openfaas
kubectl rollout status -n openfaas deploy/gateway
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

Deploy the functions:

```bash
bash infra/openfaas/deploy-stack.sh
```

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

## Native k3s VM Path

On a Linux VM, install k3s, install OpenFaaS with arkade, then run the same `deploy-stack.sh` script. If the VM uses a remote registry, export `OPENFAAS_IMAGE_OWNER` before deploying:

```bash
export OPENFAAS_IMAGE_OWNER=your-dockerhub-user
bash infra/openfaas/deploy-stack.sh
```

## Important Notes

- The current local dashboard is still the fastest live demo.
- This OpenFaaS path proves that the same functions can be deployed to Kubernetes/OpenFaaS.
- Prometheus and Grafana configs live in `infra/prometheus` and `infra/grafana`.
- The function pipeline remains unchanged:
  `Order Validator -> Inventory Checker -> Payment Processor -> Notification Dispatcher`.

## Official References

- OpenFaaS Kubernetes deployment: https://docs.openfaas.com/deployment/kubernetes/
- OpenFaaS CLI installation: https://docs.openfaas.com/cli/install/
- OpenFaaS YAML reference: https://docs.openfaas.com/reference/yaml/
- k3d registry and local cluster usage: https://k3d.io/stable/usage/registries/

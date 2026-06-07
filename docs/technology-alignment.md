# Technology Alignment

This document explains how the project maps to the technologies listed in the proposal and presentation.

## Current Live Demo

The live classroom demo runs locally:

```bash
npm run serve:local
open http://127.0.0.1:3000
```

This mode is intentionally fast and reliable for presentation. It runs the same four function handlers and the same fault middleware, but without requiring a live Kubernetes cluster during class.

## Required Technologies and Project Status

| Technology | Status | Evidence in Repository |
|---|---|---|
| Node.js | Implemented | `src/functions`, `src/shared`, `src/server.js` |
| Docker | Implemented | `Dockerfile`, `docker-compose.yml` |
| OpenFaaS | Deploy-ready | `stack.yml`, `infra/openfaas/deploy-stack.sh` |
| Kubernetes / k3s | Deploy-ready | `infra/openfaas/README.md` includes k3d/k3s setup paths |
| Prometheus | Metrics-ready | every function exposes `/metrics`; config in `infra/prometheus/prometheus.yml` |
| Grafana | Dashboard-ready | dashboard JSON in `infra/grafana/dashboard-openfaas-chaos.json` |
| k6 | Test-ready | `tests/order-flow.k6.js` |

## Correct Presentation Statement

Use this wording during the demo:

> The core chaos framework and four-function pipeline are implemented and working. The classroom demo runs through the local dashboard for reliability. The same functions are packaged with Docker, deployable to OpenFaaS using `stack.yml`, and expose Prometheus metrics. The repository also includes Prometheus scrape configuration and a Grafana dashboard JSON for the OpenFaaS/Kubernetes deployment path.

## Deployment Modes

### Local UI Demo

- Best for the live presentation.
- Shows request flow, failure propagation, P50/P99, error rate, and stoppable experiments.
- Does not require k3s, OpenFaaS, Prometheus, or Grafana to be running.

### OpenFaaS + k3s/k3d Proof

- Best for showing technology alignment.
- Uses `stack.yml` and `infra/openfaas/deploy-stack.sh`.
- Prometheus can scrape the `/metrics` endpoints.
- Grafana can import `infra/grafana/dashboard-openfaas-chaos.json`.

## Pipeline Guarantee

Both deployment modes preserve the same function chain:

```text
Order Validator -> Inventory Checker -> Payment Processor -> Notification Dispatcher
```

Faults remain controlled by the same environment variables:

- `FAULT_LATENCY_MS`
- `FAULT_ERROR_RATE`
- `DOWNSTREAM_FAIL`


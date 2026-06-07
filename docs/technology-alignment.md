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
| OpenFaaS | Implemented and live-run verified | `stack.yml`, `infra/openfaas/deploy-ttl-stack.sh` |
| Kubernetes / k3s | Implemented and live-run verified through k3d | `infra/openfaas/README.md` includes k3d/k3s setup paths |
| Prometheus | Implemented and live-run verified | every function exposes `/metrics`; configs in `infra/prometheus` |
| Grafana | Implemented and live-run verified | dashboard JSON and Helm values in `infra/grafana` |
| k6 | Test-ready | `tests/order-flow.k6.js` |

## Correct Presentation Statement

Use this wording during the demo:

> The core chaos framework and four-function pipeline are implemented and working. The local dashboard is still the clearest classroom control screen. The same functions are also running on k3s/k3d through OpenFaaS, with Prometheus scraping the custom `chaos_*` metrics and Grafana showing the provisioned dashboard.

## Deployment Modes

### Local UI Demo

- Best for the live presentation.
- Shows request flow, failure propagation, P50/P99, error rate, and stoppable experiments.
- Does not require k3s, OpenFaaS, Prometheus, or Grafana to be running.

### OpenFaaS + k3s/k3d Live Proof

- Best for showing technology alignment.
- Uses `stack.yml` and `infra/openfaas/deploy-ttl-stack.sh`.
- Prometheus scrapes the `/metrics` endpoints through `infra/prometheus/prometheus-openfaas-chaos.yml`.
- Grafana provisions `infra/grafana/dashboard-openfaas-chaos.json` through `infra/grafana/grafana-values.yml`.

## Live Verification From June 7, 2026

- k3d cluster: `openfaas-chaos`
- OpenFaaS gateway: `http://127.0.0.1:8080`
- OpenFaaS functions: all four deployed in `openfaas-fn` and rolled out as `1/1 Running`
- Prometheus: `http://127.0.0.1:9090`, query `chaos_function_requests_total`
- Grafana: `http://127.0.0.1:3001`, login `admin` / `admin`
- Grafana dashboard: `OpenFaaS Chaos Engineering`

## Pipeline Guarantee

Both deployment modes preserve the same function chain:

```text
Order Validator -> Inventory Checker -> Payment Processor -> Notification Dispatcher
```

Faults remain controlled by the same environment variables:

- `FAULT_LATENCY_MS`
- `FAULT_ERROR_RATE`
- `DOWNSTREAM_FAIL`

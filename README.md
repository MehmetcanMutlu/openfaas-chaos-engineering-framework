# Chaos Engineering Framework for OpenFaaS Serverless Functions

This project implements a four-function order-processing pipeline with reusable fault injection middleware. Each function is stateless, communicates over synchronous HTTP, exposes Prometheus text metrics at `/metrics`, and reads fault settings from environment variables at request time.

## Architecture

Pipeline:

1. Order Validator
2. Inventory Checker
3. Payment Processor
4. Notification Dispatcher

Fault variables:

- `FAULT_LATENCY_MS`: sleeps before the function handler runs.
- `FAULT_ERROR_RATE`: returns a synthetic HTTP 500 by probability.
- `DOWNSTREAM_FAIL`: intercepts outbound calls and returns synthetic downstream errors.

The Payment Processor is a representative wrapped function: `src/server.js` selects the core handler from `src/functions/payment-processor.js`, then applies `withFaultInjection()` from `src/shared/faultMiddleware.js`.

## Local Docker Compose Run

The fastest local demo is the dashboard runner:

```bash
npm run dev:local
open http://127.0.0.1:3000
```

In Codex or any terminal where the process must stay attached, use:

```bash
npm run serve:local
```

Stop it with:

```bash
npm run stop:local
```

The dashboard lets you switch between baseline, payment latency, inventory errors, and notification downstream failure. It writes the selected values into each function process environment through the local-only `/faults` endpoint, and the middleware still reads faults from `FAULT_LATENCY_MS`, `FAULT_ERROR_RATE`, and `DOWNSTREAM_FAIL`.

Docker Compose is also available:

```bash
docker compose up -d --build
curl -s http://127.0.0.1:8081/healthz
curl -s http://127.0.0.1:8081/metrics
```

Send a single order:

```bash
curl -s -X POST http://127.0.0.1:8081 \
  -H 'content-type: application/json' \
  -d '{
    "orderId": "order-demo-1",
    "customerId": "customer-1",
    "items": [
      { "sku": "SKU-CHAOS-001", "quantity": 1 },
      { "sku": "SKU-CHAOS-002", "quantity": 1 }
    ],
    "payment": {
      "amount": 49.99,
      "currency": "USD",
      "method": "card"
    }
  }'
```

## OpenFaaS Deploy

```bash
faas-cli deploy -f stack.yml
```

For Kubernetes clusters that cannot pull local images, retag the four images in `stack.yml` with your registry prefix before deploying.

Run k6 against OpenFaaS:

```bash
ORDER_VALIDATOR_URL=http://127.0.0.1:8080/function/order-validator \
SCENARIO=A-baseline \
k6 run tests/order-flow.k6.js
```

## k6 Scenario Commands

Local baseline:

```bash
docker compose down --remove-orphans
docker compose up -d --build
ORDER_VALIDATOR_URL=http://127.0.0.1:8081 SCENARIO=A-baseline k6 run tests/order-flow.k6.js
```

Payment Processor latency fault:

```bash
docker compose down --remove-orphans
PAYMENT_FAULT_LATENCY_MS=500 docker compose up -d --build
ORDER_VALIDATOR_URL=http://127.0.0.1:8081 SCENARIO=B-payment-latency k6 run tests/order-flow.k6.js
```

Inventory Checker cascading error fault:

```bash
docker compose down --remove-orphans
INVENTORY_FAULT_ERROR_RATE=0.4 docker compose up -d --build
ORDER_VALIDATOR_URL=http://127.0.0.1:8081 SCENARIO=C-inventory-errors k6 run tests/order-flow.k6.js
```

Notification Dispatcher complete downstream failure:

```bash
docker compose down --remove-orphans
NOTIFICATION_DOWNSTREAM_FAIL=true docker compose up -d --build
ORDER_VALIDATOR_URL=http://127.0.0.1:8081 SCENARIO=D-notification-downstream-failure k6 run tests/order-flow.k6.js
```

Run all local scenarios:

```bash
bash scripts/run-scenarios.sh
```

## Verification

```bash
npm run lint
npm test
```

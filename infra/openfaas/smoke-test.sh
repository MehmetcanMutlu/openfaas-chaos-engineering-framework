#!/usr/bin/env bash
set -euo pipefail

GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:18088}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://127.0.0.1:9090}"

echo "Smoke test: order-validator health via gateway..."
curl -fsS "${GATEWAY}/function/order-validator/healthz" >/dev/null

echo "Smoke test: full order pipeline..."
response="$(curl -s -w '\n%{http_code}' -X POST "${GATEWAY}/function/order-validator" \
  -H 'content-type: application/json' \
  -d '{
    "orderId": "order-smoke-1",
    "customerId": "customer-smoke",
    "items": [{ "sku": "SKU-CHAOS-001", "quantity": 1 }],
    "payment": { "amount": 49.99, "currency": "USD", "method": "card" }
  }')"

status_code="$(echo "$response" | tail -n1)"
body="$(echo "$response" | sed '$d')"

if [ "$status_code" != "200" ]; then
  echo "Order pipeline failed with status ${status_code}" >&2
  echo "$body" >&2
  exit 1
fi

echo "Smoke test: Prometheus metrics query..."
for _ in $(seq 1 30); do
  metrics="$(curl -fsS "${PROMETHEUS_URL}/api/v1/query?query=chaos_function_requests_total" || true)"
  if echo "$metrics" | grep -q '"status":"success"' && echo "$metrics" | grep -q 'chaos_function_requests_total'; then
    echo "Prometheus returned chaos_function_requests_total"
    echo "Mod B smoke test passed."
    exit 0
  fi
  sleep 2
done

echo "Prometheus did not return chaos_function_requests_total in time" >&2
exit 1

#!/usr/bin/env bash
set -euo pipefail

ORDER_VALIDATOR_URL="${ORDER_VALIDATOR_URL:-http://127.0.0.1:8081}"
K6_DURATION="${K6_DURATION:-60s}"
K6_VUS="${K6_VUS:-10}"

run_scenario() {
  local scenario="$1"
  shift

  docker compose down --remove-orphans >/dev/null 2>&1 || true
  env "$@" docker compose up -d --build
  wait_for_health "$ORDER_VALIDATOR_URL/healthz"

  SCENARIO="$scenario" \
  ORDER_VALIDATOR_URL="$ORDER_VALIDATOR_URL" \
  DURATION="$K6_DURATION" \
  VUS="$K6_VUS" \
    k6 run tests/order-flow.k6.js
}

wait_for_health() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for $url" >&2
  docker compose ps >&2
  exit 1
}

run_scenario "A-baseline" \
  ORDER_FAULT_LATENCY_MS=0 ORDER_FAULT_ERROR_RATE=0 ORDER_DOWNSTREAM_FAIL=false \
  INVENTORY_FAULT_LATENCY_MS=0 INVENTORY_FAULT_ERROR_RATE=0 INVENTORY_DOWNSTREAM_FAIL=false \
  PAYMENT_FAULT_LATENCY_MS=0 PAYMENT_FAULT_ERROR_RATE=0 PAYMENT_DOWNSTREAM_FAIL=false \
  NOTIFICATION_FAULT_LATENCY_MS=0 NOTIFICATION_FAULT_ERROR_RATE=0 NOTIFICATION_DOWNSTREAM_FAIL=false

run_scenario "B-payment-latency" \
  PAYMENT_FAULT_LATENCY_MS=500

run_scenario "C-inventory-errors" \
  INVENTORY_FAULT_ERROR_RATE=0.4

run_scenario "D-notification-downstream-failure" \
  NOTIFICATION_DOWNSTREAM_FAIL=true


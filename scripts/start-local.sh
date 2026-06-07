#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p tmp/run

if [ -f tmp/run/pids ]; then
  while read -r pid; do
    if [ -n "$pid" ]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < tmp/run/pids
fi

: > tmp/run/pids

start_service() {
  local name="$1"
  shift

  nohup env "$@" node src/server.js > "tmp/run/${name}.log" 2>&1 &
  echo $! >> tmp/run/pids
}

start_service notification \
  PORT=8084 \
  FUNCTION_NAME=notification-dispatcher \
  ENABLE_FAULT_CONTROL=true \
  NOTIFICATION_PROVIDER_URL=mock://notification-provider/send

start_service payment \
  PORT=8083 \
  FUNCTION_NAME=payment-processor \
  ENABLE_FAULT_CONTROL=true \
  NOTIFICATION_DISPATCHER_URL=http://127.0.0.1:8084

start_service inventory \
  PORT=8082 \
  FUNCTION_NAME=inventory-checker \
  ENABLE_FAULT_CONTROL=true \
  PAYMENT_PROCESSOR_URL=http://127.0.0.1:8083

start_service order \
  PORT=8081 \
  FUNCTION_NAME=order-validator \
  ENABLE_FAULT_CONTROL=true \
  INVENTORY_CHECKER_URL=http://127.0.0.1:8082

nohup env \
  UI_PORT=3000 \
  ORDER_VALIDATOR_URL=http://127.0.0.1:8081 \
  INVENTORY_CHECKER_URL=http://127.0.0.1:8082 \
  PAYMENT_PROCESSOR_URL=http://127.0.0.1:8083 \
  NOTIFICATION_DISPATCHER_URL=http://127.0.0.1:8084 \
  node src/ui-server.js > tmp/run/ui.log 2>&1 &
echo $! >> tmp/run/pids

for port in 8081 8082 8083 8084 3000; do
  ready=0
  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1 || curl -fsS "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.2
  done

  if [ "$ready" != "1" ]; then
    echo "Service on port ${port} did not become ready" >&2
    cat tmp/run/*.log >&2
    exit 1
  fi
done

echo "Dashboard: http://127.0.0.1:3000"
echo "Order API:  http://127.0.0.1:8081"
echo "PIDs: $(tr '\n' ' ' < tmp/run/pids)"


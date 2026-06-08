#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

mkdir -p tmp/run
PID_FILE="tmp/run/openfaas-pids"
GATEWAY_INTERNAL_PORT="${GATEWAY_INTERNAL_PORT:-18088}"
PRESENTATION_PORT="${PRESENTATION_PORT:-8088}"
PROMETHEUS_LOCAL_PORT="${PROMETHEUS_LOCAL_PORT:-9090}"
GRAFANA_LOCAL_PORT="${GRAFANA_LOCAL_PORT:-3002}"

stop_existing() {
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      if [ -n "$pid" ]; then
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi

  for port in "$GATEWAY_INTERNAL_PORT" "$PRESENTATION_PORT" "$PROMETHEUS_LOCAL_PORT" "$GRAFANA_LOCAL_PORT"; do
    lsof -tiTCP:"$port" -sTCP:LISTEN | xargs kill >/dev/null 2>&1 || true
  done
}

start_forward() {
  local namespace="$1"
  local service="$2"
  local local_port="$3"
  local remote_port="$4"

  kubectl port-forward -n "$namespace" "svc/${service}" "${local_port}:${remote_port}" \
    > "tmp/run/port-forward-${service}.log" 2>&1 &
  echo $! >> "$PID_FILE"
}

start_presentation_ui() {
  OPENFAAS_GATEWAY="http://127.0.0.1:${GATEWAY_INTERNAL_PORT}" \
  PRESENTATION_PORT="${PRESENTATION_PORT}" \
  PROMETHEUS_URL="http://127.0.0.1:${PROMETHEUS_LOCAL_PORT}" \
  GRAFANA_URL="http://127.0.0.1:${GRAFANA_LOCAL_PORT}" \
  UI_BASE_PATH="/ui" \
    node src/presentation-server.js > "tmp/run/presentation-ui.log" 2>&1 &
  echo $! >> "$PID_FILE"
}

stop_existing
: > "$PID_FILE"

start_forward openfaas gateway "$GATEWAY_INTERNAL_PORT" 8080
start_forward openfaas prometheus "$PROMETHEUS_LOCAL_PORT" 9090
start_forward monitoring grafana "$GRAFANA_LOCAL_PORT" 80

sleep 1
start_presentation_ui
sleep 1

echo "Port forwards and presentation UI active:"
echo "  Sunum UI:         http://127.0.0.1:${PRESENTATION_PORT}/ui/"
echo "  OpenFaaS gateway: http://127.0.0.1:${GATEWAY_INTERNAL_PORT}"
echo "  Prometheus:       http://127.0.0.1:${PROMETHEUS_LOCAL_PORT}"
echo "  Grafana:          http://127.0.0.1:${GRAFANA_LOCAL_PORT}"
echo "PID file: ${PID_FILE}"

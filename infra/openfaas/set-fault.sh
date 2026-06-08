#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <function-name> <fault-field> <value>" >&2
  echo "Examples:" >&2
  echo "  $0 payment-processor latencyMs 500" >&2
  echo "  $0 inventory-checker errorRate 0.4" >&2
  echo "  $0 notification-dispatcher downstreamFail true" >&2
  exit 1
fi

FUNCTION_NAME="$1"
FIELD="$2"
VALUE="$3"
GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:18088}"

case "$FIELD" in
  latencyMs|errorRate)
    json_value="$VALUE"
    ;;
  downstreamFail)
    if [ "$VALUE" = "true" ] || [ "$VALUE" = "1" ]; then
      json_value="true"
    else
      json_value="false"
    fi
    ;;
  *)
    echo "Unsupported fault field: ${FIELD}" >&2
    exit 1
    ;;
esac

payload="{\"${FIELD}\": ${json_value}}"

curl -fsS -X POST "${GATEWAY}/function/${FUNCTION_NAME}/faults" \
  -H 'content-type: application/json' \
  -d "$payload"

echo ""

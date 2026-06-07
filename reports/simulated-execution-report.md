# Simulated Execution and Validation Report

Simulation model:

- 1,000 valid order requests per scenario.
- 10 virtual users at steady load.
- End-to-end traffic starts at the Order Validator.
- Latency values include the synchronous function chain and synthetic business-work delays.
- Reported Grafana shifts refer to `chaos_*` custom metrics exposed by each function at `/metrics`, plus equivalent OpenFaaS invocation success and failure panels.

## Scenario Summary

| Scenario | Fault Configuration | 200 Responses | 500 Responses | Error Rate | P50 Latency | P90 Latency | P99 Latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| A Normal Baseline | none | 1,000 | 0 | 0.0% | 150 ms | 205 ms | 235 ms |
| B Isolated Latency | `FAULT_LATENCY_MS=500` on Payment Processor | 1,000 | 0 | 0.0% | 650 ms | 705 ms | 735 ms |
| C Cascading Errors | `FAULT_ERROR_RATE=0.4` on Inventory Checker | 600 | 400 | 40.0% | 145 ms | 210 ms | 235 ms |
| D Complete Failure | `DOWNSTREAM_FAIL=true` on Notification Dispatcher | 0 | 1,000 | 100.0% | 125 ms | 165 ms | 185 ms |

## Scenario A: Normal Baseline

All functions execute successfully. No middleware fault counters increase.

Expected Grafana panels:

- End-to-end status split: 1,000 HTTP 200, 0 HTTP 500.
- `chaos_function_requests_total{outcome="success"}` increases by 1,000 for every function.
- `chaos_fault_injections_total` remains unchanged.
- Median wrapped durations:
  - Order Validator: 150 ms
  - Inventory Checker: 118 ms
  - Payment Processor: 80 ms
  - Notification Dispatcher: 30 ms

Validation: the chain reaches the Notification Dispatcher for every request, proving the middleware is transparent when all fault variables are disabled.

## Scenario B: Isolated Latency on Payment Processor

`FAULT_LATENCY_MS=500` is applied only to the Payment Processor.

Expected Grafana panels:

- End-to-end status split: 1,000 HTTP 200, 0 HTTP 500.
- `chaos_fault_injections_total{function="payment-processor",fault_type="latency"}` increases by 1,000.
- Payment Processor wrapped duration shifts from 80 ms P50 to 580 ms P50.
- Upstream wrapped durations also shift because calls are synchronous:
  - Order Validator: 150 ms -> 650 ms P50
  - Inventory Checker: 118 ms -> 618 ms P50
  - Payment Processor: 80 ms -> 580 ms P50
  - Notification Dispatcher: 30 ms -> 30 ms P50

Validation: latency is injected before Payment Processor handler execution, then propagates upstream through the synchronous HTTP chain without creating errors.

## Scenario C: Cascading Errors from Inventory Checker

`FAULT_ERROR_RATE=0.4` is applied only to the Inventory Checker.

Expected Grafana panels:

- End-to-end status split: 600 HTTP 200, 400 HTTP 500.
- `chaos_fault_injections_total{function="inventory-checker",fault_type="error_rate"}` increases by about 400.
- `chaos_function_requests_total{function="inventory-checker",outcome="error",status_code="500"}` increases by about 400.
- Payment Processor and Notification Dispatcher invocation volume drops from 1,000 to about 600 because failed inventory requests do not call downstream stages.
- Order Validator records about 400 downstream errors from Inventory Checker and propagates them as HTTP 500.

Validation: the middleware short-circuits Inventory Checker before its handler, preventing Payment Processor and Notification Dispatcher from executing on failed requests.

## Scenario D: Complete Failure at Notification Dispatcher Dependency

`DOWNSTREAM_FAIL=true` is applied only to the Notification Dispatcher.

Expected Grafana panels:

- End-to-end status split: 0 HTTP 200, 1,000 HTTP 500.
- `chaos_fault_injections_total{function="notification-dispatcher",fault_type="downstream_fail"}` increases by 1,000.
- `chaos_downstream_requests_total{function="notification-dispatcher",target="notification-provider",outcome="synthetic_failure",status_code="503",synthetic="true"}` increases by 1,000.
- All upstream functions record error outcomes because the final Notification Dispatcher failure propagates back through Payment Processor, Inventory Checker, and Order Validator.
- P50 latency drops from 150 ms to 125 ms because the Notification Dispatcher does not wait for the mock provider's normal 25 ms success path.

Validation: outbound-call interception works through the shared HTTP client. The failure originates at the final dependency, then propagates as HTTP 500 through the full synchronous chain.


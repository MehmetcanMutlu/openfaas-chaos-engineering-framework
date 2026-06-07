# Demo Presentation Guide

This guide explains how to present the running chaos engineering dashboard in a short academic demo.

## One-Minute Project Explanation

The project is a serverless order-processing pipeline for OpenFaaS. A client request enters the Order Validator, then flows synchronously through Inventory Checker, Payment Processor, and Notification Dispatcher. Every function is wrapped by the same fault-injection middleware, so latency, error rate, and downstream failure can be enabled per function without changing business logic.

## What the Dashboard Shows

- **Scenario Select**: Chooses the experiment. It writes `FAULT_LATENCY_MS`, `FAULT_ERROR_RATE`, and `DOWNSTREAM_FAIL` into the target function's local demo process.
- **Tek Sipariş Çalıştır**: Sends one order and highlights the exact function path. Each function becomes `completed`, `failed`, or `not reached`.
- **Canlı Sipariş Akışı**: The main presentation area. Use this to show whether the fault started at Order Validator, Inventory Checker, Payment Processor, or Notification Dispatcher.
- **Fault hedefi / Beklenen etki / Son sipariş**: Converts the selected scenario into one clear sentence for the presenter.
- **N Sipariş Test Et**: A small classroom-friendly load experiment. The button text follows the selected request count, for example `20 Sipariş Test Et` or `100 Sipariş Test Et`. It sends repeated orders from the dashboard so P50, P99, and error rate become visible without needing to install k6 during the presentation.
- **Deney Özeti**: Shows P50, P99, error rate, request counts, injected fault counts, and per-function error rates.
- **Sonuç ve Kanıt**: Shows the latest JSON response and demo log. The `trace` field is the proof of which function ran and where the failure started.

## Recommended Live Demo Flow

1. Start on **A · Normal Baseline**.
   - Say: "All four functions are healthy and no fault is active."
   - Click **Tek Sipariş Çalıştır**.
   - Expected result: all four stages show `completed`, HTTP 200, notification delivered.

2. Click **B · Payment Latency**.
   - Say: "Only Payment Processor has an active latency fault."
   - Click **Tek Sipariş Çalıştır**.
   - Expected result: all stages still show `completed`, but end-to-end latency increases by about 500 ms.
   - Point to Payment Processor in the flow: it is the fault target, but it does not fail.

3. Click **C · Inventory Errors**.
   - Say: "Inventory Checker now returns synthetic HTTP 500 on about 40% of requests before calling downstream functions."
   - Set the request count to 20 or 100, then click **N Sipariş Test Et**.
   - Expected result: error rate rises; failed requests show Inventory Checker as `failed`; Payment Processor and Notification Dispatcher show `not reached`.
   - Point to the metrics: Inventory error count increases and downstream traffic drops.

4. Click **D · Notification Failure**.
   - Say: "The final notification dependency is unavailable."
   - Click **Tek Sipariş Çalıştır**.
   - Expected result: Order, Inventory, and Payment complete; Notification fails; the final HTTP response is 500 because the last-stage failure propagates back upstream.

5. Return to **A · Normal Baseline**.
   - Say: "Resetting environment variables restores normal behavior without changing function code."
   - Click **Tek Sipariş Çalıştır** again.
   - Expected result: all stages complete and HTTP 200 returns.

## What This Proves

- Fault injection is controlled by environment variables.
- The same middleware works across all functions.
- Synchronous serverless chains propagate downstream failures upstream.
- Per-request trace data proves where a request went and where it failed.
- Prometheus-compatible metrics expose requests, errors, latency, injected faults, and downstream failures.
- The dashboard makes the system demonstrable without needing Grafana during a classroom presentation.

## How to Explain the Project Is Working

The project is working when all of these are true:

- The dashboard opens at `http://127.0.0.1:3000`.
- The four service cards show healthy status.
- Baseline order submission returns HTTP 200.
- Payment latency increases end-to-end latency while keeping HTTP 200.
- Inventory errors produce mixed HTTP 200 and HTTP 500 results.
- Notification failure produces HTTP 500 and highlights Notification Dispatcher as the failure point.

# Demo Presentation Guide

This guide explains how to present the running chaos engineering dashboard in a short academic demo.

## One-Minute Project Explanation

The project is a serverless order-processing pipeline for OpenFaaS. A client request enters the Order Validator, then flows synchronously through Inventory Checker, Payment Processor, and Notification Dispatcher. Every function is wrapped by the same fault-injection middleware, so latency, error rate, and downstream failure can be enabled per function without changing business logic.

## Dashboard Sections

- **Senaryolar**: Selects the active chaos experiment. Baseline resets all faults. Payment +500 ms injects latency only into Payment Processor. Inventory 40% 500 injects random failures only into Inventory Checker. Notification failure makes Notification Dispatcher's outbound provider call fail.
- **Sipariş Gönder**: Sends one valid order through the whole function chain. Use this to show the response path and whether the current scenario returns success or failure.
- **Mini Test**: Sends repeated orders from the browser dashboard. Use this to show P50, P90, P99, and error-rate changes without installing k6 during the live demo.
- **Fonksiyon Zinciri**: Shows which function has an active fault and proves the fault is isolated to the selected function.
- **Metrikler**: Summarizes Prometheus-style middleware metrics from every function: request count, error count, injected faults, and average function duration.
- **Son Yanıt**: Shows the latest end-to-end JSON response. In successful runs it contains the nested pipeline result. In failure runs it shows where the error propagated.
- **Canlı Test Günlüğü**: Gives a chronological demo log so the presenter can narrate what happened after each click.

## Recommended Live Demo Flow

1. Start on **Baseline**.
   - Say: "All four functions are healthy and no fault is active."
   - Click **Sipariş Gönder**.
   - Expected result: HTTP 200, final notification delivered, low latency.

2. Click **Payment +500 ms**.
   - Say: "The middleware now sleeps 500 ms before Payment Processor executes."
   - Click **Sipariş Gönder**.
   - Expected result: HTTP 200, latency increases by about 500 ms, Payment Processor is marked as fault active.

3. Click **Inventory 40% 500**.
   - Say: "Inventory Checker now randomly fails 40% of requests before calling Payment Processor."
   - Run **Mini Test** with 20 requests.
   - Expected result: about 40% error rate; Payment and Notification request volume drops because failed inventory requests do not go downstream.

4. Click **Notification failure**.
   - Say: "The final notification provider dependency is now unavailable."
   - Click **Sipariş Gönder**.
   - Expected result: HTTP 500; the last response shows failure propagation back through Payment, Inventory, and Order Validator.

5. Return to **Baseline**.
   - Say: "Resetting environment variables restores normal behavior without changing function code."
   - Click **Sipariş Gönder** again.
   - Expected result: HTTP 200.

## What This Proves

- Fault injection is controlled by environment variables.
- The same middleware works across all functions.
- Synchronous serverless chains propagate downstream failures upstream.
- Prometheus-compatible metrics expose requests, errors, latency, injected faults, and downstream failures.
- The dashboard makes the system demonstrable without needing Grafana during a classroom presentation.

## How to Explain the Project Is Working

The project is working when all of these are true:

- The dashboard opens at `http://127.0.0.1:3000`.
- The four service cards show healthy status.
- Baseline order submission returns HTTP 200.
- Payment latency increases end-to-end latency while keeping HTTP 200.
- Inventory errors produce mixed HTTP 200 and HTTP 500 results.
- Notification failure produces HTTP 500 and a downstream-failure metric.


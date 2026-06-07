"use strict";

const { callJson } = require("../shared/httpClient");
const { jsonResponse } = require("../shared/response");
const { sleep } = require("../shared/time");
const { appendTrace, traceFromDownstream } = require("../shared/trace");

const INVENTORY = new Map([
  ["SKU-CHAOS-001", 100],
  ["SKU-CHAOS-002", 75],
  ["SKU-CHAOS-003", 40]
]);

async function handler(context) {
  await sleep(35);

  const order = context.body.order;
  if (!order) {
    const trace = appendTrace(context.body.trace, "inventory-checker", "failed", "Order payload was missing");
    return jsonResponse(400, {
      stage: "inventory-checker",
      error: "Missing order payload",
      trace
    });
  }

  const unavailableItems = findUnavailableItems(order.items || []);
  if (unavailableItems.length > 0) {
    const trace = appendTrace(context.body.trace, "inventory-checker", "failed", "Inventory check rejected unavailable items", {
      unavailableItems
    });

    return jsonResponse(409, {
      stage: "inventory-checker",
      error: "Inventory unavailable",
      unavailableItems,
      trace
    });
  }

  const trace = appendTrace(context.body.trace, "inventory-checker", "success", "Inventory reserved for all requested items", {
    reservationId: `inv-${order.orderId}`
  });
  const paymentResponse = await callJson(context, "payment-processor", process.env.PAYMENT_PROCESSOR_URL, {
    order,
    reservation: {
      reserved: true,
      reservationId: `inv-${order.orderId}`
    },
    trace
  }, {
    timeoutMs: 3000
  });

  if (!paymentResponse.ok) {
    const failedTrace = traceFromDownstream(trace, paymentResponse.body, "payment-processor", "Payment Processor returned an error");
    return jsonResponse(500, {
      stage: "inventory-checker",
      error: "Payment stage failed",
      downstreamStatus: paymentResponse.status,
      downstream: paymentResponse.body,
      trace: failedTrace
    });
  }

  return jsonResponse(200, {
    stage: "inventory-checker",
    reservation: {
      reserved: true,
      reservationId: `inv-${order.orderId}`
    },
    payment: paymentResponse.body,
    trace: paymentResponse.body.trace || trace
  });
}

function findUnavailableItems(items) {
  return items
    .filter((item) => !INVENTORY.has(item.sku) || item.quantity > INVENTORY.get(item.sku))
    .map((item) => ({
      sku: item.sku,
      requested: item.quantity,
      available: INVENTORY.get(item.sku) || 0
    }));
}

module.exports = {
  findUnavailableItems,
  handler
};

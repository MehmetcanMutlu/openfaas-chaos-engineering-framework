"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { findUnavailableItems } = require("../../src/functions/inventory-checker");
const { transactionId } = require("../../src/functions/payment-processor");
const { validateOrder } = require("../../src/functions/order-validator");

test("order validator accepts the demo order payload", () => {
  const result = validateOrder({
    orderId: "order-test",
    customerId: "customer-test",
    items: [
      { sku: "SKU-CHAOS-001", quantity: 1 }
    ],
    payment: {
      amount: 49.99,
      currency: "USD",
      method: "card"
    }
  });

  assert.equal(result.valid, true);
});

test("inventory checker reports unavailable SKUs", () => {
  const unavailable = findUnavailableItems([
    { sku: "SKU-CHAOS-404", quantity: 1 }
  ]);

  assert.deepEqual(unavailable, [
    {
      sku: "SKU-CHAOS-404",
      requested: 1,
      available: 0
    }
  ]);
});

test("payment transaction IDs are stable for the same order", () => {
  assert.equal(transactionId("order-123"), transactionId("order-123"));
  assert.notEqual(transactionId("order-123"), transactionId("order-456"));
});


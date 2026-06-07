"use strict";

const { callJson } = require("../shared/httpClient");
const { jsonResponse } = require("../shared/response");
const { sleep } = require("../shared/time");
const { appendTrace, traceFromDownstream } = require("../shared/trace");

const VALID_CURRENCIES = new Set(["USD", "EUR", "TRY"]);

async function handler(context) {
  await sleep(20);

  const validation = validateOrder(context.body);
  if (!validation.valid) {
    const trace = appendTrace(context.body.trace, "order-validator", "failed", "Payload validation failed", {
      errors: validation.errors
    });

    return jsonResponse(400, {
      stage: "order-validator",
      error: "Order validation failed",
      details: validation.errors,
      trace
    });
  }

  const order = normalizeOrder(context.body);
  const trace = appendTrace(context.body.trace, "order-validator", "success", "Payload and business rules validated", {
    items: order.items.length,
    amount: order.payment.amount
  });
  const inventoryResponse = await callJson(context, "inventory-checker", process.env.INVENTORY_CHECKER_URL, {
    order,
    trace
  }, {
    timeoutMs: 3000
  });

  if (!inventoryResponse.ok) {
    const failedTrace = traceFromDownstream(trace, inventoryResponse.body, "inventory-checker", "Inventory Checker returned an error");
    return jsonResponse(500, {
      stage: "order-validator",
      error: "Inventory stage failed",
      downstreamStatus: inventoryResponse.status,
      downstream: inventoryResponse.body,
      trace: failedTrace
    });
  }

  return jsonResponse(200, {
    stage: "order-validator",
    status: "accepted",
    orderId: order.orderId,
    customerId: order.customerId,
    pipeline: inventoryResponse.body,
    trace: inventoryResponse.body.trace || trace
  });
}

function validateOrder(body) {
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      valid: false,
      errors: ["body must be a JSON object"]
    };
  }

  if (!nonEmptyString(body.orderId)) {
    errors.push("orderId must be a non-empty string");
  }

  if (!nonEmptyString(body.customerId)) {
    errors.push("customerId must be a non-empty string");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push("items must be a non-empty array");
  } else {
    let totalQuantity = 0;
    for (const [index, item] of body.items.entries()) {
      if (!nonEmptyString(item.sku)) {
        errors.push(`items[${index}].sku must be a non-empty string`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        errors.push(`items[${index}].quantity must be a positive integer`);
      } else {
        totalQuantity += item.quantity;
      }
    }

    if (totalQuantity > 25) {
      errors.push("total item quantity must not exceed 25");
    }
  }

  if (!body.payment || typeof body.payment !== "object") {
    errors.push("payment must be an object");
  } else {
    if (!Number.isFinite(body.payment.amount) || body.payment.amount <= 0) {
      errors.push("payment.amount must be greater than zero");
    }
    if (!VALID_CURRENCIES.has(body.payment.currency)) {
      errors.push("payment.currency must be one of USD, EUR, TRY");
    }
    if (!nonEmptyString(body.payment.method)) {
      errors.push("payment.method must be a non-empty string");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function normalizeOrder(body) {
  return {
    orderId: body.orderId,
    customerId: body.customerId,
    items: body.items.map((item) => ({
      sku: item.sku,
      quantity: item.quantity
    })),
    payment: {
      amount: Number(body.payment.amount),
      currency: body.payment.currency,
      method: body.payment.method
    }
  };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  handler,
  validateOrder
};

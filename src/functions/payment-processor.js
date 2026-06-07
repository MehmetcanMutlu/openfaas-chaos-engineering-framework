"use strict";

const crypto = require("crypto");
const { callJson } = require("../shared/httpClient");
const { jsonResponse } = require("../shared/response");
const { sleep } = require("../shared/time");
const { appendTrace, traceFromDownstream } = require("../shared/trace");

async function handler(context) {
  await sleep(55);

  const { order, reservation } = context.body;
  if (!order || !reservation || reservation.reserved !== true) {
    const trace = appendTrace(context.body.trace, "payment-processor", "failed", "Payment payload or inventory reservation was missing");
    return jsonResponse(400, {
      stage: "payment-processor",
      error: "Missing order or inventory reservation",
      trace
    });
  }

  if (order.payment.amount > 5000) {
    const trace = appendTrace(context.body.trace, "payment-processor", "failed", "Payment gateway declined the authorization", {
      amount: order.payment.amount
    });

    return jsonResponse(402, {
      stage: "payment-processor",
      error: "Payment authorization declined",
      reason: "amount exceeds demo authorization limit",
      trace
    });
  }

  const payment = {
    authorized: true,
    transactionId: transactionId(order.orderId),
    amount: order.payment.amount,
    currency: order.payment.currency,
    method: order.payment.method
  };

  const trace = appendTrace(context.body.trace, "payment-processor", "success", "Payment gateway authorized the transaction", {
    transactionId: payment.transactionId,
    amount: payment.amount
  });
  const notificationResponse = await callJson(context, "notification-dispatcher", process.env.NOTIFICATION_DISPATCHER_URL, {
    order,
    reservation,
    payment,
    trace
  }, {
    timeoutMs: 3000
  });

  if (!notificationResponse.ok) {
    const failedTrace = traceFromDownstream(trace, notificationResponse.body, "notification-dispatcher", "Notification Dispatcher returned an error");
    return jsonResponse(500, {
      stage: "payment-processor",
      error: "Notification stage failed",
      downstreamStatus: notificationResponse.status,
      downstream: notificationResponse.body,
      trace: failedTrace
    });
  }

  return jsonResponse(200, {
    stage: "payment-processor",
    payment,
    notification: notificationResponse.body,
    trace: notificationResponse.body.trace || trace
  });
}

function transactionId(orderId) {
  return `pay-${crypto.createHash("sha256").update(orderId).digest("hex").slice(0, 16)}`;
}

module.exports = {
  handler,
  transactionId
};

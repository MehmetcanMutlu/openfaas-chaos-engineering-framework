"use strict";

const crypto = require("crypto");
const { callJson } = require("../shared/httpClient");
const { jsonResponse } = require("../shared/response");
const { sleep } = require("../shared/time");

async function handler(context) {
  await sleep(55);

  const { order, reservation } = context.body;
  if (!order || !reservation || reservation.reserved !== true) {
    return jsonResponse(400, {
      stage: "payment-processor",
      error: "Missing order or inventory reservation"
    });
  }

  if (order.payment.amount > 5000) {
    return jsonResponse(402, {
      stage: "payment-processor",
      error: "Payment authorization declined",
      reason: "amount exceeds demo authorization limit"
    });
  }

  const payment = {
    authorized: true,
    transactionId: transactionId(order.orderId),
    amount: order.payment.amount,
    currency: order.payment.currency,
    method: order.payment.method
  };

  const notificationResponse = await callJson(context, "notification-dispatcher", process.env.NOTIFICATION_DISPATCHER_URL, {
    order,
    reservation,
    payment
  }, {
    timeoutMs: 3000
  });

  if (!notificationResponse.ok) {
    return jsonResponse(500, {
      stage: "payment-processor",
      error: "Notification stage failed",
      downstreamStatus: notificationResponse.status,
      downstream: notificationResponse.body
    });
  }

  return jsonResponse(200, {
    stage: "payment-processor",
    payment,
    notification: notificationResponse.body
  });
}

function transactionId(orderId) {
  return `pay-${crypto.createHash("sha256").update(orderId).digest("hex").slice(0, 16)}`;
}

module.exports = {
  handler,
  transactionId
};


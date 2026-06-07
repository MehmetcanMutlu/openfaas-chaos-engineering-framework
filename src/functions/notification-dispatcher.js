"use strict";

const { callJson } = require("../shared/httpClient");
const { jsonResponse } = require("../shared/response");
const { sleep } = require("../shared/time");

async function handler(context) {
  await sleep(5);

  const { order, payment } = context.body;
  if (!order || !payment || payment.authorized !== true) {
    return jsonResponse(400, {
      stage: "notification-dispatcher",
      error: "Missing order or authorized payment payload"
    });
  }

  const providerResponse = await callJson(context, "notification-provider", process.env.NOTIFICATION_PROVIDER_URL || "mock://notification-provider/send", {
    customerId: order.customerId,
    orderId: order.orderId,
    transactionId: payment.transactionId
  }, {
    mockLatencyMs: 25,
    timeoutMs: 1000
  });

  if (!providerResponse.ok) {
    return jsonResponse(500, {
      stage: "notification-dispatcher",
      error: "Notification provider failed",
      downstreamStatus: providerResponse.status,
      downstream: providerResponse.body
    });
  }

  return jsonResponse(200, {
    stage: "notification-dispatcher",
    delivered: true,
    provider: providerResponse.body,
    messageId: `msg-${order.orderId}`
  });
}

module.exports = {
  handler
};


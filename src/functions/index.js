"use strict";

const handlers = {
  "order-validator": require("./order-validator").handler,
  "inventory-checker": require("./inventory-checker").handler,
  "payment-processor": require("./payment-processor").handler,
  "notification-dispatcher": require("./notification-dispatcher").handler
};

function getHandler(functionName) {
  const handler = handlers[functionName];
  if (!handler) {
    throw new Error(`Unknown FUNCTION_NAME '${functionName}'. Valid values: ${Object.keys(handlers).join(", ")}`);
  }

  return handler;
}

module.exports = {
  getHandler
};


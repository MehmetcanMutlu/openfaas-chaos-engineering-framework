"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { withFaultInjection } = require("../../src/shared/faultMiddleware");

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("middleware injects deterministic latency before handler execution", async () => {
  process.env.FAULT_LATENCY_MS = "25";
  process.env.FAULT_ERROR_RATE = "0";
  process.env.DOWNSTREAM_FAIL = "false";

  const wrapped = withFaultInjection("unit-function", async () => ({
    statusCode: 200,
    body: { ok: true }
  }));

  const startedAt = Date.now();
  const response = await wrapped({
    requestId: "test-latency",
    method: "POST",
    path: "/",
    functionName: "unit-function"
  });

  assert.equal(response.statusCode, 200);
  assert.ok(Date.now() - startedAt >= 20);
});

test("middleware can short-circuit handler with error-rate fault", async () => {
  process.env.FAULT_LATENCY_MS = "0";
  process.env.FAULT_ERROR_RATE = "1";
  process.env.DOWNSTREAM_FAIL = "false";

  let called = false;
  const wrapped = withFaultInjection("unit-function", async () => {
    called = true;
    return {
      statusCode: 200,
      body: { ok: true }
    };
  });

  const response = await wrapped({
    requestId: "test-error-rate",
    method: "POST",
    path: "/",
    functionName: "unit-function"
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.injectedFault, "FAULT_ERROR_RATE");
  assert.equal(called, false);
});


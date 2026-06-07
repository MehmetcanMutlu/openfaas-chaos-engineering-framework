"use strict";

const { getFaultConfig } = require("./config");
const { metrics } = require("./metrics");
const { elapsedMs, elapsedSeconds, sleep } = require("./time");

async function callJson(context, target, url, payload, options = {}) {
  const startedAt = process.hrtime.bigint();
  const faultConfig = getFaultConfig();
  const synthetic = faultConfig.downstreamFail;

  if (synthetic) {
    metrics.inc("chaos_fault_injections_total", {
      function: context.functionName,
      fault_type: "downstream_fail"
    });
    recordDownstream(context, target, startedAt, "synthetic_failure", 503, true);
    console.log(JSON.stringify({
      event: "downstream_call",
      requestId: context.requestId,
      function: context.functionName,
      target,
      statusCode: 503,
      outcome: "synthetic_failure",
      synthetic: true,
      durationMs: elapsedMs(startedAt)
    }));

    return {
      ok: false,
      status: 503,
      synthetic: true,
      body: {
        error: "Synthetic downstream failure",
        target,
        injectedFault: "DOWNSTREAM_FAIL"
      }
    };
  }

  try {
    if (!url) {
      throw new Error(`Missing URL for downstream target ${target}`);
    }

    if (url.startsWith("mock://")) {
      await sleep(options.mockLatencyMs || 20);
      recordDownstream(context, target, startedAt, "success", 200, false);
      return {
        ok: true,
        status: 200,
        synthetic: false,
        body: {
          provider: target,
          delivered: true,
          mode: "mock"
        }
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 3000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": context.requestId,
        ...(options.headers || {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const text = await response.text();
    const body = parseResponseBody(text);
    const outcome = response.status >= 200 && response.status < 300 ? "success" : "error";
    recordDownstream(context, target, startedAt, outcome, response.status, false);

    console.log(JSON.stringify({
      event: "downstream_call",
      requestId: context.requestId,
      function: context.functionName,
      target,
      statusCode: response.status,
      outcome,
      synthetic: false,
      durationMs: elapsedMs(startedAt)
    }));

    return {
      ok: outcome === "success",
      status: response.status,
      synthetic: false,
      body
    };
  } catch (error) {
    const statusCode = error.name === "AbortError" ? 504 : 599;
    recordDownstream(context, target, startedAt, "error", statusCode, false);
    console.log(JSON.stringify({
      event: "downstream_call",
      requestId: context.requestId,
      function: context.functionName,
      target,
      statusCode,
      outcome: "error",
      synthetic: false,
      error: error.message,
      durationMs: elapsedMs(startedAt)
    }));

    return {
      ok: false,
      status: statusCode,
      synthetic: false,
      body: {
        error: "Downstream call failed",
        target,
        message: error.message
      }
    };
  }
}

function recordDownstream(context, target, startedAt, outcome, statusCode, synthetic) {
  metrics.inc("chaos_downstream_requests_total", {
    function: context.functionName,
    target,
    outcome,
    status_code: statusCode,
    synthetic: String(synthetic)
  });
  metrics.observe("chaos_downstream_duration_seconds", {
    function: context.functionName,
    target,
    outcome,
    synthetic: String(synthetic)
  }, elapsedSeconds(startedAt));
}

function parseResponseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

module.exports = {
  callJson
};


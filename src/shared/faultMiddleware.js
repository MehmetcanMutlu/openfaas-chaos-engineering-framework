"use strict";

const { getFaultConfig } = require("./config");
const { metrics } = require("./metrics");
const { jsonResponse, normalizeResponse, outcomeForStatus } = require("./response");
const { elapsedMs, elapsedSeconds, sleep } = require("./time");
const { appendTrace } = require("./trace");

function withFaultInjection(functionName, handler) {
  return async function wrappedHandler(context) {
    const startedAt = process.hrtime.bigint();
    const faultConfig = getFaultConfig();
    let response;
    let injectedFault = "none";

    try {
      if (faultConfig.latencyMs > 0) {
        injectedFault = "latency";
        metrics.inc("chaos_fault_injections_total", {
          function: functionName,
          fault_type: "latency"
        });
        await sleep(faultConfig.latencyMs);
      }

      if (faultConfig.errorRate > 0 && Math.random() < faultConfig.errorRate) {
        injectedFault = "error_rate";
        metrics.inc("chaos_fault_injections_total", {
          function: functionName,
          fault_type: "error_rate"
        });
        response = jsonResponse(500, {
          error: "Synthetic function failure",
          function: functionName,
          injectedFault: "FAULT_ERROR_RATE",
          trace: appendTrace(context.body && context.body.trace, functionName, "failed", "Middleware returned synthetic HTTP 500 before handler execution", {
            fault: "FAULT_ERROR_RATE",
            errorRate: faultConfig.errorRate
          })
        });
      } else {
        response = normalizeResponse(await handler(context));
      }
    } catch (error) {
      response = jsonResponse(500, {
        error: "Unhandled function error",
        function: functionName,
        message: error.message,
        trace: appendTrace(context.body && context.body.trace, functionName, "failed", "Unhandled exception inside function", {
          message: error.message
        })
      });
    } finally {
      response = normalizeResponse(response);
      const durationSeconds = elapsedSeconds(startedAt);
      const outcome = outcomeForStatus(response.statusCode);

      metrics.inc("chaos_function_requests_total", {
        function: functionName,
        outcome,
        status_code: response.statusCode
      });
      metrics.observe("chaos_function_duration_seconds", {
        function: functionName,
        outcome
      }, durationSeconds);

      console.log(JSON.stringify({
        event: "function_invocation",
        requestId: context.requestId,
        function: functionName,
        method: context.method,
        path: context.path,
        statusCode: response.statusCode,
        outcome,
        durationMs: elapsedMs(startedAt),
        faultLatencyMs: faultConfig.latencyMs,
        faultErrorRate: faultConfig.errorRate,
        downstreamFail: faultConfig.downstreamFail,
        injectedFault
      }));
    }

    return response;
  };
}

module.exports = {
  withFaultInjection
};

"use strict";

function appendTrace(trace, stage, status, message, details = {}) {
  return [
    ...normalizeTrace(trace),
    {
      stage,
      status,
      message,
      details
    }
  ];
}

function normalizeTrace(trace) {
  return Array.isArray(trace) ? trace : [];
}

function traceFromDownstream(localTrace, downstreamBody, fallbackStage, fallbackMessage) {
  if (downstreamBody && Array.isArray(downstreamBody.trace)) {
    return downstreamBody.trace;
  }

  return appendTrace(localTrace, fallbackStage, "failed", fallbackMessage);
}

module.exports = {
  appendTrace,
  normalizeTrace,
  traceFromDownstream
};


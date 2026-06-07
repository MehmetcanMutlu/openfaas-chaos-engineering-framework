"use strict";

function readNumberEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

function readBooleanEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function getFaultConfig() {
  return {
    latencyMs: Math.trunc(readNumberEnv("FAULT_LATENCY_MS", 0, 0, 30000)),
    errorRate: readNumberEnv("FAULT_ERROR_RATE", 0, 0, 1),
    downstreamFail: readBooleanEnv("DOWNSTREAM_FAIL")
  };
}

function setFaultConfig(config) {
  if (Object.prototype.hasOwnProperty.call(config, "latencyMs")) {
    process.env.FAULT_LATENCY_MS = String(Math.trunc(clampNumber(config.latencyMs, 0, 30000, 0)));
  }

  if (Object.prototype.hasOwnProperty.call(config, "errorRate")) {
    process.env.FAULT_ERROR_RATE = String(clampNumber(config.errorRate, 0, 1, 0));
  }

  if (Object.prototype.hasOwnProperty.call(config, "downstreamFail")) {
    process.env.DOWNSTREAM_FAIL = config.downstreamFail === true ? "true" : "false";
  }

  return getFaultConfig();
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

module.exports = {
  getFaultConfig,
  readBooleanEnv,
  readNumberEnv,
  setFaultConfig
};

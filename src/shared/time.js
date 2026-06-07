"use strict";

function sleep(ms) {
  const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function elapsedSeconds(startTime) {
  return Number(process.hrtime.bigint() - startTime) / 1e9;
}

function elapsedMs(startTime) {
  return Math.round(elapsedSeconds(startTime) * 1000);
}

module.exports = {
  elapsedMs,
  elapsedSeconds,
  sleep
};


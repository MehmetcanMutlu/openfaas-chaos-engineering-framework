"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { parseJsonBody, writeResponse, jsonResponse } = require("./shared/response");

const port = Number(process.env.UI_PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");

const services = [
  {
    id: "order-validator",
    label: "Order Validator",
    url: process.env.ORDER_VALIDATOR_URL || "http://127.0.0.1:8081"
  },
  {
    id: "inventory-checker",
    label: "Inventory Checker",
    url: process.env.INVENTORY_CHECKER_URL || "http://127.0.0.1:8082"
  },
  {
    id: "payment-processor",
    label: "Payment Processor",
    url: process.env.PAYMENT_PROCESSOR_URL || "http://127.0.0.1:8083"
  },
  {
    id: "notification-dispatcher",
    label: "Notification Dispatcher",
    url: process.env.NOTIFICATION_DISPATCHER_URL || "http://127.0.0.1:8084"
  }
];

const scenarios = {
  baseline: {
    label: "Baseline",
    faults: {}
  },
  "payment-latency": {
    label: "Payment +500 ms",
    faults: {
      "payment-processor": {
        latencyMs: 500
      }
    }
  },
  "inventory-errors": {
    label: "Inventory 40% 500",
    faults: {
      "inventory-checker": {
        errorRate: 0.4
      }
    }
  },
  "notification-failure": {
    label: "Notification failure",
    faults: {
      "notification-dispatcher": {
        downstreamFail: true
      }
    }
  }
};

const server = http.createServer(async (request, response) => {
  const requestId = request.headers["x-request-id"] || randomUUID();
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await routeApi(request, response, url, requestId);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    writeResponse(response, jsonResponse(500, {
      error: "UI server error",
      message: error.message
    }), requestId);
  }
});

async function routeApi(request, response, url, requestId) {
  if (request.method === "GET" && url.pathname === "/api/services") {
    writeResponse(response, jsonResponse(200, {
      services: await getServicesState()
    }), requestId);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/metrics-summary") {
    writeResponse(response, jsonResponse(200, {
      services: await getMetricsSummary()
    }), requestId);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/order") {
    const body = await parseJsonBody(request);
    const result = await postOrder(body);
    writeResponse(response, jsonResponse(200, result), requestId);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/scenario") {
    const body = await parseJsonBody(request);
    const result = await applyScenario(body.scenario || "baseline");
    writeResponse(response, jsonResponse(200, result), requestId);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/faults") {
    const body = await parseJsonBody(request);
    const result = await applyFault(body.serviceId, body.faults || {});
    writeResponse(response, jsonResponse(200, result), requestId);
    return;
  }

  writeResponse(response, jsonResponse(404, {
    error: "API route not found"
  }), requestId);
}

async function getServicesState() {
  return Promise.all(services.map(async (service) => {
    const [health, faults] = await Promise.all([
      fetchJson(`${service.url}/healthz`),
      fetchJson(`${service.url}/faults`)
    ]);

    return {
      ...service,
      healthy: health.ok && health.body.status === "ok",
      healthStatus: health.status,
      faultStatus: faults.status,
      faultControlEnabled: Boolean(faults.body && faults.body.faultControlEnabled),
      faults: faults.body && faults.body.faults ? faults.body.faults : null
    };
  }));
}

async function getMetricsSummary() {
  return Promise.all(services.map(async (service) => {
    const response = await fetchText(`${service.url}/metrics`);
    const summary = parseMetrics(response.body || "");
    return {
      id: service.id,
      label: service.label,
      reachable: response.ok,
      ...summary
    };
  }));
}

async function postOrder(payload) {
  const startedAt = process.hrtime.bigint();
  const response = await fetch(services[0].url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": randomUUID()
    },
    body: JSON.stringify(payload)
  });
  const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  const text = await response.text();

  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    durationMs,
    body: parseBody(text)
  };
}

async function applyScenario(scenarioId) {
  const scenario = scenarios[scenarioId];
  if (!scenario) {
    return {
      applied: false,
      error: `Unknown scenario '${scenarioId}'`,
      scenarios: Object.keys(scenarios)
    };
  }

  const baseline = {
    latencyMs: 0,
    errorRate: 0,
    downstreamFail: false
  };

  const results = [];
  for (const service of services) {
    results.push(await applyFault(service.id, {
      ...baseline,
      ...(scenario.faults[service.id] || {})
    }));
  }

  return {
    applied: true,
    scenario: scenarioId,
    label: scenario.label,
    results
  };
}

async function applyFault(serviceId, faults) {
  const service = services.find((candidate) => candidate.id === serviceId);
  if (!service) {
    return {
      serviceId,
      applied: false,
      error: "Unknown service"
    };
  }

  const response = await fetchJson(`${service.url}/faults`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(faults)
  });

  return {
    serviceId,
    applied: response.ok,
    status: response.status,
    body: response.body
  };
}

async function fetchJson(url, options) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      body: parseBody(text)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error: error.message
      }
    };
  }
}

async function fetchText(url) {
  try {
    const response = await fetch(url);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      body: await response.text()
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: "",
      error: error.message
    };
  }
}

function parseMetrics(text) {
  const summary = {
    requests: 0,
    errors: 0,
    faults: 0,
    downstreamFailures: 0,
    durationAvgMs: 0
  };

  let durationSum = 0;
  let durationCount = 0;

  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }

    const value = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (!Number.isFinite(value)) {
      continue;
    }

    if (line.startsWith("chaos_function_requests_total")) {
      summary.requests += value;
      if (line.includes('outcome="error"')) {
        summary.errors += value;
      }
    }

    if (line.startsWith("chaos_fault_injections_total")) {
      summary.faults += value;
    }

    if (line.startsWith("chaos_downstream_requests_total") && line.includes('outcome="synthetic_failure"')) {
      summary.downstreamFailures += value;
    }

    if (line.startsWith("chaos_function_duration_seconds_sum")) {
      durationSum += value;
    }

    if (line.startsWith("chaos_function_duration_seconds_count")) {
      durationCount += value;
    }
  }

  if (durationCount > 0) {
    summary.durationAvgMs = Math.round((durationSum / durationCount) * 1000);
  }

  summary.errorRate = summary.requests > 0 ? summary.errors / summary.requests : 0;
  return summary;
}

function parseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentType(filePath)
  });
  fs.createReadStream(filePath).pipe(response);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  return "application/octet-stream";
}

server.listen(port, () => {
  console.log(JSON.stringify({
    event: "ui_started",
    port,
    url: `http://127.0.0.1:${port}`
  }));
});


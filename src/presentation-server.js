"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { parseJsonBody, writeResponse, jsonResponse } = require("./shared/response");

const port = Number(process.env.PRESENTATION_PORT || process.env.UI_PORT || 8088);
const basePath = normalizeBasePath(process.env.UI_BASE_PATH || "/ui");
const publicDir = path.join(__dirname, "..", "public");
const openfaasGateway = (process.env.OPENFAAS_GATEWAY || "http://127.0.0.1:18088").replace(/\/$/, "");
const prometheusUrl = process.env.PROMETHEUS_URL || "http://127.0.0.1:9090";
const grafanaUrl = process.env.GRAFANA_URL || "http://127.0.0.1:3002";

const services = [
  { id: "order-validator", label: "Order Validator", url: `${openfaasGateway}/function/order-validator` },
  { id: "inventory-checker", label: "Inventory Checker", url: `${openfaasGateway}/function/inventory-checker` },
  { id: "payment-processor", label: "Payment Processor", url: `${openfaasGateway}/function/payment-processor` },
  { id: "notification-dispatcher", label: "Notification Dispatcher", url: `${openfaasGateway}/function/notification-dispatcher` }
];

const scenarios = {
  baseline: { label: "Baseline", faults: {} },
  "payment-latency": {
    label: "Payment +500 ms",
    faults: { "payment-processor": { latencyMs: 500 } }
  },
  "inventory-errors": {
    label: "Inventory 40% 500",
    faults: { "inventory-checker": { errorRate: 0.4 } }
  },
  "notification-failure": {
    label: "Notification failure",
    faults: { "notification-dispatcher": { downstreamFail: true } }
  }
};

const server = http.createServer(async (request, response) => {
  const requestId = request.headers["x-request-id"] || randomUUID();
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/" || url.pathname === "") {
      redirect(response, `${basePath}/`);
      return;
    }

    if (url.pathname === basePath || url.pathname === `${basePath}`) {
      redirect(response, `${basePath}/`);
      return;
    }

    if (url.pathname.startsWith(`${basePath}/api/`)) {
      await routeApi(request, response, url, requestId);
      return;
    }

    if (url.pathname.startsWith(`${basePath}/`)) {
      await serveStatic(response, url.pathname.slice(basePath.length) || "/index.html");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found. Open presentation UI at /ui/");
  } catch (error) {
    writeResponse(response, jsonResponse(500, {
      error: "Presentation server error",
      message: error.message
    }), requestId);
  }
});

async function routeApi(request, response, url, requestId) {
  const apiPath = url.pathname.slice(`${basePath}/api`.length) || "/";

  if (request.method === "GET" && apiPath === "/config") {
    writeResponse(response, jsonResponse(200, {
      mode: "openfaas-mod-b",
      basePath,
      openfaasGateway,
      prometheusUrl,
      grafanaUrl,
      services: services.map((service) => ({
        id: service.id,
        label: service.label
      }))
    }), requestId);
    return;
  }

  if (request.method === "GET" && apiPath === "/services") {
    writeResponse(response, jsonResponse(200, {
      services: await getServicesState()
    }), requestId);
    return;
  }

  if (request.method === "GET" && apiPath === "/metrics-summary") {
    writeResponse(response, jsonResponse(200, {
      services: await getMetricsSummary()
    }), requestId);
    return;
  }

  if (request.method === "POST" && apiPath === "/order") {
    const body = await parseJsonBody(request);
    const result = await postOrder(body);
    writeResponse(response, jsonResponse(200, result), requestId);
    return;
  }

  if (request.method === "POST" && apiPath === "/scenario") {
    const body = await parseJsonBody(request);
    const result = await applyScenario(body.scenario || "baseline");
    writeResponse(response, jsonResponse(200, result), requestId);
    return;
  }

  writeResponse(response, jsonResponse(404, { error: "API route not found" }), requestId);
}

async function getServicesState() {
  return Promise.all(services.map(async (service) => {
    const [health, faults] = await Promise.all([
      fetchJson(`${service.url}/healthz`),
      fetchJson(`${service.url}/faults`)
    ]);

    return {
      ...service,
      healthy: health.ok && health.body && health.body.status === "ok",
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
  try {
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
  } catch (error) {
    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    return {
      status: 503,
      ok: false,
      durationMs,
      body: {
        error: "OpenFaaS gateway'e bağlanılamadı",
        message: error.message,
        hint: "npm run port-forward:mod-b çalıştır ve k3d cluster'ın ayakta olduğundan emin ol"
      }
    };
  }
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

  const baseline = { latencyMs: 0, errorRate: 0, downstreamFail: false };
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
    return { serviceId, applied: false, error: "Unknown service" };
  }

  const response = await fetchJson(`${service.url}/faults`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    return { ok: false, status: 0, body: { error: error.message } };
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
    return { ok: false, status: 0, body: "", error: error.message };
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

  response.writeHead(200, { "content-type": contentType(filePath) });
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

function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

function normalizeBasePath(value) {
  const trimmed = String(value || "/ui").trim();
  if (trimmed === "/") {
    return "";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

server.on("error", (error) => {
  console.error(JSON.stringify({
    event: "presentation_ui_error",
    port,
    message: error.message
  }));
  process.exit(1);
});

server.listen(port, () => {
  console.log(JSON.stringify({
    event: "presentation_ui_started",
    port,
    basePath,
    url: `http://127.0.0.1:${port}${basePath}/`,
    openfaasGateway
  }));
});

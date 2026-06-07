"use strict";

const state = {
  services: [],
  metrics: [],
  samples: [],
  activeScenario: "baseline"
};

const scenarioLabels = {
  baseline: "Baseline",
  "payment-latency": "Payment +500 ms",
  "inventory-errors": "Inventory 40% 500",
  "notification-failure": "Notification failure",
  custom: "Custom"
};

const sampleOrder = () => ({
  orderId: `order-ui-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  customerId: "customer-dashboard",
  items: [
    { sku: "SKU-CHAOS-001", quantity: 1 },
    { sku: "SKU-CHAOS-002", quantity: 1 }
  ],
  payment: {
    amount: 49.99,
    currency: "USD",
    method: "card"
  }
});

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  refreshAll();
  setInterval(refreshAll, 2500);
});

function bindEvents() {
  document.getElementById("refreshButton").addEventListener("click", refreshAll);
  document.getElementById("sendOrderButton").addEventListener("click", () => sendOneOrder(true));
  document.getElementById("runLoadButton").addEventListener("click", runMiniLoad);
  document.getElementById("clearLogButton").addEventListener("click", () => {
    document.getElementById("eventLog").innerHTML = "";
  });

  for (const button of document.querySelectorAll(".scenario-button")) {
    button.addEventListener("click", async () => {
      await applyScenario(button.dataset.scenario);
    });
  }
}

async function refreshAll() {
  const [services, metrics] = await Promise.all([
    apiGet("/api/services"),
    apiGet("/api/metrics-summary")
  ]);

  state.services = services.services || [];
  state.metrics = metrics.services || [];
  state.activeScenario = inferScenario(state.services);
  render();
}

async function applyScenario(scenario) {
  setBusy(true);
  try {
    const result = await apiPost("/api/scenario", { scenario });
    state.activeScenario = result.scenario || scenario;
    state.samples = [];
    addEvent(`${scenarioLabels[state.activeScenario]} uygulandı`);
    await refreshAll();
  } finally {
    setBusy(false);
  }
}

async function sendOneOrder(logEvent) {
  setBusy(true);
  try {
    const result = await apiPost("/api/order", sampleOrder());
    state.samples.push({
      status: result.status,
      ok: result.ok,
      durationMs: result.durationMs
    });

    if (state.samples.length > 200) {
      state.samples.shift();
    }

    document.getElementById("responseOutput").textContent = JSON.stringify(result.body, null, 2);
    document.getElementById("lastLatency").textContent = `${result.durationMs} ms`;
    document.getElementById("lastRunStatus").textContent = result.ok ? "Başarılı" : `HTTP ${result.status}`;
    document.getElementById("lastRunStatus").className = `pill ${result.ok ? "ok" : "fail"}`;

    if (logEvent) {
      addEvent(`Sipariş tamamlandı: HTTP ${result.status}, ${result.durationMs} ms`);
    }

    renderSampleMetrics();
    await refreshAll();
    return result;
  } finally {
    setBusy(false);
  }
}

async function runMiniLoad() {
  const count = clamp(Number(document.getElementById("loadCount").value), 1, 100);
  setBusy(true);
  addEvent(`${count} istekli mini test başladı`);

  try {
    const results = [];
    for (let index = 0; index < count; index += 1) {
      const result = await apiPost("/api/order", sampleOrder());
      state.samples.push({
        status: result.status,
        ok: result.ok,
        durationMs: result.durationMs
      });
      results.push(result);
      renderSampleMetrics();
    }

    if (state.samples.length > 200) {
      state.samples = state.samples.slice(-200);
    }

    const errors = results.filter((result) => !result.ok).length;
    const durations = results.map((result) => result.durationMs);
    document.getElementById("responseOutput").textContent = JSON.stringify(results.at(-1).body, null, 2);
    document.getElementById("lastLatency").textContent = `${percentile(durations, 50)} ms P50`;
    document.getElementById("lastRunStatus").textContent = `${errors}/${count} hata`;
    document.getElementById("lastRunStatus").className = `pill ${errors > 0 ? "fail" : "ok"}`;
    addEvent(`Mini test bitti: ${count - errors} başarılı, ${errors} hata, P99 ${percentile(durations, 99)} ms`);
    await refreshAll();
  } finally {
    setBusy(false);
  }
}

function render() {
  renderServiceStrip();
  renderPipeline();
  renderMetricsTable();
  renderSampleMetrics();
  renderScenarioButtons();
}

function renderServiceStrip() {
  const container = document.getElementById("serviceStrip");
  container.innerHTML = state.services.map((service) => `
    <div class="service-chip">
      <div>
        <strong>${escapeHtml(service.label)}</strong>
        <small>${escapeHtml(service.url)}</small>
      </div>
      <span class="dot ${service.healthy ? "ok" : ""}" aria-label="${service.healthy ? "healthy" : "down"}"></span>
    </div>
  `).join("");
}

function renderPipeline() {
  const container = document.getElementById("pipeline");
  container.innerHTML = state.services.map((service) => {
    const faults = service.faults || {};
    const activeFault = faults.latencyMs > 0 || faults.errorRate > 0 || faults.downstreamFail;
    const className = !service.healthy ? "fail" : activeFault ? "warn" : "ok";

    return `
      <article class="function-node ${className}">
        <div class="node-title">
          <strong>${escapeHtml(service.label)}</strong>
          <span class="dot ${service.healthy ? "ok" : ""}"></span>
        </div>
        <div class="node-body">
          ${faultLine("Latency", `${faults.latencyMs || 0} ms`)}
          ${faultLine("Error rate", `${Math.round((faults.errorRate || 0) * 100)}%`)}
          ${faultLine("Downstream fail", faults.downstreamFail ? "true" : "false")}
        </div>
        <span class="pill ${activeFault ? "" : "neutral"}">${activeFault ? "Fault aktif" : "Normal"}</span>
      </article>
    `;
  }).join("");
}

function faultLine(label, value) {
  return `<div class="fault-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderMetricsTable() {
  const table = document.getElementById("metricsTable");
  table.innerHTML = state.metrics.map((metric) => `
    <tr>
      <td>${escapeHtml(metric.label)}</td>
      <td>${metric.requests || 0}</td>
      <td>${metric.errors || 0}</td>
      <td>${metric.faults || 0}</td>
      <td>${metric.durationAvgMs || 0} ms</td>
    </tr>
  `).join("");
}

function renderSampleMetrics() {
  const durations = state.samples.map((sample) => sample.durationMs);
  const errorCount = state.samples.filter((sample) => !sample.ok).length;
  const total = state.samples.length;

  document.getElementById("sampleSummary").textContent = `${total} örnek`;
  document.getElementById("p50Metric").textContent = total ? `${percentile(durations, 50)} ms` : "-";
  document.getElementById("p90Metric").textContent = total ? `${percentile(durations, 90)} ms` : "-";
  document.getElementById("p99Metric").textContent = total ? `${percentile(durations, 99)} ms` : "-";
  document.getElementById("errorRateMetric").textContent = total ? `${Math.round((errorCount / total) * 100)}%` : "-";
}

function renderScenarioButtons() {
  document.getElementById("activeScenario").textContent = scenarioLabels[state.activeScenario] || state.activeScenario;
  for (const button of document.querySelectorAll(".scenario-button")) {
    button.classList.toggle("active", button.dataset.scenario === state.activeScenario);
  }
}

function inferScenario(services) {
  const faults = Object.fromEntries(services.map((service) => [service.id, service.faults || {}]));
  const isBaseline = services.every((service) => isFault(service.faults, 0, 0, false));
  if (isBaseline) {
    return "baseline";
  }

  if (
    isFault(faults["order-validator"], 0, 0, false) &&
    isFault(faults["inventory-checker"], 0, 0, false) &&
    isFault(faults["payment-processor"], 500, 0, false) &&
    isFault(faults["notification-dispatcher"], 0, 0, false)
  ) {
    return "payment-latency";
  }

  if (
    isFault(faults["order-validator"], 0, 0, false) &&
    isFault(faults["inventory-checker"], 0, 0.4, false) &&
    isFault(faults["payment-processor"], 0, 0, false) &&
    isFault(faults["notification-dispatcher"], 0, 0, false)
  ) {
    return "inventory-errors";
  }

  if (
    isFault(faults["order-validator"], 0, 0, false) &&
    isFault(faults["inventory-checker"], 0, 0, false) &&
    isFault(faults["payment-processor"], 0, 0, false) &&
    isFault(faults["notification-dispatcher"], 0, 0, true)
  ) {
    return "notification-failure";
  }

  return "custom";
}

function isFault(faults, latencyMs, errorRate, downstreamFail) {
  const config = faults || {};
  return Number(config.latencyMs || 0) === latencyMs &&
    Number(config.errorRate || 0) === errorRate &&
    Boolean(config.downstreamFail) === downstreamFail;
}

function addEvent(message) {
  const log = document.getElementById("eventLog");
  const item = document.createElement("li");
  const now = new Date().toLocaleTimeString("tr-TR");
  item.innerHTML = `<time>${now}</time> ${escapeHtml(message)}`;
  log.prepend(item);

  while (log.children.length > 30) {
    log.removeChild(log.lastChild);
  }
}

async function apiGet(path) {
  const response = await fetch(path);
  return response.json();
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

function setBusy(busy) {
  for (const button of document.querySelectorAll("button")) {
    button.disabled = busy;
  }
}

function percentile(values, rank) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((rank / 100) * sorted.length) - 1;
  return sorted[clamp(index, 0, sorted.length - 1)];
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

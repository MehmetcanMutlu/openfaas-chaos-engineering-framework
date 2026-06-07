"use strict";

const stages = [
  {
    id: "order-validator",
    label: "Order Validator",
    purpose: "Payload ve iş kuralları doğrulanır."
  },
  {
    id: "inventory-checker",
    label: "Inventory Checker",
    purpose: "Mock stok dependency kontrol edilir."
  },
  {
    id: "payment-processor",
    label: "Payment Processor",
    purpose: "Latency-sensitive ödeme gateway simüle edilir."
  },
  {
    id: "notification-dispatcher",
    label: "Notification Dispatcher",
    purpose: "Final müşteri bildirimi dependency'si çağrılır."
  }
];

const scenarios = {
  baseline: {
    label: "A · Normal Baseline",
    target: "Yok",
    impact: "HTTP 200, düşük latency",
    narrative: "Baseline: fault yok. Sipariş Order Validator'dan Notification Dispatcher'a kadar başarılı ilerler."
  },
  "payment-latency": {
    label: "B · Payment Latency",
    target: "Payment Processor",
    impact: "HTTP 200 kalır, latency yaklaşık +500 ms artar",
    narrative: "Payment Processor middleware'i handler öncesi 500 ms bekler. Hata yoktur, ama senkron zincir nedeniyle uçtan uca latency yükselir."
  },
  "inventory-errors": {
    label: "C · Inventory Errors",
    target: "Inventory Checker",
    impact: "Yaklaşık %40 HTTP 500, downstream fonksiyonlara daha az trafik",
    narrative: "Inventory Checker middleware'i bazı istekleri handler'a girmeden HTTP 500 yapar. Bu isteklerde Payment ve Notification aşamalarına hiç gidilmez."
  },
  "notification-failure": {
    label: "D · Notification Failure",
    target: "Notification Dispatcher dependency",
    impact: "HTTP 500, hata zincirin başına geri yayılır",
    narrative: "Notification Dispatcher outbound provider çağrısı middleware tarafından synthetic failure'a çevrilir. Son aşamadaki hata Payment, Inventory ve Order Validator'a geri döner."
  },
  custom: {
    label: "Custom",
    target: "Özel fault ayarı",
    impact: "Aktif environment değişkenlerine göre değişir",
    narrative: "Sistemde dashboard senaryolarından farklı bir fault kombinasyonu aktif."
  }
};

const state = {
  services: [],
  metrics: [],
  samples: [],
  activeScenario: "baseline",
  lastTrace: [],
  lastResult: null
};

const sampleOrder = () => ({
  orderId: `order-demo-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
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
  document.getElementById("runLoadButton").addEventListener("click", runOrderExperiment);

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
    state.lastTrace = [];
    state.lastResult = null;
    document.getElementById("responseOutput").textContent = "{}";
    addEvent(`${scenarioTitle()} seçildi. Fault hedefi: ${scenarioConfig().target}.`);
    await refreshAll();
  } finally {
    setBusy(false);
  }
}

async function sendOneOrder(logEvent) {
  setBusy(true);
  try {
    const result = await apiPost("/api/order", sampleOrder());
    recordResult(result);

    if (logEvent) {
      const stage = failedStageLabel(state.lastTrace);
      const message = result.ok
        ? `Tek sipariş başarılı: HTTP ${result.status}, ${result.durationMs} ms.`
        : `Tek sipariş başarısız: HTTP ${result.status}, hata aşaması ${stage}.`;
      addEvent(message);
    }

    await refreshAll();
    return result;
  } finally {
    setBusy(false);
  }
}

async function runOrderExperiment() {
  const count = clamp(Number(document.getElementById("loadCount").value), 1, 100);
  setBusy(true);
  addEvent(`${count} siparişlik deney başladı: P50/P99 ve hata oranı ölçülüyor.`);

  try {
    const results = [];
    for (let index = 0; index < count; index += 1) {
      const result = await apiPost("/api/order", sampleOrder());
      recordResult(result, false);
      results.push(result);
      renderSampleMetrics();
      renderPipeline();
    }

    const errors = results.filter((result) => !result.ok).length;
    const durations = results.map((result) => result.durationMs);
    const errorRate = Math.round((errors / results.length) * 100);
    addEvent(`Deney bitti: ${results.length - errors}/${results.length} başarılı, hata oranı %${errorRate}, P99 ${percentile(durations, 99)} ms.`);
    await refreshAll();
  } finally {
    setBusy(false);
  }
}

function recordResult(result, updateResponse = true) {
  state.lastResult = result;
  state.lastTrace = extractTrace(result.body);
  state.samples.push({
    status: result.status,
    ok: result.ok,
    durationMs: result.durationMs
  });

  if (state.samples.length > 200) {
    state.samples.shift();
  }

  if (updateResponse) {
    document.getElementById("responseOutput").textContent = JSON.stringify(result.body, null, 2);
  }

  const statusText = result.ok ? "Başarılı" : `HTTP ${result.status}`;
  document.getElementById("lastRunStatus").textContent = statusText;
  document.getElementById("lastRunStatus").className = `pill ${result.ok ? "ok" : "fail"}`;
  document.getElementById("lastLatency").textContent = `${result.durationMs} ms`;
  document.getElementById("resultSummary").textContent = summarizeResult(result);

  renderSampleMetrics();
  renderPipeline();
}

function render() {
  renderServiceStrip();
  renderScenario();
  renderPipeline();
  renderMetricsTable();
  renderSampleMetrics();
}

function renderServiceStrip() {
  const container = document.getElementById("serviceStrip");
  container.innerHTML = state.services.map((service) => `
    <div class="service-chip">
      <div>
        <strong>${escapeHtml(service.label)}</strong>
        <small>${service.healthy ? "healthy" : "down"} · ${faultText(service.faults)}</small>
      </div>
      <span class="dot ${service.healthy ? "ok" : ""}" aria-label="${service.healthy ? "healthy" : "down"}"></span>
    </div>
  `).join("");
}

function renderScenario() {
  const scenario = scenarioConfig();
  document.getElementById("activeScenario").textContent = scenario.label;
  document.getElementById("scenarioNarrative").textContent = scenario.narrative;
  document.getElementById("faultTarget").textContent = scenario.target;
  document.getElementById("expectedImpact").textContent = scenario.impact;

  for (const button of document.querySelectorAll(".scenario-button")) {
    button.classList.toggle("active", button.dataset.scenario === state.activeScenario);
  }
}

function renderPipeline() {
  const container = document.getElementById("pipeline");
  const trace = state.lastTrace;
  const failureIndex = trace.findIndex((entry) => entry.status === "failed");

  container.innerHTML = stages.map((stage, index) => {
    const service = state.services.find((candidate) => candidate.id === stage.id) || {};
    const traceEntry = trace.find((entry) => entry.stage === stage.id);
    const activeFault = hasFault(service.faults);
    const stateName = stageState(traceEntry, index, failureIndex);
    const stateLabel = stateLabelFor(stateName);
    const message = traceEntry ? traceEntry.message : idleMessage(state, stage, activeFault);

    return `
      <article class="flow-step ${stateName} ${activeFault ? "faulted" : ""}">
        <div class="step-index">${index + 1}</div>
        <div class="step-content">
          <div class="step-title">
            <strong>${escapeHtml(stage.label)}</strong>
            <span class="status-pill ${stateName}">${stateLabel}</span>
          </div>
          <p>${escapeHtml(stage.purpose)}</p>
          <div class="step-message">${escapeHtml(message)}</div>
          <div class="fault-config">${escapeHtml(faultText(service.faults))}</div>
        </div>
      </article>
    `;
  }).join("");
}

function renderMetricsTable() {
  const container = document.getElementById("metricsTable");
  container.innerHTML = state.metrics.map((metric) => {
    const requests = metric.requests || 0;
    const errors = metric.errors || 0;
    const errorRate = requests > 0 ? Math.round((errors / requests) * 100) : 0;
    const width = Math.min(100, errorRate);

    return `
      <div class="metric-row">
        <div>
          <strong>${escapeHtml(metric.label)}</strong>
          <span>${requests} request · ${metric.faults || 0} injected fault · avg ${metric.durationAvgMs || 0} ms</span>
        </div>
        <div class="error-meter" aria-label="error rate">
          <span style="width:${width}%"></span>
        </div>
        <b>${errorRate}% error</b>
      </div>
    `;
  }).join("");
}

function renderSampleMetrics() {
  const durations = state.samples.map((sample) => sample.durationMs);
  const errorCount = state.samples.filter((sample) => !sample.ok).length;
  const total = state.samples.length;

  document.getElementById("sampleSummary").textContent = String(total);
  document.getElementById("p50Metric").textContent = total ? `${percentile(durations, 50)} ms` : "-";
  document.getElementById("p99Metric").textContent = total ? `${percentile(durations, 99)} ms` : "-";
  document.getElementById("errorRateMetric").textContent = total ? `%${Math.round((errorCount / total) * 100)}` : "-";
}

function stageState(traceEntry, index, failureIndex) {
  if (traceEntry && traceEntry.status === "failed") {
    return "failed";
  }

  if (traceEntry && traceEntry.status === "success") {
    return "success";
  }

  if (failureIndex >= 0 && index > failureIndex) {
    return "skipped";
  }

  return state.lastResult ? "skipped" : "idle";
}

function stateLabelFor(stateName) {
  return {
    success: "completed",
    failed: "failed",
    skipped: "not reached",
    idle: "waiting"
  }[stateName];
}

function idleMessage(appState, stage, activeFault) {
  if (!appState.lastResult && activeFault) {
    return "Bu fonksiyonda fault aktif. Sipariş çalıştırınca etkisi burada görülecek.";
  }

  if (!appState.lastResult) {
    return "Sipariş bekleniyor.";
  }

  return "Önceki aşamadaki hata nedeniyle bu fonksiyona istek gitmedi.";
}

function summarizeResult(result) {
  const scenario = scenarioConfig();
  if (!result) {
    return "Bir sipariş çalıştırınca burada zincirin sonucu ve hata nedeni görünür.";
  }

  if (result.ok) {
    return `${scenario.label}: sipariş başarıyla tamamlandı. End-to-end latency ${result.durationMs} ms.`;
  }

  return `${scenario.label}: sipariş HTTP ${result.status} döndü. İlk hata aşaması: ${failedStageLabel(state.lastTrace)}.`;
}

function extractTrace(body) {
  if (!body || typeof body !== "object") {
    return [];
  }

  if (Array.isArray(body.trace)) {
    return body.trace;
  }

  if (body.downstream) {
    return extractTrace(body.downstream);
  }

  if (body.pipeline) {
    return extractTrace(body.pipeline);
  }

  return [];
}

function failedStageLabel(trace) {
  const failed = trace.find((entry) => entry.status === "failed");
  if (!failed) {
    return "yok";
  }

  const stage = stages.find((candidate) => candidate.id === failed.stage);
  return stage ? stage.label : failed.stage;
}

function scenarioConfig() {
  return scenarios[state.activeScenario] || scenarios.custom;
}

function scenarioTitle() {
  return scenarioConfig().label;
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

function hasFault(faults) {
  const config = faults || {};
  return Number(config.latencyMs || 0) > 0 ||
    Number(config.errorRate || 0) > 0 ||
    Boolean(config.downstreamFail);
}

function faultText(faults) {
  const config = faults || {};
  const parts = [];

  if (Number(config.latencyMs || 0) > 0) {
    parts.push(`latency ${config.latencyMs} ms`);
  }

  if (Number(config.errorRate || 0) > 0) {
    parts.push(`error %${Math.round(Number(config.errorRate) * 100)}`);
  }

  if (config.downstreamFail) {
    parts.push("downstream fail");
  }

  return parts.length > 0 ? parts.join(" · ") : "fault yok";
}

function addEvent(message) {
  const log = document.getElementById("eventLog");
  const item = document.createElement("li");
  const now = new Date().toLocaleTimeString("tr-TR");
  item.innerHTML = `<time>${now}</time> ${escapeHtml(message)}`;
  log.prepend(item);

  while (log.children.length > 20) {
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

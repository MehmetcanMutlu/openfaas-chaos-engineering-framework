"use strict";

const { spawn, execSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CLUSTER_NAME = process.env.K3D_CLUSTER_NAME || "openfaas-chaos";
const KUBECONFIG_FILE = path.resolve(ROOT, process.env.KUBECONFIG_FILE || "tmp/run/kubeconfig");
const GATEWAY_PORT = Number(process.env.GATEWAY_INTERNAL_PORT || 18088);
const UI_PORT = Number(process.env.PRESENTATION_PORT || 8088);
const PROMETHEUS_PORT = Number(process.env.PROMETHEUS_LOCAL_PORT || 9090);
const GRAFANA_PORT = Number(process.env.GRAFANA_LOCAL_PORT || 3002);

const children = [];

function run(cmd, args, options = {}) {
  return spawn(cmd, args, {
    cwd: ROOT,
    stdio: options.stdio || "pipe",
    env: {
      ...process.env,
      KUBECONFIG: KUBECONFIG_FILE,
      ...options.env
    }
  });
}

function ensureCluster() {
  fs.mkdirSync(path.dirname(KUBECONFIG_FILE), { recursive: true });

  try {
    execSync("docker info", { stdio: "ignore" });
  } catch {
    console.error("Docker çalışmıyor. Docker Desktop'ı aç ve tekrar dene.");
    process.exit(1);
  }

  const list = execSync("k3d cluster list", { encoding: "utf8" });
  if (!list.split("\n").some((line) => line.startsWith(`${CLUSTER_NAME} `))) {
    console.error(`k3d cluster '${CLUSTER_NAME}' bulunamadı. Önce: npm run setup:mod-b`);
    process.exit(1);
  }

  const status = list.split("\n").find((line) => line.startsWith(`${CLUSTER_NAME} `));
  if (status && status.includes("0/1")) {
    console.log(`k3d cluster '${CLUSTER_NAME}' durmuş. Başlatılıyor...`);
    execSync(`k3d cluster start ${CLUSTER_NAME}`, { stdio: "inherit" });
  }

  const kubeconfig = execSync(`k3d kubeconfig get ${CLUSTER_NAME}`, { encoding: "utf8" });
  fs.writeFileSync(KUBECONFIG_FILE, kubeconfig);

  execSync("kubectl cluster-info", {
    env: { ...process.env, KUBECONFIG: KUBECONFIG_FILE },
    stdio: "ignore"
  });
}

function killPort(port) {
  try {
    const pids = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) {
      process.kill(Number(pid), "SIGTERM");
    }
  } catch {
    // port free
  }
}

function startForward(namespace, service, localPort, remotePort) {
  const logPath = path.join(ROOT, "tmp", "run", `port-forward-${service}.log`);
  const log = fs.createWriteStream(logPath, { flags: "a" });

  const child = run("kubectl", [
    "port-forward",
    "-n", namespace,
    `svc/${service}`,
    `${localPort}:${remotePort}`
  ]);

  child.stdout.pipe(log);
  child.stderr.pipe(log);

  child.on("exit", (code) => {
    console.error(`[supervisor] port-forward ${service} exited (${code}). Yeniden başlatılıyor...`);
    setTimeout(() => startForward(namespace, service, localPort, remotePort), 2000);
  });

  children.push(child);
  return child;
}

function startPresentationServer() {
  const logPath = path.join(ROOT, "tmp", "run", "presentation-ui.log");
  const log = fs.createWriteStream(logPath, { flags: "a" });

  const child = run("node", ["src/presentation-server.js"], {
    env: {
      OPENFAAS_GATEWAY: `http://127.0.0.1:${GATEWAY_PORT}`,
      PRESENTATION_PORT: String(UI_PORT),
      PROMETHEUS_URL: `http://127.0.0.1:${PROMETHEUS_PORT}`,
      GRAFANA_URL: `http://127.0.0.1:${GRAFANA_PORT}`,
      UI_BASE_PATH: "/ui"
    }
  });

  child.stdout.pipe(log);
  child.stderr.pipe(log);

  child.on("exit", (code) => {
    console.error(`[supervisor] presentation UI exited (${code}). Yeniden başlatılıyor...`);
    setTimeout(startPresentationServer, 2000);
  });

  children.push(child);
  return child;
}

function waitForPort(port, label, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const tick = () => {
      const req = http.request({ host: "127.0.0.1", port, path: "/", method: "GET", timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`${label} port ${port} hazır değil`));
          return;
        }
        setTimeout(tick, 500);
      });

      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`${label} port ${port} zaman aşımı`));
          return;
        }
        setTimeout(tick, 500);
      });

      req.end();
    };

    tick();
  });
}

function shutdown() {
  console.log("\n[supervisor] Kapatılıyor...");
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}

async function main() {
  fs.mkdirSync(path.join(ROOT, "tmp", "run"), { recursive: true });

  console.log("[supervisor] Cluster kontrol ediliyor...");
  ensureCluster();

  for (const port of [GATEWAY_PORT, UI_PORT, PROMETHEUS_PORT, GRAFANA_PORT]) {
    killPort(port);
  }

  console.log("[supervisor] Port-forward'lar başlatılıyor...");
  startForward("openfaas", "gateway", GATEWAY_PORT, 8080);
  startForward("openfaas", "prometheus", PROMETHEUS_PORT, 9090);
  startForward("monitoring", "grafana", GRAFANA_PORT, 80);

  await waitForPort(GATEWAY_PORT, "OpenFaaS gateway");
  await waitForPort(PROMETHEUS_PORT, "Prometheus");
  await waitForPort(GRAFANA_PORT, "Grafana");

  console.log("[supervisor] Sunum UI başlatılıyor...");
  startPresentationServer();
  await waitForPort(UI_PORT, "Sunum UI");

  console.log("");
  console.log("Mod B hazır — bu terminali açık tut:");
  console.log(`  Sunum UI:         http://127.0.0.1:${UI_PORT}/ui/`);
  console.log(`  OpenFaaS gateway: http://127.0.0.1:${GATEWAY_PORT}`);
  console.log(`  Prometheus:       http://127.0.0.1:${PROMETHEUS_PORT}`);
  console.log(`  Grafana:          http://127.0.0.1:${GRAFANA_PORT}`);
  console.log(`  KUBECONFIG:       ${KUBECONFIG_FILE}`);
  console.log("");
  console.log("Durdurmak için Ctrl+C");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error(`[supervisor] Hata: ${error.message}`);
  process.exit(1);
});

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

export const options = {
  scenarios: {
    steady_order_flow: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || "60s"
    }
  },
  summaryTrendStats: ["min", "avg", "med", "p(50)", "p(90)", "p(99)", "max"]
};

const orderFlowLatency = new Trend("order_flow_latency", true);
const orderFlowStatus200 = new Rate("order_flow_status_200");
const orderFlowStatus500 = new Rate("order_flow_status_500");
const orderFlow2xx = new Counter("order_flow_2xx_total");
const orderFlow5xx = new Counter("order_flow_5xx_total");

const targetUrl = __ENV.ORDER_VALIDATOR_URL || "http://127.0.0.1:8080/function/order-validator";
const scenarioName = __ENV.SCENARIO || "baseline";

export default function () {
  const payload = JSON.stringify({
    orderId: `order-${scenarioName}-${__VU}-${__ITER}`,
    customerId: `customer-${__VU}`,
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

  const response = http.post(targetUrl, payload, {
    headers: {
      "content-type": "application/json"
    },
    tags: {
      scenario: scenarioName,
      flow: "order-processing"
    }
  });

  orderFlowLatency.add(response.timings.duration, { scenario: scenarioName });
  orderFlowStatus200.add(response.status === 200, { scenario: scenarioName });
  orderFlowStatus500.add(response.status >= 500, { scenario: scenarioName });

  if (response.status >= 200 && response.status < 300) {
    orderFlow2xx.add(1, { scenario: scenarioName });
  }

  if (response.status >= 500) {
    orderFlow5xx.add(1, { scenario: scenarioName });
  }

  check(response, {
    "status is 200 or 500": (res) => res.status === 200 || res.status >= 500,
    "response has request id": (res) => Boolean(res.headers["X-Request-Id"])
  });

  sleep(Number(__ENV.THINK_TIME_SECONDS || 0.1));
}


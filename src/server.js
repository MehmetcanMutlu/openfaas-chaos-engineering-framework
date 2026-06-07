"use strict";

const http = require("http");
const { randomUUID } = require("crypto");
const { getHandler } = require("./functions");
const { getFaultConfig, readBooleanEnv, setFaultConfig } = require("./shared/config");
const { withFaultInjection } = require("./shared/faultMiddleware");
const { metrics } = require("./shared/metrics");
const { jsonResponse, parseJsonBody, writeResponse } = require("./shared/response");

const functionName = process.env.FUNCTION_NAME || "order-validator";
const port = Number(process.env.PORT || 8080);
const coreHandler = getHandler(functionName);
const handler = withFaultInjection(functionName, coreHandler);

const server = http.createServer(async (request, response) => {
  const requestId = request.headers["x-request-id"] || randomUUID();
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      writeResponse(response, jsonResponse(200, {
        status: "ok",
        function: functionName
      }), requestId);
      return;
    }

    if (request.method === "GET" && url.pathname === "/metrics") {
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4",
        "x-request-id": requestId
      });
      response.end(metrics.render());
      return;
    }

    if (request.method === "GET" && url.pathname === "/faults") {
      writeResponse(response, jsonResponse(200, {
        function: functionName,
        faultControlEnabled: readBooleanEnv("ENABLE_FAULT_CONTROL"),
        faults: getFaultConfig()
      }), requestId);
      return;
    }

    if (request.method === "POST" && url.pathname === "/faults") {
      if (!readBooleanEnv("ENABLE_FAULT_CONTROL")) {
        writeResponse(response, jsonResponse(403, {
          error: "Fault control endpoint is disabled",
          hint: "Set ENABLE_FAULT_CONTROL=true for local demo control"
        }), requestId);
        return;
      }

      const body = await parseJsonBody(request);
      const faults = setFaultConfig(body);
      writeResponse(response, jsonResponse(200, {
        function: functionName,
        faults
      }), requestId);
      return;
    }

    if (request.method !== "POST") {
      writeResponse(response, jsonResponse(405, {
        error: "Method not allowed",
        allowed: ["POST", "GET /healthz", "GET /metrics", "GET /faults", "POST /faults"]
      }), requestId);
      return;
    }

    const body = await parseJsonBody(request);
    const result = await handler({
      requestId,
      functionName,
      method: request.method,
      path: url.pathname,
      headers: request.headers,
      body
    });

    writeResponse(response, result, requestId);
  } catch (error) {
    writeResponse(response, jsonResponse(400, {
      error: "Invalid request",
      message: error.message
    }), requestId);
  }
});

server.listen(port, () => {
  console.log(JSON.stringify({
    event: "server_started",
    function: functionName,
    port
  }));
});

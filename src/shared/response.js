"use strict";

function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body
  };
}

function normalizeResponse(result) {
  if (!result) {
    return jsonResponse(204, null);
  }

  if (typeof result.statusCode === "number") {
    return {
      statusCode: result.statusCode,
      headers: {
        "content-type": "application/json",
        ...(result.headers || {})
      },
      body: result.body
    };
  }

  return jsonResponse(200, result);
}

async function parseJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return {};
  }

  return JSON.parse(raw);
}

function writeResponse(response, result, requestId) {
  const normalized = normalizeResponse(result);
  const body = normalized.body === null || normalized.body === undefined
    ? ""
    : JSON.stringify(normalized.body);

  response.writeHead(normalized.statusCode, {
    ...normalized.headers,
    "x-request-id": requestId
  });
  response.end(body);
}

function outcomeForStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) {
    return "success";
  }
  if (statusCode >= 400 && statusCode < 500) {
    return "client_error";
  }
  return "error";
}

module.exports = {
  jsonResponse,
  normalizeResponse,
  outcomeForStatus,
  parseJsonBody,
  writeResponse
};


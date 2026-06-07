"use strict";

const DEFAULT_BUCKETS = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.075,
  0.1,
  0.15,
  0.25,
  0.5,
  0.75,
  1,
  2.5,
  5,
  10
];

const DEFINITIONS = {
  chaos_function_requests_total: {
    type: "counter",
    help: "Total wrapped function requests by function, outcome, and status code."
  },
  chaos_fault_injections_total: {
    type: "counter",
    help: "Total faults injected by the middleware."
  },
  chaos_downstream_requests_total: {
    type: "counter",
    help: "Total outbound dependency calls by target and outcome."
  },
  chaos_function_duration_seconds: {
    type: "histogram",
    help: "Wrapped function execution duration in seconds."
  },
  chaos_downstream_duration_seconds: {
    type: "histogram",
    help: "Outbound dependency call duration in seconds."
  }
};

class MetricsRegistry {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
  }

  inc(name, labels, value = 1) {
    const key = metricKey(name, labels);
    const current = this.counters.get(key);
    if (current) {
      current.value += value;
      return;
    }

    this.counters.set(key, {
      name,
      labels: { ...labels },
      value
    });
  }

  observe(name, labels, value, buckets = DEFAULT_BUCKETS) {
    const key = metricKey(name, labels);
    let current = this.histograms.get(key);
    if (!current) {
      current = {
        name,
        labels: { ...labels },
        buckets: new Map(buckets.map((bucket) => [bucket, 0])),
        sum: 0,
        count: 0
      };
      this.histograms.set(key, current);
    }

    current.sum += value;
    current.count += 1;

    for (const bucket of current.buckets.keys()) {
      if (value <= bucket) {
        current.buckets.set(bucket, current.buckets.get(bucket) + 1);
      }
    }
  }

  render() {
    const lines = [];
    const renderedDefinitions = new Set();

    for (const metric of this.counters.values()) {
      renderDefinition(lines, renderedDefinitions, metric.name);
      lines.push(`${metric.name}${formatLabels(metric.labels)} ${metric.value}`);
    }

    for (const metric of this.histograms.values()) {
      renderDefinition(lines, renderedDefinitions, metric.name);
      for (const [bucket, count] of metric.buckets.entries()) {
        lines.push(`${metric.name}_bucket${formatLabels({ ...metric.labels, le: bucket })} ${count}`);
      }
      lines.push(`${metric.name}_bucket${formatLabels({ ...metric.labels, le: "+Inf" })} ${metric.count}`);
      lines.push(`${metric.name}_sum${formatLabels(metric.labels)} ${metric.sum}`);
      lines.push(`${metric.name}_count${formatLabels(metric.labels)} ${metric.count}`);
    }

    lines.push("");
    return lines.join("\n");
  }
}

function metricKey(name, labels) {
  return `${name}:${JSON.stringify(sortLabels(labels))}`;
}

function sortLabels(labels) {
  return Object.fromEntries(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)));
}

function renderDefinition(lines, renderedDefinitions, name) {
  if (renderedDefinitions.has(name)) {
    return;
  }

  const definition = DEFINITIONS[name] || {
    type: "gauge",
    help: "Application metric."
  };

  lines.push(`# HELP ${name} ${definition.help}`);
  lines.push(`# TYPE ${name} ${definition.type}`);
  renderedDefinitions.add(name);
}

function formatLabels(labels) {
  const entries = Object.entries(sortLabels(labels));
  if (entries.length === 0) {
    return "";
  }

  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

const metrics = new MetricsRegistry();

module.exports = {
  DEFAULT_BUCKETS,
  MetricsRegistry,
  metrics
};


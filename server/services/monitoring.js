import client from "prom-client";
import { config } from "../config.js";

client.collectDefaultMetrics({
  prefix: "whatscrm_",
  labels: { service: config.telemetry.serviceName },
});

export const httpRequestDuration = new client.Histogram({
  name: "whatscrm_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const httpRequestsTotal = new client.Counter({
  name: "whatscrm_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
});

export function metricsMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const duration = Number(process.hrtime.bigint() - started) / 1e9;
    const route = req.route?.path || req.path || "unknown";
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });
  next();
}

export async function metricsText() {
  return client.register.metrics();
}

export function metricsContentType() {
  return client.register.contentType;
}

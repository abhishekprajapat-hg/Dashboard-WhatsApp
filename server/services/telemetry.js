import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { config } from "../config.js";

let sdk;

export function startTelemetry() {
  if (!config.telemetry.enabled || sdk) return { enabled: Boolean(sdk), status: sdk ? "started" : "disabled" };
  sdk = new NodeSDK({
    serviceName: config.telemetry.serviceName,
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  return { enabled: true, status: "started" };
}

export async function shutdownTelemetry() {
  if (!sdk) return;
  await sdk.shutdown();
}

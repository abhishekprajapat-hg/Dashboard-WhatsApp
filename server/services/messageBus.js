import amqplib from "amqplib";
import { config } from "../config.js";
// Circular import, same accepted shape as jobs.js <-> automationEngine.js: featureFlags.js calls
// connectRabbitMQ/disconnectRabbitMQ (below) to make rabbitmqEvents live-toggleable, and this file
// calls getFlagSync back. Safe because both sides only call the imported function from inside a
// function body, never at module-eval time.
import { getFlagSync } from "./featureFlags.js";
import { logger } from "./logger.js";

let connection;
let channel;

export async function connectRabbitMQ() {
  if (!config.rabbitmqUrl || !getFlagSync("rabbitmqEvents")) return { enabled: false, status: "disabled" };
  if (channel) return { enabled: true, status: "ready" };

  try {
    connection = await amqplib.connect(config.rabbitmqUrl);
    channel = await connection.createChannel();
    await channel.assertExchange("whatscrm.events", "topic", { durable: true });
    connection.on("close", () => {
      channel = null;
      connection = null;
    });
    return { enabled: true, status: "ready" };
  } catch (error) {
    logger.warn({ err: error }, "RabbitMQ connection failed");
    return { enabled: true, status: "unavailable", error: error.message };
  }
}

export async function disconnectRabbitMQ() {
  if (!connection) {
    channel = null;
    return { enabled: false, status: "disabled" };
  }
  try {
    await connection.close();
  } catch (error) {
    logger.warn({ err: error }, "RabbitMQ disconnect failed");
  }
  channel = null;
  connection = null;
  return { enabled: false, status: "disabled" };
}

export async function publishEvent(routingKey, payload = {}) {
  if (!channel) return { published: false, reason: "rabbitmq_not_connected" };
  const body = Buffer.from(JSON.stringify({ routingKey, publishedAt: new Date().toISOString(), payload }));
  channel.publish("whatscrm.events", routingKey, body, { persistent: true, contentType: "application/json" });
  return { published: true };
}

export function rabbitStatus() {
  return {
    enabled: Boolean(config.rabbitmqUrl && getFlagSync("rabbitmqEvents")),
    status: channel ? "ready" : "disabled",
  };
}

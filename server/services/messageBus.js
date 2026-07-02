import amqplib from "amqplib";
import { config } from "../config.js";

let connection;
let channel;

export async function connectRabbitMQ() {
  if (!config.rabbitmqUrl || !config.featureFlags.rabbitmqEvents) return { enabled: false, status: "disabled" };
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
    console.warn("RabbitMQ connection failed:", error.message);
    return { enabled: true, status: "unavailable", error: error.message };
  }
}

export async function publishEvent(routingKey, payload = {}) {
  if (!channel) return { published: false, reason: "rabbitmq_not_connected" };
  const body = Buffer.from(JSON.stringify({ routingKey, publishedAt: new Date().toISOString(), payload }));
  channel.publish("whatscrm.events", routingKey, body, { persistent: true, contentType: "application/json" });
  return { published: true };
}

export function rabbitStatus() {
  return {
    enabled: Boolean(config.rabbitmqUrl && config.featureFlags.rabbitmqEvents),
    status: channel ? "ready" : "disabled",
  };
}

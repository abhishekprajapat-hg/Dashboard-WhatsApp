import "dotenv/config";

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listFromEnv(name) {
  return (process.env[name] || "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: numberFromEnv("PORT", 4000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  // Deliberately independent of jwtSecret: rotating the JWT secret (a routine security practice)
  // must never make previously-encrypted WhatsApp credentials permanently undecryptable.
  credentialEncryptionSecret: process.env.WHATSAPP_CREDENTIAL_SECRET || process.env.CREDENTIAL_ENCRYPTION_KEY || "dev-only-credential-secret-change-me",
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || "v21.0",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "local-whatsapp-verify-token",
  demoMode: process.env.DEMO_MODE !== "false",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  cdnBaseUrl: process.env.CDN_BASE_URL || "",
  corsOrigins: listFromEnv("CORS_ORIGINS"),
  redisUrl: process.env.REDIS_URL || "",
  rabbitmqUrl: process.env.RABBITMQ_URL || "",
  rateLimitWindowMs: numberFromEnv("RATE_LIMIT_WINDOW_MS", 60000),
  rateLimitMax: numberFromEnv("RATE_LIMIT_MAX", 600),
  s3: {
    enabled: process.env.MEDIA_STORAGE_DRIVER === "s3",
    bucket: process.env.S3_BUCKET || "",
    region: process.env.S3_REGION || "ap-south-1",
    endpoint: process.env.S3_ENDPOINT || "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  },
  telemetry: {
    serviceName: process.env.OTEL_SERVICE_NAME || "whatscrm-api",
    enabled: process.env.OTEL_ENABLED === "true",
  },
  featureFlags: {
    infrastructurePanel: process.env.FEATURE_INFRASTRUCTURE_PANEL !== "false",
    queueProcessing: process.env.FEATURE_QUEUE_PROCESSING !== "false",
    s3MediaStorage: process.env.FEATURE_S3_MEDIA_STORAGE === "true" || process.env.MEDIA_STORAGE_DRIVER === "s3",
    rabbitmqEvents: process.env.FEATURE_RABBITMQ_EVENTS === "true",
    zeroDowntimeMode: process.env.FEATURE_ZERO_DOWNTIME_MODE !== "false",
  },
};

export function validateProductionConfig() {
  if (config.nodeEnv !== "production") return;
  const missing = [];
  if (!process.env.JWT_SECRET || config.jwtSecret === "dev-only-secret-change-me") {
    missing.push("JWT_SECRET");
  } else if (config.jwtSecret.length < 32) {
    missing.push("JWT_SECRET (minimum 32 characters)");
  }
  if (!process.env.WHATSAPP_CREDENTIAL_SECRET && !process.env.CREDENTIAL_ENCRYPTION_KEY) {
    missing.push("WHATSAPP_CREDENTIAL_SECRET (or CREDENTIAL_ENCRYPTION_KEY)");
  } else if (config.credentialEncryptionSecret.length < 32) {
    missing.push("WHATSAPP_CREDENTIAL_SECRET (minimum 32 characters)");
  }
  if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");
  if (config.s3.enabled && !config.s3.bucket) missing.push("S3_BUCKET");
  if (missing.length) {
    throw new Error(`Production configuration missing secure values: ${missing.join(", ")}`);
  }
}

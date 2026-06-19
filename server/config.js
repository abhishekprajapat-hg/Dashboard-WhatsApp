import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || "v21.0",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "local-whatsapp-verify-token",
  demoMode: process.env.DEMO_MODE !== "false",
};

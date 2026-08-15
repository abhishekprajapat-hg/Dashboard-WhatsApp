import mongoose from "mongoose";
import { config } from "./config.js";
import { logger } from "./services/logger.js";

mongoose.set("sanitizeFilter", true);
mongoose.set("strictQuery", true);

export async function connectDatabase() {
  if (config.demoMode) {
    logger.info("Demo mode enabled. MongoDB connection skipped.");
    return;
  }

  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  logger.info("MongoDB connected.");
}

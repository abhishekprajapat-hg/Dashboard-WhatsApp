import mongoose from "mongoose";
import { config } from "./config.js";

export async function connectDatabase() {
  if (config.demoMode) {
    console.log("Demo mode enabled. MongoDB connection skipped.");
    return;
  }

  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log("MongoDB connected.");
}

import "dotenv/config";
import mongoose from "mongoose";
import { pruneAuditLogs } from "../services/auditLogRetention.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";

async function main() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

  const results = await pruneAuditLogs();
  let totalDeleted = 0;
  for (const result of results) {
    console.log(`${result.workspaceName}: deleted ${result.deletedCount} audit log entries older than ${result.retentionDays} days (cutoff ${result.cutoff.toISOString()})`);
    totalDeleted += result.deletedCount;
  }
  console.log(`Done. ${results.length} workspace(s) swept, ${totalDeleted} total entries deleted.`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Audit log prune failed.", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

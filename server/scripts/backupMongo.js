import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { EJSON } from "bson";

// Pure-driver backup, no mongodump dependency - this repo's own environment notes are full of
// binaries that turn out missing/misbehaving on a given machine (see HANDOFF.md's "Environment
// gotchas"), so this only relies on the mongodb/mongoose driver already required to run the app at
// all. EJSON (not plain JSON) round-trips ObjectId/Date/Buffer correctly - the whole point of a
// backup is that restoreMongoDrill.js can read it back byte-for-byte equivalent.

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";
const backupRoot = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function backup() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const dbName = db.databaseName;

  const startedAt = new Date();
  const runDir = path.join(backupRoot, timestampSlug(startedAt));
  fs.mkdirSync(runDir, { recursive: true });

  const collections = await db.listCollections().toArray();
  const manifest = { dbName, startedAt: startedAt.toISOString(), collections: [] };

  for (const { name } of collections) {
    if (name.startsWith("system.")) continue;
    const documents = await db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(runDir, `${name}.json`), EJSON.stringify(documents, { relaxed: false }));
    manifest.collections.push({ name, documentCount: documents.length });
    console.log(`  ${name}: ${documents.length} document(s)`);
  }

  manifest.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Backup of "${dbName}" written to ${runDir} (${manifest.collections.length} collections).`);

  pruneOldBackups();
  await mongoose.disconnect();
  return runDir;
}

// Retention half of "backup restore drills and data retention jobs" - keeps the most recent
// backups within the window, deletes the rest. Never touches the run currently being written.
function pruneOldBackups() {
  if (!fs.existsSync(backupRoot)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(backupRoot, entry.name);
    const manifestPath = path.join(dirPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const { startedAt } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (new Date(startedAt).getTime() < cutoff) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`  pruned old backup: ${entry.name} (older than ${retentionDays}d)`);
    }
  }
}

backup().catch(async (error) => {
  console.error("Backup failed.", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

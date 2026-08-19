import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { EJSON } from "bson";

// A "drill" on purpose: restores into a separate _restore_drill database by default, never the
// real one a bare MONGODB_URI points at, so running this can never silently clobber live data.
// Pass --confirm-overwrite-target to actually restore into the exact URI in MONGODB_URI/--target.

const args = process.argv.slice(2);
const backupDirArg = args.find((arg) => !arg.startsWith("--"));
const targetArg = args.find((arg) => arg.startsWith("--target="))?.split("=")[1];
const confirmOverwrite = args.includes("--confirm-overwrite-target");

const backupRoot = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const sourceUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";

function resolveBackupDir() {
  if (!backupDirArg) {
    const runs = fs.readdirSync(backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (!runs.length) throw new Error(`No backups found under ${backupRoot}. Pass a run directory name explicitly.`);
    return path.join(backupRoot, runs[runs.length - 1]);
  }
  return path.isAbsolute(backupDirArg) ? backupDirArg : path.join(backupRoot, backupDirArg);
}

function resolveTargetUri(dbName) {
  if (targetArg) return targetArg;
  if (confirmOverwrite) return sourceUri;
  // Default: same host/credentials as MONGODB_URI, different database name - a real restore
  // drill needs a real MongoDB connection, just not the production database itself.
  const url = new URL(sourceUri.replace("mongodb://", "http://").replace("mongodb+srv://", "http://"));
  return sourceUri.replace(url.pathname, `/${dbName}_restore_drill`);
}

async function restore() {
  const runDir = resolveBackupDir();
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
  const targetUri = resolveTargetUri(manifest.dbName);

  if (targetUri === sourceUri && !confirmOverwrite) {
    throw new Error("Refusing to restore into the source URI without --confirm-overwrite-target.");
  }

  console.log(`Restoring backup from ${runDir} (taken ${manifest.startedAt}) into ${targetUri.replace(/:\/\/.*@/, "://***@")}`);
  await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;

  const results = [];
  for (const { name, documentCount } of manifest.collections) {
    const filePath = path.join(runDir, `${name}.json`);
    const documents = EJSON.parse(fs.readFileSync(filePath, "utf8"));
    const collection = db.collection(name);
    await collection.deleteMany({});
    if (documents.length) await collection.insertMany(documents, { ordered: false });
    const restoredCount = await collection.countDocuments({});
    const ok = restoredCount === documentCount;
    results.push({ name, expected: documentCount, restored: restoredCount, ok });
    console.log(`  ${name}: expected ${documentCount}, restored ${restoredCount} ${ok ? "OK" : "MISMATCH"}`);
  }

  await mongoose.disconnect();

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    console.error(`Restore drill FAILED - ${failed.length} collection(s) don't match the backup's document counts.`);
    process.exit(1);
  }
  console.log(`Restore drill PASSED - all ${results.length} collections match the backup exactly.`);
}

restore().catch(async (error) => {
  console.error("Restore drill failed.", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

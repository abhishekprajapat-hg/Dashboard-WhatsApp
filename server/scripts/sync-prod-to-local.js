import "dotenv/config";
import { MongoClient } from "mongodb";

const prodUri = process.env.PROD_MONGODB_URI;
const localUri = process.env.LOCAL_MONGODB_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";
const allowSync = process.env.ALLOW_PROD_TO_LOCAL_SYNC === "yes";

function assertSafeLocalUri(uri) {
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error("LOCAL_MONGODB_URI must be a MongoDB connection string.");
  }

  if (!/(127\.0\.0\.1|localhost|\[::1\])/.test(uri)) {
    throw new Error("Refusing to restore into a non-local MongoDB URI.");
  }

  if (/mongodb\+srv:\/\//.test(uri)) {
    throw new Error("Refusing to restore into a MongoDB SRV URI.");
  }
}

function shouldCopyCollection(name) {
  return !name.startsWith("system.");
}

async function copyIndexes(sourceCollection, targetCollection) {
  const indexes = await sourceCollection.indexes();
  const customIndexes = indexes.filter((index) => index.name !== "_id_");

  for (const index of customIndexes) {
    const { key, name, ns, v, ...options } = index;
    await targetCollection.createIndex(key, { ...options, name });
  }
}

async function copyCollection(sourceDb, targetDb, name) {
  const sourceCollection = sourceDb.collection(name);
  const targetCollection = targetDb.collection(name);
  let copied = 0;
  let batch = [];

  const cursor = sourceCollection.find({}, { noCursorTimeout: true });
  try {
    for await (const document of cursor) {
      batch.push(document);
      if (batch.length >= 500) {
        await targetCollection.insertMany(batch, { ordered: false });
        copied += batch.length;
        batch = [];
      }
    }
  } finally {
    await cursor.close();
  }

  if (batch.length) {
    await targetCollection.insertMany(batch, { ordered: false });
    copied += batch.length;
  }

  await copyIndexes(sourceCollection, targetCollection);
  return copied;
}

async function main() {
  if (!allowSync) {
    throw new Error("Set ALLOW_PROD_TO_LOCAL_SYNC=yes to confirm local database replacement.");
  }

  if (!prodUri) {
    throw new Error("PROD_MONGODB_URI is required.");
  }

  assertSafeLocalUri(localUri);

  if (prodUri === localUri) {
    throw new Error("PROD_MONGODB_URI and LOCAL_MONGODB_URI cannot be the same.");
  }

  const prodClient = new MongoClient(prodUri);
  const localClient = new MongoClient(localUri);

  await prodClient.connect();
  await localClient.connect();

  const prodDb = prodClient.db();
  const localDb = localClient.db();
  const collections = (await prodDb.listCollections().toArray())
    .map((collection) => collection.name)
    .filter(shouldCopyCollection);

  console.log(`Replacing local database '${localDb.databaseName}' with production '${prodDb.databaseName}'.`);
  await localDb.dropDatabase();

  for (const collectionName of collections) {
    const copied = await copyCollection(prodDb, localDb, collectionName);
    console.log(`${collectionName}: ${copied}`);
  }

  await prodClient.close();
  await localClient.close();
  console.log("Production to local database sync complete.");
}

main().catch((error) => {
  console.error(`Database sync failed: ${error.message}`);
  process.exit(1);
});

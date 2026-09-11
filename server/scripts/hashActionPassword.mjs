import { hashPassword } from "../utils/password.js";

// Generates the DESTRUCTIVE_ACTION_PASSWORD_HASH value for server/.env.
//
//   node scripts/hashActionPassword.mjs "the password you want"
//
// Deliberately standalone: no database, no dotenv, no app imports beyond the hash function - so it
// can be run anywhere, including before the app is configured. The plaintext is never stored or
// transmitted; only the scrypt hash below goes into .env.

const password = process.argv[2];

if (!password || password.length < 12) {
  console.error("Usage: node scripts/hashActionPassword.mjs \"<password>\"");
  console.error("Use at least 12 characters - this guards client data deletion and re-billing.");
  process.exit(1);
}

console.log("\nAdd this line to server/.env (and never commit it):\n");
console.log(`DESTRUCTIVE_ACTION_PASSWORD_HASH=${hashPassword(password)}`);
console.log("\nThen restart the API:  sudo -u dashboard pm2 restart dashboard-api\n");

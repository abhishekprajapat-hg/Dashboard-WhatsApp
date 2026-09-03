import crypto from "crypto";

// API keys are high-entropy random tokens, not low-entropy human passwords - a fast SHA-256 hash
// is the right tool here (unlike utils/password.js's deliberately slow scrypt for user passwords),
// since this hash runs on every single API-key-authenticated request.
const KEY_PREFIX = "wcrm";

export function generateApiKey() {
  const secret = crypto.randomBytes(24).toString("base64url");
  const key = `${KEY_PREFIX}_${secret}`;
  return { key, keyPrefix: key.slice(0, 12), keyHash: hashApiKey(key) };
}

export function hashApiKey(key) {
  return crypto.createHash("sha256").update(String(key || "")).digest("hex");
}

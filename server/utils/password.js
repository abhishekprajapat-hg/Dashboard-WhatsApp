import crypto from "crypto";

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash || "").split(":");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const hashBuffer = Buffer.from(hash, "hex");
  const candidate = crypto.scryptSync(password, salt, hashBuffer.length);

  return hashBuffer.length === candidate.length && crypto.timingSafeEqual(hashBuffer, candidate);
}

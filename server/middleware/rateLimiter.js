import { config } from "../config.js";
import { getRedisClient } from "../services/cache.js";

const localBuckets = new Map();

function keyFor(req, scope) {
  const tenant = req.user?.workspaceId || "public";
  return `rl:${scope}:${tenant}:${req.ip}`;
}

function localCheck(key, limit, windowMs) {
  const now = Date.now();
  const current = localBuckets.get(key);
  if (!current || current.resetAt < now) {
    localBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  current.count += 1;
  return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
}

// `scope` isolates each call site's own budget - without it, every rateLimiter() instance sharing
// one IP+tenant would collide on the same counter (confirmed live: a tighter route-specific limiter
// like signup's 5/60s was being exhausted by unrelated traffic hitting the app-wide default limiter
// first, since both incremented the identical key). The app-wide default in index.js intentionally
// keeps the "global" scope; anything wanting its own real budget must pass a distinct one.
export function rateLimiter({ limit = config.rateLimitMax, windowMs = config.rateLimitWindowMs, scope = "global" } = {}) {
  return async (req, res, next) => {
    const key = keyFor(req, scope);
    const redis = getRedisClient();
    let result;

    if (redis?.status === "ready") {
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs);
      const ttl = await redis.pttl(key);
      result = { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: Date.now() + ttl };
    } else {
      result = localCheck(key, limit, windowMs);
    }

    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      return res.status(429).json({ error: "RATE_LIMITED", message: "Too many requests. Please retry shortly." });
    }

    next();
  };
}

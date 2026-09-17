import { config } from "../config.js";

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
//
// Local-in-memory only, no Redis - a shared Redis-backed counter only earns its keep once this app
// runs as more than one process needing a synchronized view of the same counters. dashboard-api runs
// as a single PM2 "fork" instance, not a cluster, so there is no second process for Redis to be
// syncing with; every request already lands on this same process's own localBuckets Map. This used
// to be Redis-backed (2-3 commands per request, on literally every request in the app) and was the
// dominant cost driver on the pay-as-you-go Redis instance. If this ever moves to multiple instances
// (cluster mode, a second server behind a load balancer), this needs a shared store again first.
export function rateLimiter({ limit = config.rateLimitMax, windowMs = config.rateLimitWindowMs, scope = "global" } = {}) {
  return (req, res, next) => {
    const key = keyFor(req, scope);
    const result = localCheck(key, limit, windowMs);

    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      return res.status(429).json({ error: "RATE_LIMITED", message: "Too many requests. Please retry shortly." });
    }

    next();
  };
}

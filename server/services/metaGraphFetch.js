import { logger } from "./logger.js";

// Drop-in replacement for fetch() against Meta's Graph API - same signature, same Response return
// value (callers still do their own response.json()/response.ok handling exactly as before), so
// existing call sites can adopt it with a one-line swap. Two things it adds on top of a plain
// fetch():
//
// 1. Reads Meta's own rate-limit headers (X-App-Usage, X-Business-Use-Case-Usage - both a JSON
//    object of 0-100 percentages) and logs a warning once usage is high, so there's at least a
//    signal before quota actually runs out, instead of only ever finding out via a hard failure.
// 2. Retries a 429 with exponential backoff (capped, bounded attempts) rather than surfacing it to
//    the caller immediately - a real WhatsApp campaign blast is exactly the scenario that can
//    legitimately hit Meta's per-second cap for a moment, and the right response is to wait and
//    retry, not to mark the message failed.
const USAGE_WARN_THRESHOLD = 80;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

function usagePercentagesFrom(parsed) {
  // Both headers are loosely-shaped JSON - X-App-Usage is a flat {call_count, total_cputime,
  // total_time}; X-Business-Use-Case-Usage is keyed by business id, each an array of the same
  // shape. Rather than assume one exact shape, walk whatever's there and collect every numeric
  // value that looks like a 0-100 percentage - if this is ever wrong, the worst case is a missed
  // or spurious log line, never a broken request (this must never throw).
  const values = [];
  const visit = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node === "object") return Object.values(node).forEach(visit);
    if (typeof node === "number" && node >= 0 && node <= 100) values.push(node);
  };
  visit(parsed);
  return values;
}

function logUsageHeaders(response, context) {
  for (const headerName of ["x-app-usage", "x-business-use-case-usage"]) {
    const raw = response.headers.get(headerName);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const maxPercent = Math.max(0, ...usagePercentagesFrom(parsed));
      if (maxPercent >= USAGE_WARN_THRESHOLD) {
        logger.warn({ header: headerName, usagePercent: maxPercent, ...context }, "Meta API usage approaching rate limit");
      }
    } catch {
      // Header present but not parseable JSON - never worth failing the real request over this.
    }
  }
}

export async function metaGraphFetch(url, options = {}, context = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, options);
    logUsageHeaders(response, context);

    if (response.status !== 429 || attempt >= MAX_ATTEMPTS) {
      return response;
    }

    // Number(null) is 0, not NaN - reading the raw header value first, before converting, is what
    // lets a genuinely absent header (use our own backoff) be told apart from an explicit
    // "Retry-After: 0" (retry immediately, no delay) - both would otherwise collapse to the same
    // "0" and get the wrong treatment.
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader === null ? null : Number(retryAfterHeader);
    const delayMs = retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? retryAfterSeconds * 1000
      : Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);

    logger.warn({ url, attempt, delayMs, ...context }, "Meta API rate limited (429) - backing off and retrying");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  // Unreachable - the loop always returns by its last iteration - but keeps the function's return
  // type honest for any linter/type-checker that doesn't see that.
  return fetch(url, options);
}

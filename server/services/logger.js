import { randomUUID } from "crypto";
import pino from "pino";
import pinoHttp from "pino-http";
import { config } from "../config.js";

// Defense in depth, not the primary control - fast-redact's wildcards match one nesting level
// (`*.apiKey`), not arbitrary depth, so this can't catch every possible shape a credential-bearing
// object might take. The primary control stays the same discipline that already holds today: don't
// log raw request bodies or credential-bearing objects. This is the safety net for when that slips.
export const redactPaths = [
  "req.headers.authorization",
  ...[
    "accessToken",
    "verifyToken",
    "appSecret",
    "accountSid",
    "authToken",
    "apiKey",
    "encryptedCredentials",
    "secret",
    "token",
    "password",
    "jwtSecret",
    "credentialEncryptionSecret",
    // Express's body-parser attaches the raw invalid input as `.body` on the SyntaxError it
    // throws for malformed JSON - confirmed by triggering one for real while verifying this
    // change. That raw text has no structure to redact a "secret field" out of (it's not parsed),
    // so any `.body` on a logged object is redacted wholesale rather than left unredacted.
    "body",
  ].flatMap((field) => [field, `*.${field}`]),
];

// Compute once, import everywhere - same convention as services/cache.js's getRedisClient().
// Pretty-printed in local dev; plain JSON on stdout in production, same destination every
// console.* call already wrote to, so PM2's existing log capture keeps working unchanged.
export const logger = pino({
  level: config.logLevel,
  redact: { paths: redactPaths, censor: "[Redacted]" },
  // Pretty-printing only in local dev, not "test" - pino-pretty runs its own worker thread, and
  // this environment's server-spawning tests are already documented as fragile (see HANDOFF.md's
  // "Environment gotchas"); keep spawned test servers on the same plain-JSON path as production.
  transport:
    config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
      : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    const id = typeof existing === "string" && existing ? existing : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: (req) => ({
    workspaceId: req.user?.workspaceId,
    userId: req.user?.sub,
  }),
});

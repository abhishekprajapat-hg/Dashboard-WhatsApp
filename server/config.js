import "dotenv/config";

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listFromEnv(name) {
  return (process.env[name] || "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: numberFromEnv("PORT", 4000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  // Deliberately independent of jwtSecret: rotating the JWT secret (a routine security practice)
  // must never make previously-encrypted WhatsApp credentials permanently undecryptable.
  credentialEncryptionSecret: process.env.WHATSAPP_CREDENTIAL_SECRET || process.env.CREDENTIAL_ENCRYPTION_KEY || "dev-only-credential-secret-change-me",
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || "v21.0",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "local-whatsapp-verify-token",
  // Embedded Signup: appId is public (shipped to the client for the JS SDK), appSecret is the
  // same Dashboard app secret WHATSAPP_APP_SECRET already uses for webhook signatures - one app,
  // one secret, not a second credential to manage. embeddedSignupConfigId is a Configuration ID
  // created once in App Dashboard -> Facebook Login for Business -> Configurations - there's no
  // API to create it, it's a manual one-time setup step, not something this app can provision.
  meta: {
    appId: process.env.META_APP_ID || "",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    embeddedSignupConfigId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "",
  },
  // "Instagram API with Instagram Login" is a genuinely separate system from the Facebook app used
  // for WhatsApp/Ads - its own App ID/Secret, issued only after adding the Instagram product and
  // completing "API setup with Instagram Login" in App Dashboard. Not provisionable by this app,
  // same as embeddedSignupConfigId above.
  instagram: {
    appId: process.env.META_INSTAGRAM_APP_ID || "",
    appSecret: process.env.META_INSTAGRAM_APP_SECRET || "",
    verifyToken: process.env.META_INSTAGRAM_VERIFY_TOKEN || "local-instagram-verify-token",
    redirectUri: process.env.META_INSTAGRAM_REDIRECT_URI || "",
    // Separate from redirectUri above - that one is the business-account-connect callback
    // (Settings -> Instagram), this one is the "log into Dashboard-WhatsApp itself with your
    // Instagram account" callback. Two different server routes/scopes, so Meta needs each
    // registered as its own valid OAuth redirect URI in App Dashboard.
    loginRedirectUri: process.env.META_INSTAGRAM_LOGIN_REDIRECT_URI || "",
  },
  // Facebook Login for end-user authentication (signup/login), reusing the same Meta app id/secret
  // as `meta` above - a different OAuth product on the same app, not a second app to manage. Its
  // own redirect URI, same reasoning as instagram.loginRedirectUri.
  facebookLogin: {
    redirectUri: process.env.META_FACEBOOK_LOGIN_REDIRECT_URI || "",
  },
  // Genuinely new - nothing in this repo talks to Google today. A real Google Cloud OAuth Client
  // must be created before this works; not provisionable by this app, same "manual one-time setup"
  // category as embeddedSignupConfigId above.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  },
  // Authentication-category WhatsApp template used to send signup OTP codes - must be created and
  // approved in WhatsApp Manager before this works live (freeform text can't reach a brand-new
  // number with no open 24h session). Name is env-overridable so a real approved template name can
  // differ from this default without a code change.
  whatsappOtpTemplateName: process.env.WHATSAPP_OTP_TEMPLATE_NAME || "signup_otp",
  // Single Nemnidhi-owned Razorpay account billing every client's subscription - a global
  // platform secret like meta/instagram above, not a per-tenant credential, so plain env vars are
  // the right pattern (not whatsappProvider.js's per-account AES-GCM encryption, which is for
  // credentials each tenant brings themselves). planIds are created once in Razorpay Dashboard
  // (Plans aren't provisionable via this app, same "manual one-time setup" category as
  // embeddedSignupConfigId above) - "custom" deliberately has no plan id, it's a contact-sales
  // tier, never self-serve checkout.
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    planIds: {
      basic: process.env.RAZORPAY_PLAN_BASIC_ID || "",
      medium: process.env.RAZORPAY_PLAN_MEDIUM_ID || "",
      pro: process.env.RAZORPAY_PLAN_PRO_ID || "",
    },
  },
  demoMode: process.env.DEMO_MODE !== "false",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  cdnBaseUrl: process.env.CDN_BASE_URL || "",
  corsOrigins: listFromEnv("CORS_ORIGINS"),
  redisUrl: process.env.REDIS_URL || "",
  rabbitmqUrl: process.env.RABBITMQ_URL || "",
  rateLimitWindowMs: numberFromEnv("RATE_LIMIT_WINDOW_MS", 60000),
  rateLimitMax: numberFromEnv("RATE_LIMIT_MAX", 600),
  s3: {
    enabled: process.env.MEDIA_STORAGE_DRIVER === "s3",
    bucket: process.env.S3_BUCKET || "",
    region: process.env.S3_REGION || "ap-south-1",
    endpoint: process.env.S3_ENDPOINT || "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  },
  telemetry: {
    serviceName: process.env.OTEL_SERVICE_NAME || "whatscrm-api",
    enabled: process.env.OTEL_ENABLED === "true",
  },
  logLevel: process.env.LOG_LEVEL || "info",
  // Model names are env-overridable, not hardcoded into automationExecutors.js/aiProviders.js -
  // provider model ids get deprecated/renamed on their own schedule, independent of this app's
  // release cycle.
  ai: {
    openaiModel: process.env.AI_OPENAI_MODEL || "gpt-4o-mini",
    claudeModel: process.env.AI_CLAUDE_MODEL || "claude-3-5-haiku-latest",
    geminiModel: process.env.AI_GEMINI_MODEL || "gemini-2.5-flash",
    requestTimeoutMs: numberFromEnv("AI_REQUEST_TIMEOUT_MS", 30000),
  },
  notifications: {
    requestTimeoutMs: numberFromEnv("NOTIFICATION_REQUEST_TIMEOUT_MS", 15000),
  },
  // Bounds for the code_block automation node's isolated-vm sandbox - kept low/conservative since
  // this runs inline in advanceRun's synchronous traversal loop (blocks the whole run until it
  // resolves, like every other Phase 2 node) on a resource-constrained single VPS.
  codeBlock: {
    timeoutMs: numberFromEnv("CODE_BLOCK_TIMEOUT_MS", 5000),
    memoryLimitMb: numberFromEnv("CODE_BLOCK_MEMORY_LIMIT_MB", 32),
  },
  featureFlags: {
    infrastructurePanel: process.env.FEATURE_INFRASTRUCTURE_PANEL !== "false",
    queueProcessing: process.env.FEATURE_QUEUE_PROCESSING !== "false",
    s3MediaStorage: process.env.FEATURE_S3_MEDIA_STORAGE === "true" || process.env.MEDIA_STORAGE_DRIVER === "s3",
    rabbitmqEvents: process.env.FEATURE_RABBITMQ_EVENTS === "true",
    zeroDowntimeMode: process.env.FEATURE_ZERO_DOWNTIME_MODE !== "false",
  },
  // Both empty by default - vegaIntegration.js's notifyVega() no-ops rather than erroring when
  // unconfigured, since this is a best-effort side channel, not a required integration.
  vega: {
    apiUrl: process.env.VEGA_API_URL || "",
    integrationSecret: process.env.VEGA_INTEGRATION_SECRET || "",
    requestTimeoutMs: numberFromEnv("VEGA_REQUEST_TIMEOUT_MS", 5000),
  },
};

export function validateProductionConfig() {
  if (config.nodeEnv !== "production") return;
  const missing = [];
  if (!process.env.JWT_SECRET || config.jwtSecret === "dev-only-secret-change-me") {
    missing.push("JWT_SECRET");
  } else if (config.jwtSecret.length < 32) {
    missing.push("JWT_SECRET (minimum 32 characters)");
  }
  if (!process.env.WHATSAPP_CREDENTIAL_SECRET && !process.env.CREDENTIAL_ENCRYPTION_KEY) {
    missing.push("WHATSAPP_CREDENTIAL_SECRET (or CREDENTIAL_ENCRYPTION_KEY)");
  } else if (config.credentialEncryptionSecret.length < 32) {
    missing.push("WHATSAPP_CREDENTIAL_SECRET (minimum 32 characters)");
  }
  if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");
  if (config.s3.enabled && !config.s3.bucket) missing.push("S3_BUCKET");
  if (missing.length) {
    throw new Error(`Production configuration missing secure values: ${missing.join(", ")}`);
  }
}

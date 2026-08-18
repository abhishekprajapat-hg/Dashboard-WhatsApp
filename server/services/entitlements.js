// Pack-tier entitlements: which capabilities an Organization's plan switches on. This is
// deliberately separate from featureFlags.js - that system gates process-wide infra toggles
// (queueProcessing, rabbitmqEvents) that can't vary per tenant within one running server.
// Entitlements are the thing that DOES vary per tenant: what a client's plan actually bought them.

export const PACK_TIERS = ["basic", "medium", "pro", "custom"];

const DEFAULT_TIER = "basic";

// One row per sellable capability. `label`/`description` are for the admin UI; `minTier` is the
// lowest tier that includes it - "custom" always includes everything below it plus bespoke work
// that isn't represented as a capability flag (it's project-scoped, not a toggle).
export const CAPABILITY_DEFINITIONS = [
  {
    key: "messaging",
    label: "Messaging Mechanics",
    description: "WhatsApp inbox - connect a number, send/receive, manual replies.",
    minTier: "basic",
  },
  {
    key: "campaigns",
    label: "Campaigns & templates",
    description: "Template management and outbound campaign sends.",
    minTier: "medium",
  },
  {
    key: "automationBuilder",
    label: "Automation builder",
    description: "Access to the automation flow builder and its API (server/routes/automation.js).",
    minTier: "medium",
  },
  {
    key: "analytics",
    label: "Analytics dashboard",
    description: "Usage/performance analytics beyond the basic inbox.",
    minTier: "pro",
  },
  {
    key: "aiAssistant",
    label: "AI assistant",
    description: "The assistant subsystem - analyze/stream/knowledge-search/voice/tool-call (server/routes/assistant.js).",
    minTier: "pro",
  },
  {
    key: "ads",
    label: "Meta Ads (Click-to-WhatsApp)",
    description: "Create and manage Click-to-WhatsApp ad campaigns via the Marketing API (server/routes/ads.js).",
    minTier: "pro",
  },
];

const KNOWN_CAPABILITY_KEYS = new Set(CAPABILITY_DEFINITIONS.map((definition) => definition.key));
const TIER_RANK = Object.fromEntries(PACK_TIERS.map((tier, index) => [tier, index]));

export function isValidPackTier(plan) {
  return PACK_TIERS.includes(plan);
}

// Anything not a recognized tier (empty, legacy "starter", a typo) is treated as basic rather
// than throwing - plan is free-text at the schema level on purpose (see Organization.js), so
// this is the one place that has to be defensive about it.
function normalizeTier(plan) {
  return isValidPackTier(plan) ? plan : DEFAULT_TIER;
}

export function hasEntitlement(plan, capability) {
  if (!KNOWN_CAPABILITY_KEYS.has(capability)) {
    throw new Error(`Unknown capability: ${capability}`);
  }
  const definition = CAPABILITY_DEFINITIONS.find((item) => item.key === capability);
  return TIER_RANK[normalizeTier(plan)] >= TIER_RANK[definition.minTier];
}

export function getEntitlements(plan) {
  const tier = normalizeTier(plan);
  return {
    plan: tier,
    normalized: tier !== plan,
    capabilities: CAPABILITY_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      minTier: definition.minTier,
      enabled: hasEntitlement(tier, definition.key),
    })),
  };
}

import mongoose from "mongoose";
import { config } from "../config.js";
import { getFlagSync } from "./featureFlags.js";
import { AutomationFlow, AutomationRun, CalendarEvent, Contact, Conversation, InstagramAccount, Message, Tag, Task, Template, WhatsAppFlow } from "../models/index.js";
import { ensureConversationInCrm } from "./crm.js";
import { callGenericApi } from "./integrations.js";
import { callAiProvider } from "./aiProviders.js";
import { sendEmail, sendSms } from "./notificationChannels.js";
import { sendFlowMessage } from "./whatsappFlows.js";
import { sendWhatsAppInteractive } from "./whatsappProvider.js";
import { sendWhatsAppProductMessage } from "./whatsappCommerce.js";
import { sendInstagramMessage } from "./instagramProvider.js";
import { bookVegaMeeting, cancelVegaMeeting, checkVegaOfficeHours, fetchVegaMeetingSlots } from "./vegaIntegration.js";
import { sendBillstackOrder } from "./billstackIntegration.js";
import { runSandboxedCode } from "./codeSandbox.js";
import { logger } from "./logger.js";
import { httpUrlString } from "../utils/zodHelpers.js";
import {
  enqueueAutomationGoogleSheetAction,
  enqueueAutomationSendMessage,
  enqueueAutomationWebhookAction,
  processAutomationGoogleSheetAction,
  processAutomationSendMessage,
  processAutomationWebhookAction,
} from "./automationSender.js";
// Circular import, same accepted pattern as jobs.js <-> automationEngine.js: automationEngine.js
// imports executorFor from this file, and execSubWorkflow below needs advanceRun to actually run
// the target flow. Safe because advanceRun is only called from inside a function body (when a
// sub_workflow node executes), well after both modules have finished loading - never at
// module-eval time.
import { advanceRun } from "./automationEngine.js";

// Per-node-kind dispatch table for the automation engine. Each executor receives
// { node, config, resolve, env, run, flow, testMode } and returns
// { status: "ok"|"failed"|"skipped"|"queued", action?, branch?, waitMs?, error?, logMessage?, logLevel? }.
// `action` (when present) is what shows up in the public actions[] list callers already read;
// nodes that aren't a user-visible "action" (condition/if_else/delay/unsupported) may omit it.

const actionAliases = {
  send_whatsapp_message: "send_message",
  assign_team_member: "assign_user",
  update_lead_stage: "lead_stage",
  send_to_google_sheet: "google_sheets",
};

export function canonicalNodeType(type = "") {
  const value = String(type || "").toLowerCase();
  return actionAliases[value] || value;
}

function queueProcessingAvailable() {
  return Boolean(config.redisUrl && getFlagSync("queueProcessing"));
}

async function execSendMessage({ node, config: cfg, env, run, flow, testMode }) {
  const { account, contact, conversation } = env;
  if (!account || !contact || !conversation) {
    return { status: "skipped", logMessage: "Skipped send_message: missing account/contact/conversation", logLevel: "warn" };
  }

  let body = String(cfg?.body || flow.trigger?.replyBody || "").trim();
  const templateId = cfg?.templateId;
  if (templateId && mongoose.Types.ObjectId.isValid(templateId)) {
    const template = await Template.findOne({
      _id: templateId,
      workspaceId: run.workspaceId,
      type: mongoose.trusted({ $in: ["quick_reply", "automation", "follow_up", "lead_stage"] }),
      status: mongoose.trusted({ $in: ["active", "approved"] }),
    });
    if (template) {
      body = template.body || body;
      await Template.updateOne({ _id: template._id }, { $inc: { usageCount: 1 }, lastUsedAt: new Date() });
    }
  }
  if (!body) return { status: "skipped", logMessage: "Skipped send_message: empty body", logLevel: "warn" };

  const sendData = {
    flowId: flow._id.toString(),
    flowName: flow.name,
    nodeId: node.id,
    accountId: account._id.toString(),
    workspaceId: run.workspaceId.toString(),
    organizationId: run.organizationId.toString(),
    contactId: contact._id.toString(),
    conversationId: conversation._id.toString(),
    body,
    testMode,
  };

  try {
    if (testMode) {
      const result = await processAutomationSendMessage(sendData);
      return {
        status: result.status === "failed" ? "failed" : "ok",
        action: { type: "send_message", messageId: result.messageId, status: result.status },
        logMessage: "WhatsApp message action completed",
        logLevel: result.status === "failed" ? "error" : "info",
      };
    }
    await enqueueAutomationSendMessage(sendData);
    return { status: "queued", action: { type: "send_message", status: "queued" }, logMessage: "WhatsApp message action queued" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "send_message", status: "failed", error: error.message },
      logMessage: "WhatsApp message action failed to queue",
      logLevel: "error",
    };
  }
}

async function execAssignUser({ node, env, flow }) {
  const { conversation } = env;
  const userId = node?.config?.userId;
  if (!userId || !conversation) return { status: "skipped", logMessage: "Skipped assign_user: no userId/conversation", logLevel: "warn" };

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        assignedToUserId: userId,
        "metadata.automationAssignment": { flowId: flow._id, assignedAt: new Date(), assignedToUserId: userId },
      },
    }
  );
  return { status: "ok", action: { type: "assign_user", userId }, logMessage: "Assigned conversation" };
}

const conversationStatusMap = { open: "open", waiting: "pending", pending: "pending", resolved: "resolved", archived: "archived" };

async function execSetStatus({ node, env }) {
  const { conversation } = env;
  const requested = node?.config?.status;
  const mapped = conversationStatusMap[requested];
  if (!mapped || !conversation) return { status: "skipped", logMessage: "Skipped set_status: unrecognized status/no conversation", logLevel: "warn" };

  await Conversation.updateOne({ _id: conversation._id }, { $set: { status: mapped } });
  return { status: "ok", action: { type: "set_status", status: requested }, logMessage: "Updated conversation status" };
}

async function execAddTag({ node, env }) {
  const { contact } = env;
  const name = String(node?.config?.name || "").trim();
  if (!name || !contact) return { status: "skipped", logMessage: "Skipped add_tag: no name/contact", logLevel: "warn" };

  const tag = await Tag.findOneAndUpdate(
    { workspaceId: contact.workspaceId, name },
    {
      organizationId: contact.organizationId,
      workspaceId: contact.workspaceId,
      name,
      color: node?.config?.color || "#25D366",
      description: "Created by automation",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Contact.updateOne({ _id: contact._id }, { $addToSet: { tagIds: tag._id } });
  return { status: "ok", action: { type: "add_tag", tag: name }, logMessage: "Added contact tag" };
}

function makeCrmExecutor(label) {
  return async function execCrmUpdate({ node, env }) {
    const { contact, conversation, inboundMessage } = env;
    if (!contact || !conversation) return { status: "skipped", logMessage: `Skipped ${label}: no contact/conversation`, logLevel: "warn" };

    const cfg = node.config || {};
    await ensureConversationInCrm({
      contact,
      conversation,
      inboundMessage,
      source: cfg.source || "automation",
      stage: cfg.stage || "new_lead",
    });
    return { status: "ok", action: { type: label, stage: cfg.stage || "new_lead" }, logMessage: "Updated CRM lead" };
  };
}

async function execGoogleSheets({ node, env, run, flow, testMode }) {
  const { contact, conversation, inboundMessage } = env;
  if (!contact || !conversation) return { status: "skipped", logMessage: "Skipped google_sheets: no contact/conversation", logLevel: "warn" };

  const cfg = node.config || {};
  // The CRM lookup/creation stays synchronous - fast local write, matching the other CRM actions.
  // Only the actual Apps Script HTTP call is queued below.
  const crmResult = await ensureConversationInCrm({
    contact,
    conversation,
    inboundMessage,
    source: cfg.source || "automation",
    stage: cfg.stage || "new_lead",
  });
  const sheetData = {
    flowId: flow._id.toString(),
    nodeId: node.id,
    workspaceId: run.workspaceId.toString(),
    contactId: (crmResult.contact || contact)._id.toString(),
    conversationId: conversation._id.toString(),
    inboundMessageId: inboundMessage?._id?.toString() || "",
    leadId: crmResult.lead?._id?.toString() || "",
    testMode,
  };

  try {
    if (testMode) {
      const result = await processAutomationGoogleSheetAction(sheetData);
      return { status: "ok", action: { type: "google_sheets", status: result.status }, logMessage: "Google Sheets action completed" };
    }
    await enqueueAutomationGoogleSheetAction(sheetData);
    return { status: "queued", action: { type: "google_sheets", status: "queued" }, logMessage: "Google Sheets action queued" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "google_sheets", status: "failed", error: error.message },
      logMessage: "Google Sheets action failed",
      logLevel: "error",
    };
  }
}

async function execCallWebhook({ node, env, run, flow, testMode }) {
  const { contact, conversation, inboundMessage } = env;
  const cfg = node.config || {};
  const webhookData = {
    flowId: flow._id.toString(),
    nodeId: node.id,
    workspaceId: run.workspaceId.toString(),
    url: cfg.url,
    secret: cfg.secret,
    event: cfg.event || "automation.triggered",
    payload: {
      flow: { id: flow._id.toString(), name: flow.name },
      contact: contact ? { id: contact._id.toString(), name: contact.name, phone: contact.phone, email: contact.email || "" } : {},
      conversation: conversation ? { id: conversation._id.toString(), status: conversation.status } : {},
      inboundMessage: inboundMessage ? { id: inboundMessage._id.toString(), body: inboundMessage.body || "" } : {},
    },
    testMode,
  };

  try {
    if (testMode) {
      const result = await processAutomationWebhookAction(webhookData);
      return { status: "ok", action: { type: "call_webhook", status: result.status }, logMessage: "Webhook action completed" };
    }
    await enqueueAutomationWebhookAction(webhookData);
    return { status: "queued", action: { type: "call_webhook", status: "queued" }, logMessage: "Webhook action queued" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "call_webhook", status: "failed", error: error.message },
      logMessage: "Webhook action failed",
      logLevel: "error",
    };
  }
}

const conditionOperators = {
  equals: (a, b) => String(a ?? "") === String(b ?? ""),
  not_equals: (a, b) => String(a ?? "") !== String(b ?? ""),
  contains: (a, b) => String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase()),
  not_contains: (a, b) => !String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase()),
  greater_than: (a, b) => Number(a) > Number(b),
  less_than: (a, b) => Number(a) < Number(b),
  is_empty: (a) => a === undefined || a === null || String(a).trim() === "",
  is_not_empty: (a) => !(a === undefined || a === null || String(a).trim() === ""),
};

function evaluateCondition(node, resolve) {
  const cfg = node.config || {};
  const field = String(cfg.field || "").trim();
  const operator = conditionOperators[cfg.operator] ? cfg.operator : "equals";
  const actual = field ? resolve(field) : undefined;
  const passed = Boolean(conditionOperators[operator](actual, cfg.value));
  return { passed, field, operator };
}

async function execCondition({ node, resolve }) {
  const { passed, field, operator } = evaluateCondition(node, resolve);
  return {
    status: "ok",
    branch: passed ? "true" : "false",
    action: { type: "condition", field, operator, result: passed },
    logMessage: "Condition evaluated",
  };
}

async function execIfElse({ node, resolve }) {
  const { passed, field, operator } = evaluateCondition(node, resolve);
  return {
    status: "ok",
    branch: passed ? "true" : "false",
    action: { type: "if_else", field, operator, result: passed },
    logMessage: "If/Else evaluated",
  };
}

async function execApi({ node, config: cfg }) {
  const url = String(cfg?.url || "").trim();
  if (!httpUrlString().safeParse(url).success) {
    return {
      status: "failed",
      error: "invalid_api_url",
      action: { type: "api", status: "failed", error: "Must be a valid http(s) URL." },
      logMessage: "API node failed: invalid URL",
      logLevel: "error",
    };
  }

  let headers = cfg?.headers;
  if (typeof headers === "string") {
    try {
      headers = headers.trim() ? JSON.parse(headers) : {};
    } catch {
      headers = {};
    }
  }
  let body = cfg?.body;
  if (typeof body === "string" && body.trim()) {
    try {
      body = JSON.parse(body);
    } catch {
      // Not JSON - send as a raw string body.
    }
  }

  try {
    const result = await callGenericApi({ method: cfg?.method || "GET", url, headers: headers || {}, body });
    return {
      status: result.ok ? "ok" : "failed",
      action: { type: "api", status: result.ok ? "ok" : "failed", httpStatus: result.status, body: result.body },
      logMessage: "API call completed",
      logLevel: result.ok ? "info" : "error",
    };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "api", status: "failed", error: error.message },
      logMessage: "API call failed",
      logLevel: "error",
    };
  }
}

const delayUnitMs = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };

async function execDelay({ node, testMode }) {
  const cfg = node.config || {};
  const amount = Number(cfg.duration ?? cfg.amount ?? 0);
  const unit = delayUnitMs[String(cfg.unit || "seconds").toLowerCase()] ? String(cfg.unit).toLowerCase() : "seconds";
  const waitMs = Number.isFinite(amount) ? Math.max(0, Math.round(amount * delayUnitMs[unit])) : 0;

  if (testMode) {
    return { status: "ok", action: { type: "delay", status: "skipped", skipped: true, waitMs }, logMessage: "Delay skipped in test mode" };
  }
  if (!waitMs) {
    return { status: "ok", action: { type: "delay", status: "ok", waitMs: 0 }, logMessage: "Delay skipped: zero duration" };
  }
  if (!queueProcessingAvailable()) {
    return {
      status: "failed",
      error: "delay_requires_queue_processing",
      action: { type: "delay", status: "failed", error: "delay_requires_queue_processing" },
      logMessage: "Delay requires queue processing (Redis) to be enabled",
      logLevel: "error",
    };
  }
  return { status: "ok", waitMs, action: { type: "delay", status: "waiting", waitMs }, logMessage: "Delay started" };
}

function relativeOffsetMs(cfg, defaultUnit) {
  const amount = Number(cfg.duration ?? 0);
  const unit = delayUnitMs[String(cfg.unit || defaultUnit).toLowerCase()] ? String(cfg.unit).toLowerCase() : defaultUnit;
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * delayUnitMs[unit]) : 0;
}

// Config reuses delay's {duration, unit} shape for "due in N days/hours/..." rather than an
// absolute date - the flow author designs this before knowing when it'll actually run, so a
// relative offset from execution time is the only value that makes sense at design time. No
// dedicated Task-list UI exists yet (deliberately out of scope - see HANDOFF.md); this only
// creates the record, same as add_tag/lead_stage write CRM data without owning a UI of their own.
async function execTask({ node, env, run }) {
  const cfg = node.config || {};
  const title = String(cfg.title || "").trim();
  if (!title) return { status: "skipped", logMessage: "Skipped task: no title", logLevel: "warn" };

  const offsetMs = relativeOffsetMs(cfg, "days");
  const dueAt = offsetMs ? new Date(Date.now() + offsetMs) : null;
  const assignedToUserId = mongoose.Types.ObjectId.isValid(cfg.userId) ? cfg.userId : null;

  const task = await Task.create({
    organizationId: run.organizationId,
    workspaceId: run.workspaceId,
    title,
    description: String(cfg.body || ""),
    dueAt,
    assignedToUserId,
    contactId: env.contact?._id || null,
    conversationId: env.conversation?._id || null,
  });

  return {
    status: "ok",
    action: { type: "task", status: "ok", taskId: task._id.toString(), title, dueAt },
    logMessage: "Task created",
  };
}

// Same relative-offset reasoning as execTask for startAt. lengthMinutes (default 30) sets endAt -
// kept as a plain minutes field rather than a second duration/unit pair since event lengths are
// almost always sub-day and a unit dropdown would be overkill.
async function execCalendar({ node, env, run }) {
  const cfg = node.config || {};
  const title = String(cfg.title || "").trim();
  if (!title) return { status: "skipped", logMessage: "Skipped calendar: no title", logLevel: "warn" };

  const startAt = new Date(Date.now() + relativeOffsetMs(cfg, "hours"));
  const lengthMinutes = Number(cfg.lengthMinutes ?? 30);
  const endAt = Number.isFinite(lengthMinutes) && lengthMinutes > 0 ? new Date(startAt.getTime() + lengthMinutes * 60000) : null;
  const assignedToUserId = mongoose.Types.ObjectId.isValid(cfg.userId) ? cfg.userId : null;

  const event = await CalendarEvent.create({
    organizationId: run.organizationId,
    workspaceId: run.workspaceId,
    title,
    description: String(cfg.body || ""),
    startAt,
    endAt,
    assignedToUserId,
    contactId: env.contact?._id || null,
    conversationId: env.conversation?._id || null,
  });

  return {
    status: "ok",
    action: { type: "calendar", status: "ok", eventId: event._id.toString(), title, startAt, endAt },
    logMessage: "Calendar event created",
  };
}

async function execUnsupported({ node }) {
  return { status: "skipped", logMessage: `Node type "${node.type}" is not yet supported`, logLevel: "warn" };
}

const aiProviderLabels = { openai: "OpenAI", claude: "Claude", gemini: "Gemini" };

// Reuses the generic form's "body" field as the prompt (interpolateConfig already resolves
// {{trigger.x}}/{{steps.x}}/{{variables.x}} tokens in it before this runs) - no new client form
// needed, same reasoning as execJsonParser/execVariables. The API key is never per-node config
// (which would round-trip through flow JSON/execution logs); it's read from the workspace's
// settings, the same place callOutboundWebhook reads its webhook secret from.
function makeAiExecutor(provider) {
  const label = aiProviderLabels[provider];
  return async function execAiProvider({ node, config: cfg, env, testMode }) {
    const prompt = String(cfg?.body || "").trim();
    if (!prompt) return { status: "skipped", logMessage: `Skipped ${label}: empty prompt`, logLevel: "warn" };

    const providerConfig = env.integrations?.aiProviders?.[provider];
    if (!providerConfig?.enabled || !providerConfig?.apiKey) {
      logger.error({ provider, enabled: Boolean(providerConfig?.enabled), hasApiKey: Boolean(providerConfig?.apiKey) }, "execAiProvider: not configured");
      return {
        status: "failed",
        error: "ai_provider_not_configured",
        action: { type: provider, status: "failed", error: "ai_provider_not_configured" },
        logMessage: `${label} is not configured for this workspace (Settings > Integrations)`,
        logLevel: "error",
      };
    }

    if (testMode) {
      return {
        status: "ok",
        action: { type: provider, status: "skipped", skipped: true, response: `[test mode - ${label} call skipped]` },
        logMessage: `${label} call skipped in test mode`,
      };
    }

    try {
      const result = await callAiProvider({ provider, apiKey: providerConfig.apiKey, prompt });
      logger.info({ provider, responsePreview: String(result.text || "").slice(0, 200) }, "execAiProvider: call completed");
      return {
        status: "ok",
        action: { type: provider, status: "ok", response: result.text },
        logMessage: `${label} call completed`,
      };
    } catch (error) {
      logger.error({ provider, error: error.message }, "execAiProvider: call failed");
      return {
        status: "failed",
        error: error.message,
        action: { type: provider, status: "failed", error: error.message },
        logMessage: `${label} call failed`,
        logLevel: "error",
      };
    }
  };
}

// Reuses the generic 7-field inspector form's "body" input as the JSON source string - no client
// change needed. Parses it and stores the result under action.parsed so downstream nodes can
// interpolate {{steps.<nodeId>.parsed.field}}.
async function execJsonParser({ config: cfg }) {
  const raw = String(cfg?.body ?? "").trim();
  if (!raw) return { status: "skipped", logMessage: "Skipped json_parser: empty input", logLevel: "warn" };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "json_parser", status: "failed", error: error.message },
      logMessage: "JSON parser failed: invalid JSON",
      logLevel: "error",
    };
  }
  return { status: "ok", action: { type: "json_parser", status: "ok", parsed }, logMessage: "Parsed JSON payload" };
}

// Reuses the generic form's "variable" (name) and "body" (value) fields - no client change
// needed. Sets run.context.variables[name], a run-wide bag any later node can read via
// {{variables.name}} - unlike a node's own action output, which only lives under
// steps.<thatNodeId>.*, this is meant to be set once and referenced from anywhere downstream.
async function execVariables({ config: cfg, run }) {
  const name = String(cfg?.variable || "").trim();
  if (!name) return { status: "skipped", logMessage: "Skipped variables: no variable name", logLevel: "warn" };

  run.context.variables = run.context.variables || {};
  const value = cfg?.body ?? "";
  run.context.variables[name] = value;
  return { status: "ok", action: { type: "variables", name, value }, logMessage: "Set flow variable" };
}

// Needs a "subject" field the generic 7-field form doesn't have, so this is the one new node kind
// in this pair that gets its own per-kind client inspector form (config: {subject, body}).
// Recipient is always the triggering contact's email, matching how send_message always sends to
// contact.phone with no per-node override.
async function execEmail({ config: cfg, env, testMode }) {
  const to = env.contact?.email;
  const subject = String(cfg?.subject || "").trim();
  const body = String(cfg?.body || "").trim();
  if (!to) return { status: "skipped", logMessage: "Skipped email: contact has no email address", logLevel: "warn" };
  if (!body) return { status: "skipped", logMessage: "Skipped email: empty body", logLevel: "warn" };

  const emailConfig = env.integrations?.email;
  if (!emailConfig?.enabled || !emailConfig?.apiKey || !emailConfig?.fromAddress) {
    return {
      status: "failed",
      error: "email_not_configured",
      action: { type: "email", status: "failed", error: "email_not_configured" },
      logMessage: "Email is not configured for this workspace (Settings > Integrations)",
      logLevel: "error",
    };
  }

  if (testMode) {
    return { status: "ok", action: { type: "email", status: "skipped", skipped: true, to }, logMessage: "Email skipped in test mode" };
  }

  try {
    const result = await sendEmail({ apiKey: emailConfig.apiKey, fromAddress: emailConfig.fromAddress, fromName: emailConfig.fromName, to, subject, body });
    return { status: "ok", action: { type: "email", status: result.status, to }, logMessage: "Email sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "email", status: "failed", error: error.message },
      logMessage: "Email failed to send",
      logLevel: "error",
    };
  }
}

// Reuses the generic form's "body" field as the message text - fits cleanly, same as
// send_message, no new client form needed. Recipient is always contact.phone.
async function execSms({ config: cfg, env, testMode }) {
  const to = env.contact?.phone;
  const body = String(cfg?.body || "").trim();
  if (!to) return { status: "skipped", logMessage: "Skipped sms: contact has no phone number", logLevel: "warn" };
  if (!body) return { status: "skipped", logMessage: "Skipped sms: empty body", logLevel: "warn" };

  const smsConfig = env.integrations?.sms;
  if (!smsConfig?.enabled || !smsConfig?.accountSid || !smsConfig?.authToken || !smsConfig?.fromNumber) {
    return {
      status: "failed",
      error: "sms_not_configured",
      action: { type: "sms", status: "failed", error: "sms_not_configured" },
      logMessage: "SMS is not configured for this workspace (Settings > Integrations)",
      logLevel: "error",
    };
  }

  if (testMode) {
    return { status: "ok", action: { type: "sms", status: "skipped", skipped: true, to }, logMessage: "SMS skipped in test mode" };
  }

  try {
    const result = await sendSms({ accountSid: smsConfig.accountSid, authToken: smsConfig.authToken, fromNumber: smsConfig.fromNumber, to, body });
    return { status: "ok", action: { type: "sms", status: result.status, to }, logMessage: "SMS sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "sms", status: "failed", error: error.message },
      logMessage: "SMS failed to send",
      logLevel: "error",
    };
  }
}

// Reuses the generic form's "body" field, same as sms. Unlike send_message/sms, the account isn't
// resolved from trigger.accountId - automation triggers are WhatsApp-only today (no
// trigger.instagramAccountId concept exists), so this looks up "the" connected Instagram account
// for the workspace directly, same fallback pattern conversations.js already uses for WhatsApp
// when a conversation has no account of its own.
async function execSendInstagram({ config: cfg, env, run, testMode }) {
  const to = env.contact?.instagramScopedId;
  const body = String(cfg?.body || "").trim();
  if (!to) return { status: "skipped", logMessage: "Skipped send_instagram: contact has no Instagram-scoped ID", logLevel: "warn" };
  if (!body) return { status: "skipped", logMessage: "Skipped send_instagram: empty body", logLevel: "warn" };

  const account = await InstagramAccount.findOne({ workspaceId: run.workspaceId, status: mongoose.trusted({ $in: ["connected", "needs_attention"] }) }).sort({ createdAt: -1 });
  if (!account) {
    return {
      status: "failed",
      error: "instagram_not_connected",
      action: { type: "send_instagram", status: "failed", error: "instagram_not_connected" },
      logMessage: "No Instagram account connected for this workspace (Settings > Instagram)",
      logLevel: "error",
    };
  }

  if (testMode) {
    return { status: "ok", action: { type: "send_instagram", status: "skipped", skipped: true, to }, logMessage: "Instagram DM skipped in test mode" };
  }

  try {
    // Deliberately no humanAgent: true here - this is a bot-triggered automation send, and Meta
    // explicitly bans the HUMAN_AGENT message tag on automated/bot messages (penalty: that
    // account's messaging capability gets suspended). Only conversations.js's real Inbox reply
    // route, which only ever runs from an authenticated agent's own action, should ever pass it.
    const result = await sendInstagramMessage({ account, to, body });
    return { status: "ok", action: { type: "send_instagram", status: result.status, to }, logMessage: "Instagram DM sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "send_instagram", status: "failed", error: error.message },
      logMessage: "Instagram DM failed to send",
      logLevel: "error",
    };
  }
}

// Config: {field} - a raw context path (same convention as condition/if_else's "field", resolved
// via resolve() rather than {{}}-templated) pointing at the array to iterate, e.g.
// "steps.apiNode.parsed.items" or "variables.contactList".
//
// The loop body is wired back to this same node in the flow graph (a real cycle, drawn by the
// user) - each revisit reads this node's own prior step state (which the engine already
// preserves at run.context.steps[node.id] between visits, same mechanism every other node relies
// on for downstream interpolation) to know which item comes next, rather than the AutomationRun
// model needing a separate stack of iteration frames. "loop" branch continues into the body;
// "done" branch falls through once every item has been processed. See automationEngine.js's
// STEP_LIMIT/VISIT_LIMIT comment for why the revisit cap had to move for this to work.
async function execLoop({ node, run, resolve }) {
  const fieldPath = String(node.config?.field || "").trim();
  const priorState = run.context.steps[node.id];
  // Only "continuing" if the prior visit was mid-loop, not finished - otherwise a nested loop's
  // inner node, revisited by a new outer iteration, would wrongly think it's resuming the inner
  // loop it already finished last time instead of starting over.
  const continuing = Boolean(priorState && Array.isArray(priorState.items) && !priorState.done);

  let items;
  let index;
  if (continuing) {
    items = priorState.items;
    index = priorState.index + 1;
  } else {
    const resolved = fieldPath ? resolve(fieldPath) : undefined;
    items = Array.isArray(resolved) ? resolved : [];
    index = 0;
  }

  const done = index >= items.length;
  return {
    status: "ok",
    branch: done ? "done" : "loop",
    action: { type: "loop", status: "ok", done, index, total: items.length, item: done ? undefined : items[index], items },
    logMessage: done ? `Loop finished (${items.length} items)` : `Loop iteration ${index + 1}/${items.length}`,
  };
}

// Reads node.config.code directly (the raw, un-interpolated config), not the `config` param
// interpolateConfig already produced - {{trigger.x}}-style textual substitution into a source
// string is the wrong model for actual code (quoting/escaping hazards, would break any code that
// legitimately contains "{{"). Instead the whole run context is exposed as a real `context` object
// inside the sandbox - read context.trigger.x / context.steps.nodeId.x / context.variables.x, the
// same shape {{}} interpolation resolves against, just as live data instead of string tokens.
// Runs in isolated-vm (see codeSandbox.js) - a real V8 isolate with no require/process/fs/network
// access and a CPU-time + memory cap, not node:vm or vm2. No testMode short-circuit: unlike the AI
// provider/email/SMS nodes this doesn't call a paid external API, so there's no cost/non-determinism
// reason to skip it when testing a flow.
async function execCodeBlock({ node, run }) {
  const source = String(node.config?.code || "").trim();
  if (!source) return { status: "skipped", logMessage: "Skipped code_block: no code", logLevel: "warn" };

  try {
    const result = await runSandboxedCode({
      code: source,
      context: { trigger: run.context?.trigger || {}, steps: run.context?.steps || {}, variables: run.context?.variables || {} },
    });
    return { status: "ok", action: { type: "code_block", status: "ok", result }, logMessage: "Code block executed" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "code_block", status: "failed", error: error.message },
      logMessage: "Code block failed",
      logLevel: "error",
    };
  }
}

const MAX_SUB_WORKFLOW_DEPTH = 5;

// Calls another published flow as a synchronous sub-routine: creates a new AutomationRun for the
// target flow (parentRunId links it back to this run, for the Run History UI to eventually show
// nesting), seeds its context.variables.input from this node's interpolated "body" config so the
// sub-flow can read {{variables.input}}, and awaits its completion before continuing - the same
// synchronous, no-queue pattern as every other Phase 2 node kind.
//
// Depth is guarded by chain.length rather than rejecting exact cycles outright, so bounded
// self-recursion (a flow calling itself a fixed number of times) still works - only runaway depth
// is blocked, regardless of whether the cycle is direct (A->A) or mutual (A->B->A->B->...).
//
// If the sub-flow's own graph pauses on a delay node, this does NOT block waiting for it - the
// child resumes independently later via its own BullMQ job, and this step reports
// subRunStatus: "waiting" and lets the parent continue immediately. Propagating a pause up through
// nested runs would need a much bigger change (multi-level wait/resume); not attempted here.
async function execSendFlow({ node, env, run, testMode }) {
  const { account, contact } = env;
  if (!account || !contact?.phone) {
    return { status: "skipped", logMessage: "Skipped send_flow: missing account/contact phone", logLevel: "warn" };
  }

  const flowId = String(node.config?.flowId || "").trim();
  if (!flowId || !mongoose.Types.ObjectId.isValid(flowId)) {
    return { status: "skipped", logMessage: "Skipped send_flow: no flow selected", logLevel: "warn" };
  }

  const flow = await WhatsAppFlow.findOne({ _id: flowId, workspaceId: run.workspaceId, status: "published" });
  if (!flow) {
    return {
      status: "failed",
      error: "flow_not_found",
      action: { type: "send_flow", status: "failed", error: "flow_not_found" },
      logMessage: "Send flow failed: flow not found or not published",
      logLevel: "error",
    };
  }

  if (testMode) {
    return { status: "ok", action: { type: "send_flow", status: "skipped", skipped: true, flowId: flow._id.toString() }, logMessage: "Flow send skipped in test mode" };
  }

  try {
    const result = await sendFlowMessage({ account, flow, to: contact.phone, screenId: flow.flowJson?.screens?.[0]?.id });
    return {
      status: "ok",
      action: { type: "send_flow", status: "sent", flowId: flow._id.toString(), providerMessageId: result.providerMessageId },
      logMessage: `Flow "${flow.name}" sent`,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "send_flow", status: "failed", error: error.message },
      logMessage: "Flow send failed",
      logLevel: "error",
    };
  }
}

// Native in-chat buttons/list (sendWhatsAppInteractive), not the WhatsApp Flow popup - the
// "hybrid" qualifying design: MCQ options for the fast path, free text always allowed, and an
// "edge_case" branch (wire to a "claude" node) when the reply doesn't match any option. Unlike
// every other node here, this genuinely pauses the run - Meta's Flow UI held all multi-question
// state internally and returned one combined answer, but native buttons means separate webhook
// events per question, so this node has to be revisited: the first visit sends the question and
// pauses (see automationEngine.js's waitForReply handling + automationRunner.js's
// pendingAutomationRunId), the second visit (after the reply arrives) reads it and picks a
// branch. Distinguishing "first visit" from "resumed after reply" reuses execLoop's own
// convention of reading this node's prior recorded step state rather than needing new
// AutomationRun fields.
async function execAskMcq({ node, config: cfg, env, run, flow, testMode }) {
  const { account, contact, conversation, inboundMessage } = env;
  if (!account || !contact?.phone || !conversation) {
    return { status: "skipped", logMessage: "Skipped ask_mcq: missing account/contact/conversation", logLevel: "warn" };
  }

  let options;
  try {
    options = JSON.parse(cfg?.options || "[]");
  } catch {
    return {
      status: "failed",
      error: "invalid_options_json",
      action: { type: "ask_mcq", status: "failed", error: "invalid_options_json" },
      logMessage: "Ask MCQ failed: options is not valid JSON",
      logLevel: "error",
    };
  }
  if (!Array.isArray(options) || !options.length) {
    return { status: "skipped", logMessage: "Skipped ask_mcq: no options configured", logLevel: "warn" };
  }

  const variableName = String(cfg?.variable || node.id).trim();
  const priorState = run.context.steps[node.id];
  const alreadyAsked = priorState?.status === "sent";

  if (!alreadyAsked) {
    const question = String(cfg?.body || "").trim();
    if (!question) return { status: "skipped", logMessage: "Skipped ask_mcq: no question text", logLevel: "warn" };

    if (testMode) {
      return {
        status: "ok",
        action: { type: "ask_mcq", status: "skipped", skipped: true, question, options },
        logMessage: "Ask MCQ skipped in test mode",
      };
    }

    let sendResult;
    try {
      sendResult =
        options.length <= 3
          ? await sendWhatsAppInteractive({ account, to: contact.phone, body: question, buttons: options })
          : await sendWhatsAppInteractive({ account, to: contact.phone, body: question, list: { buttonLabel: "Choose", rows: options } });
    } catch (error) {
      // branch: "send_failed" is a sentinel no real flow wires an edge to - without it,
      // pickNext's no-branch fallback picks the first outgoing edge (here, "matched") and the run
      // would silently fall through as if the customer had already answered, without ever asking
      // the question or storing a value. This stops traversal cleanly instead (dead end, no
      // edge matches), rather than reusing the general failure-continues-anyway behavior every
      // other node kind relies on - a send failure here is not survivable the way e.g. a failed
      // Google Sheets append is.
      logger.error({ nodeId: node.id, conversationId: conversation._id?.toString(), error: error.message }, "execAskMcq: send failed");
      return {
        status: "failed",
        branch: "send_failed",
        error: error.message,
        action: { type: "ask_mcq", status: "failed", error: error.message },
        logMessage: "Ask MCQ failed to send",
        logLevel: "error",
      };
    }

    // Every other send-capable executor (execSendMessage, execEmail, ...) creates a Message
    // document for its outbound send - this one didn't, which is why the actual qualifying
    // question never showed up in the Inbox conversation view even though it was genuinely
    // delivered via a real Meta API call (confirmed live: the run's own history logged "Asked
    // qualifying question" with no error, but the Inbox thread had no trace of it).
    const outboundMessage = await Message.create({
      organizationId: run.organizationId,
      workspaceId: run.workspaceId,
      conversationId: conversation._id,
      contactId: contact._id,
      whatsappAccountId: account._id,
      direction: "outbound",
      type: "interactive",
      body: question,
      providerMessageId: sendResult.providerMessageId,
      status: sendResult.status || "sent",
      sentAt: new Date(),
      metadata: {
        automationFlowId: flow._id,
        automationFlowName: flow.name,
        automationGenerated: true,
        providerMode: sendResult.mode,
      },
    });
    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          "metadata.pendingAutomationRunId": run._id,
          lastMessageId: outboundMessage._id,
          lastMessageAt: outboundMessage.sentAt,
        },
      }
    );

    return {
      status: "ok",
      waitForReply: true,
      action: { type: "ask_mcq", status: "sent", question, options },
      logMessage: `Asked qualifying question: "${question}"`,
    };
  }

  // Resumed: inboundMessage is the reply that just arrived (automationRunner.js re-points
  // run.trigger.inboundMessageId at it before calling advanceRun again).
  const interactiveReply = inboundMessage?.metadata?.interactiveReply;
  const matched = interactiveReply && options.find((option) => option.id === interactiveReply.id);

  logger.info(
    { nodeId: node.id, hasInteractiveReply: Boolean(interactiveReply), matchedOptionId: matched?.id || null, rawBody: inboundMessage?.body || "" },
    "execAskMcq: resumed, deciding branch"
  );

  run.context.variables = run.context.variables || {};

  if (matched) {
    run.context.variables[variableName] = matched.id;
    return {
      status: "ok",
      branch: "matched",
      action: { type: "ask_mcq", status: "matched", value: matched.id },
      logMessage: `Ask MCQ answer matched: ${matched.id}`,
    };
  }

  const rawReply = inboundMessage?.body || interactiveReply?.title || "";
  run.context.variables[`${variableName}_raw`] = rawReply;
  return {
    status: "ok",
    branch: "edge_case",
    action: { type: "ask_mcq", status: "edge_case", raw: rawReply },
    logMessage: `Ask MCQ hit an edge case: "${rawReply}"`,
  };
}

// "Open"/"closed" reads Vega's MeetingAvailability.weeklyWindows (the same config that gates
// booking slots) via checkVegaOfficeHours - no separate schedule lives in this flow, on purpose.
// Any failure to reach Vega (unconfigured, timeout, non-2xx) defaults to "closed" rather than
// "open" - wrongly promising a live agent is worse than wrongly deferring to the async fallback.
async function execCheckOfficeHours() {
  const result = await checkVegaOfficeHours();
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "execCheckOfficeHours: check failed, defaulting to closed");
    return {
      status: "ok",
      branch: "closed",
      action: { type: "check_office_hours", status: "unavailable", reason: result.reason },
      logMessage: `Office hours check unavailable (${result.reason}) - defaulting to closed`,
      logLevel: "warn",
    };
  }
  return {
    status: "ok",
    branch: result.open ? "open" : "closed",
    action: { type: "check_office_hours", status: "ok", open: result.open },
    logMessage: `Office hours: ${result.open ? "open" : "closed"}`,
  };
}

// "2026-09-08"/"11:00" -> "Tue 8 Sep, 11:00 AM" - both are already IST calendar-day/wall-clock
// strings from Vega (src/lib/meetings/date.ts), so this is pure string/date-math formatting, no
// timezone conversion needed on this side.
function formatSlotLabel(dateKey, timeKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeKey.split(":").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${weekday} ${day} ${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}, ${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

// Books a real Vega meeting slot in-chat - same event-based pause/resume pattern as ask_mcq
// above (a WhatsApp interactive list has no server-side state of its own, so the run persists
// across the separate "show slots" and "customer taps one" webhook events via
// Conversation.metadata.pendingAutomationRunId). Slots and the actual booking both come from
// Vega (vegaIntegration.js) - this node has no scheduling logic of its own, so "available slots"
// stays defined in exactly one place (the same MeetingAvailability an admin configures for the
// portal booking flow).
async function execBookMeeting({ node, config: cfg, env, run, flow, testMode }) {
  const { account, contact, conversation, inboundMessage } = env;
  if (!account || !contact?.phone || !conversation) {
    return { status: "skipped", logMessage: "Skipped book_meeting: missing account/contact/conversation", logLevel: "warn" };
  }

  const variableName = String(cfg?.variable || node.id).trim();
  const meetingType = cfg?.type === "in_person" ? "in_person" : "online";
  const priorState = run.context.steps[node.id];
  const priorOptions = Array.isArray(priorState?.options) ? priorState.options : [];
  const alreadyAsked = priorState?.status === "sent";

  const interactiveReply = alreadyAsked ? inboundMessage?.metadata?.interactiveReply : null;
  const matchedOption = interactiveReply && priorOptions.find((option) => option.id === interactiveReply.id);

  if (alreadyAsked && matchedOption) {
    const [dateKey, timeKey] = matchedOption.id.split("|");

    if (testMode) {
      return {
        status: "ok",
        branch: "booked",
        action: { type: "book_meeting", status: "skipped", skipped: true },
        logMessage: "Book meeting skipped in test mode",
      };
    }

    const bookResult = await bookVegaMeeting({ contactName: contact.name, contactPhone: contact.phone, type: meetingType, dateKey, timeKey });

    if (!bookResult.ok) {
      logger.warn({ nodeId: node.id, reason: bookResult.reason }, "execBookMeeting: booking failed");
      return {
        status: "ok",
        branch: "failed",
        action: { type: "book_meeting", status: "failed", reason: bookResult.reason },
        logMessage: `Meeting booking failed: ${bookResult.reason}`,
        logLevel: "warn",
      };
    }

    run.context.variables = run.context.variables || {};
    run.context.variables[variableName] = { dateKey, timeKey, type: meetingType };

    try {
      await enqueueAutomationSendMessage({
        flowId: flow._id.toString(),
        flowName: flow.name,
        nodeId: node.id,
        accountId: account._id.toString(),
        workspaceId: run.workspaceId.toString(),
        organizationId: run.organizationId.toString(),
        contactId: contact._id.toString(),
        conversationId: conversation._id.toString(),
        body: `You're booked for ${formatSlotLabel(dateKey, timeKey)} (${bookResult.durationMinutes || 30} min${
          meetingType === "in_person" ? `, ${bookResult.location}` : ""
        }). We'll see you then!`,
        testMode,
      });
    } catch (error) {
      logger.error({ nodeId: node.id, error: error.message }, "execBookMeeting: confirmation message failed to queue");
    }

    return {
      status: "ok",
      branch: "booked",
      action: { type: "book_meeting", status: "booked", dateKey, timeKey },
      logMessage: `Meeting booked: ${dateKey} ${timeKey}`,
    };
  }

  // First visit, or a resumed reply that didn't match any offered slot - (re)fetch and (re)send
  // the list. Reusing this same branch for "no match" keeps the node's state machine to two
  // cases (has a matched tap / doesn't) instead of a third "nudge and re-wait" special case.
  if (testMode) {
    return { status: "ok", action: { type: "book_meeting", status: "skipped", skipped: true }, logMessage: "Book meeting skipped in test mode" };
  }

  const slotsResult = await fetchVegaMeetingSlots({ type: meetingType });
  const slots = slotsResult.ok ? slotsResult.slots || [] : [];
  if (!slots.length) {
    return {
      status: "ok",
      branch: "no_slots",
      action: { type: "book_meeting", status: "no_slots", reason: slotsResult.ok ? "no_availability" : slotsResult.reason },
      logMessage: "No meeting slots available",
      logLevel: "warn",
    };
  }

  const options = slots.map((slot) => ({ id: `${slot.dateKey}|${slot.timeKey}`, title: formatSlotLabel(slot.dateKey, slot.timeKey) }));
  const question = String(cfg?.body || "").trim() || "Great! Here are our next available slots - pick one that works:";

  let sendResult;
  try {
    sendResult = await sendWhatsAppInteractive({ account, to: contact.phone, body: question, list: { buttonLabel: "Choose a time", rows: options } });
  } catch (error) {
    logger.error({ nodeId: node.id, conversationId: conversation._id?.toString(), error: error.message }, "execBookMeeting: send failed");
    return {
      status: "failed",
      branch: "send_failed",
      error: error.message,
      action: { type: "book_meeting", status: "failed", error: error.message },
      logMessage: "Book meeting failed to send",
      logLevel: "error",
    };
  }

  const outboundMessage = await Message.create({
    organizationId: run.organizationId,
    workspaceId: run.workspaceId,
    conversationId: conversation._id,
    contactId: contact._id,
    whatsappAccountId: account._id,
    direction: "outbound",
    type: "interactive",
    body: question,
    providerMessageId: sendResult.providerMessageId,
    status: sendResult.status || "sent",
    sentAt: new Date(),
    metadata: { automationFlowId: flow._id, automationFlowName: flow.name, automationGenerated: true, providerMode: sendResult.mode },
  });
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { "metadata.pendingAutomationRunId": run._id, lastMessageId: outboundMessage._id, lastMessageAt: outboundMessage.sentAt } }
  );

  return {
    status: "ok",
    waitForReply: true,
    action: { type: "book_meeting", status: "sent", options },
    logMessage: `Offered ${options.length} meeting slots`,
  };
}

// Cancels a real Vega meeting - the "CTWA - meeting reschedule" flow's first step, before it
// re-offers slots via book_meeting above. meetingId is normally {{trigger.replyToMeetingId}}
// (see automationRunner.js), not a fixed node.config value, so it comes from the interpolated
// config like every other user-facing field. Deliberately no branch output (unlike book_meeting):
// a customer who tapped Reschedule should still get offered new slots even if the old meeting
// failed to cancel cleanly - pickNext dead-ends a run when a branch has no matching edge
// (see automationEngine.js), so this stays a single default-edge step, not a fork.
async function execCancelMeeting({ node, config: cfg, testMode }) {
  const meetingId = String(cfg?.meetingId || "").trim();
  if (!meetingId) return { status: "skipped", logMessage: "Skipped cancel_meeting: no meetingId", logLevel: "warn" };

  if (testMode) {
    return { status: "ok", action: { type: "cancel_meeting", status: "skipped", skipped: true, meetingId }, logMessage: "Cancel meeting skipped in test mode" };
  }

  const reason = String(cfg?.reason || "Customer requested reschedule via WhatsApp").trim();
  const result = await cancelVegaMeeting(meetingId, reason);
  if (!result.ok) {
    logger.warn({ nodeId: node.id, meetingId, reason: result.reason }, "execCancelMeeting: cancel failed");
    return {
      status: "ok",
      action: { type: "cancel_meeting", status: "failed", reason: result.reason },
      logMessage: `Meeting cancel failed: ${result.reason} (continuing to offer new slots anyway)`,
      logLevel: "warn",
    };
  }

  return {
    status: "ok",
    action: { type: "cancel_meeting", status: "cancelled", meetingId },
    logMessage: `Meeting ${meetingId} cancelled`,
  };
}

// Calls BillStack's own real external-integration API (billstackIntegration.js) with THIS
// workspace's own apiKey/baseUrl - never Nemnidhi's. Every tenant that bills through BillStack
// (whether Nemnidhi's own workspace or a future paying client with their own BillStack tenant)
// configures its own credential here, same shape as the per-workspace AI provider keys. v1 scope
// is deliberately a single line item per node (matching book_meeting's single-purpose design) -
// a flow needing multiple items would use several of these nodes in sequence, not one node with a
// dynamic item list, which the no-code flow builder has no UI for yet.
async function execBillstackInvoice({ node, config: cfg, env, run, testMode }) {
  const apiKey = String(cfg?.apiKey || "").trim();
  const baseUrl = String(cfg?.baseUrl || "").trim();
  const customerName = String(cfg?.customerName || env.contact?.name || "").trim();
  const customerEmail = String(cfg?.customerEmail || "").trim();
  const customerPhone = String(cfg?.customerPhone || env.contact?.phone || "").trim();
  const itemName = String(cfg?.itemName || "").trim();
  const amount = Number(cfg?.amount || 0);
  const quantity = Math.max(1, Number(cfg?.quantity || 1));
  const markPaid = cfg?.markPaid === true || cfg?.markPaid === "true";

  if (!apiKey || !(baseUrl || config.billstack.baseUrl)) {
    return {
      status: "skipped",
      action: { type: "billstack_invoice", status: "skipped", reason: "not_configured" },
      logMessage: "Skipped billstack_invoice: no BillStack API key or base URL configured",
      logLevel: "warn",
    };
  }
  if (!customerName && !customerEmail && !customerPhone) {
    return {
      status: "skipped",
      action: { type: "billstack_invoice", status: "skipped", reason: "missing_customer" },
      logMessage: "Skipped billstack_invoice: no customer name, email, or phone",
      logLevel: "warn",
    };
  }
  if (!itemName || !(amount > 0)) {
    return {
      status: "skipped",
      action: { type: "billstack_invoice", status: "skipped", reason: "missing_item" },
      logMessage: "Skipped billstack_invoice: item name and a positive amount are required",
      logLevel: "warn",
    };
  }

  if (testMode) {
    return { status: "ok", action: { type: "billstack_invoice", status: "skipped", skipped: true }, logMessage: "BillStack invoice skipped in test mode" };
  }

  // Deterministic per (run, node) rather than left to the flow author to supply - BillStack
  // treats externalOrderId as the idempotency key, so a resumed/retried run naturally replays the
  // exact same order instead of risking a duplicate invoice.
  const externalOrderId = `whatscrm-${run._id.toString()}-${node.id}`;

  const result = await sendBillstackOrder({
    baseUrl,
    apiKey,
    order: {
      externalOrderId,
      source: "WHATSCRM",
      customer: {
        ...(customerName ? { name: customerName } : {}),
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(customerPhone ? { phone: customerPhone } : {}),
      },
      items: [{ name: itemName, rate: amount, quantity }],
      ...(markPaid ? { payment: { status: "CONFIRMED", amount: amount * quantity } } : {}),
    },
  });

  if (!result.ok) {
    logger.warn({ nodeId: node.id, reason: result.reason }, "execBillstackInvoice: order rejected");
    return {
      status: "ok",
      action: { type: "billstack_invoice", status: "failed", reason: result.reason },
      logMessage: `BillStack invoice failed: ${result.reason}`,
      logLevel: "warn",
    };
  }

  run.context.variables = run.context.variables || {};
  run.context.variables[String(cfg?.variable || node.id)] = { invoiceId: result.invoiceId, externalOrderId };

  return {
    status: "ok",
    action: { type: "billstack_invoice", status: "created", invoiceId: result.invoiceId, externalOrderId },
    logMessage: result.idempotent ? "BillStack invoice already existed for this run (idempotent replay)" : "BillStack invoice created",
  };
}

// Single Product messages only (v1 scope, matching whatsappCommerce.js) - synchronous, no queue,
// same shape as execSendFlow above since both are Meta-only interactive-message sends outside the
// bulk-campaign system. catalogId comes from the triggering WhatsAppAccount (a business connects
// one catalog per account via Settings, not per-automation-step), so unlike flowId this isn't a
// node.config selection - only productRetailerId (a fixed SKU pick, not templated, so read from
// raw node.config like flowId) and the optional bodyText (user-facing, so read from the
// interpolated config so {{contact.name}}-style tokens resolve) come from the node itself.
async function execSendProductMessage({ node, config: cfg, env, testMode }) {
  const { account, contact } = env;
  if (!account || !contact?.phone) {
    return { status: "skipped", logMessage: "Skipped send_product_message: missing account/contact phone", logLevel: "warn" };
  }

  if (!account.catalogId) {
    return { status: "skipped", logMessage: "Skipped send_product_message: account has no Catalog ID configured", logLevel: "warn" };
  }

  const productRetailerId = String(node.config?.productRetailerId || "").trim();
  if (!productRetailerId) {
    return { status: "skipped", logMessage: "Skipped send_product_message: no product selected", logLevel: "warn" };
  }

  if (testMode) {
    return { status: "ok", action: { type: "send_product_message", status: "skipped", skipped: true, productRetailerId }, logMessage: "Product message send skipped in test mode" };
  }

  try {
    const result = await sendWhatsAppProductMessage({
      account,
      to: contact.phone,
      catalogId: account.catalogId,
      productRetailerId,
      bodyText: cfg?.bodyText || undefined,
    });
    return {
      status: "ok",
      action: { type: "send_product_message", status: "sent", productRetailerId, providerMessageId: result.providerMessageId },
      logMessage: `Product "${productRetailerId}" sent`,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "send_product_message", status: "failed", error: error.message },
      logMessage: "Product message send failed",
      logLevel: "error",
    };
  }
}

async function execSubWorkflow({ node, config: cfg, run, testMode }) {
  const targetFlowId = String(node.config?.flowId || "").trim();
  if (!targetFlowId || !mongoose.Types.ObjectId.isValid(targetFlowId)) {
    return { status: "skipped", logMessage: "Skipped sub_workflow: no target flow selected", logLevel: "warn" };
  }

  const chain = Array.isArray(run.chain) ? run.chain : [];
  if (chain.length >= MAX_SUB_WORKFLOW_DEPTH) {
    return {
      status: "failed",
      error: "sub_workflow_depth_exceeded",
      action: { type: "sub_workflow", status: "failed", error: "sub_workflow_depth_exceeded" },
      logMessage: `Sub-workflow call skipped: exceeded max nesting depth (${MAX_SUB_WORKFLOW_DEPTH})`,
      logLevel: "error",
    };
  }

  const targetFlow = await AutomationFlow.findOne({ _id: targetFlowId, workspaceId: run.workspaceId, status: "published" });
  if (!targetFlow) {
    return {
      status: "failed",
      error: "sub_workflow_not_found",
      action: { type: "sub_workflow", status: "failed", error: "sub_workflow_not_found" },
      logMessage: "Sub-workflow call failed: target flow not found or not published",
      logLevel: "error",
    };
  }

  const childRun = await AutomationRun.create({
    organizationId: run.organizationId,
    workspaceId: run.workspaceId,
    flowId: targetFlow._id,
    parentRunId: run._id,
    chain: [...chain, targetFlow._id],
    testMode,
    trigger: { ...(run.trigger || {}) },
    context: { trigger: run.context?.trigger || {}, steps: {}, variables: { input: cfg?.body ?? "" } },
  });

  await advanceRun(childRun, targetFlow, { testMode });

  return {
    status: childRun.status === "failed" ? "failed" : "ok",
    action: {
      type: "sub_workflow",
      status: childRun.status,
      subFlowId: targetFlow._id.toString(),
      subRunId: childRun._id.toString(),
    },
    logMessage: `Sub-workflow "${targetFlow.name}" ${childRun.status}`,
    logLevel: childRun.status === "failed" ? "error" : "info",
  };
}

const executors = {
  send_message: execSendMessage,
  assign_user: execAssignUser,
  set_status: execSetStatus,
  add_tag: execAddTag,
  add_to_crm: makeCrmExecutor("add_to_crm"),
  lead_stage: makeCrmExecutor("lead_stage"),
  google_sheets: execGoogleSheets,
  call_webhook: execCallWebhook,
  condition: execCondition,
  if_else: execIfElse,
  api: execApi,
  http_request: execApi,
  delay: execDelay,
  json_parser: execJsonParser,
  variables: execVariables,
  openai: makeAiExecutor("openai"),
  claude: makeAiExecutor("claude"),
  gemini: makeAiExecutor("gemini"),
  email: execEmail,
  send_flow: execSendFlow,
  ask_mcq: execAskMcq,
  check_office_hours: execCheckOfficeHours,
  book_meeting: execBookMeeting,
  cancel_meeting: execCancelMeeting,
  billstack_invoice: execBillstackInvoice,
  send_product_message: execSendProductMessage,
  send_instagram: execSendInstagram,
  sms: execSms,
  loop: execLoop,
  sub_workflow: execSubWorkflow,
  code_block: execCodeBlock,
  task: execTask,
  calendar: execCalendar,
};

export function executorFor(type) {
  return executors[canonicalNodeType(type)] || execUnsupported;
}

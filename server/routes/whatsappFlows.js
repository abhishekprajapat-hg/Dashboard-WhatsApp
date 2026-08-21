import { Router } from "express";
import { z } from "zod";
import { WhatsAppAccount, WhatsAppFlow } from "../models/index.js";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { trimmedString } from "../utils/zodHelpers.js";
import { createFlow, deleteFlow, FLOW_TEMPLATES, publishFlow, sendFlowMessage } from "../services/whatsappFlows.js";

export const whatsappFlowsRouter = Router();

function serializeFlow(flow) {
  return {
    id: flow._id.toString(),
    whatsappAccountId: flow.whatsappAccountId.toString(),
    name: flow.name,
    template: flow.template,
    categories: flow.categories,
    metaFlowId: flow.metaFlowId,
    status: flow.status,
    lastError: flow.lastError || "",
    createdAt: flow.createdAt,
  };
}

export const createFlowSchema = z.object({
  whatsappAccountId: trimmedString("A WhatsApp account is required."),
  template: z.enum(Object.keys(FLOW_TEMPLATES)),
  name: trimmedString("Flow name is required."),
});

export const sendFlowSchema = z.object({
  to: trimmedString("A recipient phone number is required."),
  headerText: z.string().optional().default(""),
  bodyText: z.string().optional().default(""),
  ctaLabel: z.string().optional().default(""),
});

whatsappFlowsRouter.get("/templates", requirePermission("templates:read"), async (_req, res) => {
  res.json({
    data: Object.entries(FLOW_TEMPLATES).map(([id, definition]) => ({
      id,
      label: definition.label,
      categories: definition.categories,
    })),
  });
});

whatsappFlowsRouter.get("/", requirePermission("templates:read"), async (req, res) => {
  const flows = await WhatsAppFlow.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: flows.map(serializeFlow), total: flows.length });
});

whatsappFlowsRouter.post("/", requirePermission("templates:write"), validateBody(createFlowSchema), async (req, res) => {
  const account = await WhatsAppAccount.findOne({ _id: req.body.whatsappAccountId, workspaceId: req.user.workspaceId });
  if (!account) return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });

  let created;
  try {
    created = await createFlow({ account, template: req.body.template, name: req.body.name });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.code || "FLOW_CREATE_FAILED", message: error.message });
  }

  const flow = await WhatsAppFlow.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    whatsappAccountId: account._id,
    name: req.body.name,
    template: req.body.template,
    categories: created.categories,
    flowJson: created.flowJson,
    metaFlowId: created.metaFlowId,
    status: "draft",
  });

  res.status(201).json({ data: serializeFlow(flow) });
});

whatsappFlowsRouter.post("/:id/publish", requirePermission("templates:write"), async (req, res) => {
  const flow = await WhatsAppFlow.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });

  const account = await WhatsAppAccount.findById(flow.whatsappAccountId);
  try {
    await publishFlow({ account, metaFlowId: flow.metaFlowId });
    flow.status = "published";
    flow.lastError = "";
  } catch (error) {
    flow.lastError = error.message;
    await flow.save();
    return res.status(error.status || 502).json({ error: error.code || "FLOW_PUBLISH_FAILED", message: error.message });
  }
  await flow.save();
  res.json({ data: serializeFlow(flow) });
});

whatsappFlowsRouter.post("/:id/send", requirePermission("templates:write"), validateBody(sendFlowSchema), async (req, res) => {
  const flow = await WhatsAppFlow.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  if (flow.status !== "published") {
    return res.status(400).json({ error: "FLOW_NOT_PUBLISHED", message: "Publish the flow before sending it." });
  }

  const account = await WhatsAppAccount.findById(flow.whatsappAccountId);
  const screenId = flow.flowJson?.screens?.[0]?.id;

  try {
    const result = await sendFlowMessage({
      account,
      flow,
      to: req.body.to,
      screenId,
      headerText: req.body.headerText,
      bodyText: req.body.bodyText,
      ctaLabel: req.body.ctaLabel,
    });
    res.json({ data: result });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "FLOW_SEND_FAILED", message: error.message });
  }
});

whatsappFlowsRouter.delete("/:id", requirePermission("templates:write"), async (req, res) => {
  const flow = await WhatsAppFlow.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  if (flow.status !== "draft") {
    return res.status(400).json({ error: "FLOW_NOT_DRAFT", message: "Only draft flows can be deleted - Meta does not allow deleting a published flow." });
  }

  const account = await WhatsAppAccount.findById(flow.whatsappAccountId);
  await deleteFlow({ account, metaFlowId: flow.metaFlowId });
  await flow.deleteOne();
  res.status(204).send();
});

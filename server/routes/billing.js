import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Invoice, Organization } from "../models/index.js";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { config } from "../config.js";
import { PLAN_PRICES } from "../services/entitlements.js";
import { cancelRazorpaySubscription, createRazorpaySubscription, isRazorpayConfigured, verifySubscriptionSignature } from "../services/razorpayProvider.js";
import { notifyVega } from "../services/vegaIntegration.js";

export const billingRouter = Router();

const subscribeSchema = z.object({
  plan: z.enum(["basic", "medium", "pro"]),
});

const verifySchema = z.object({
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

billingRouter.get("/", requirePermission("billing:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const [organization, invoices] = await Promise.all([
    Organization.findById(req.user.organizationId),
    Invoice.find({ organizationId: req.user.organizationId }).sort({ createdAt: -1 }).limit(20),
  ]);
  if (!organization) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }

  res.json({
    plan: organization.plan,
    billingStatus: organization.billingStatus,
    razorpaySubscriptionId: organization.razorpaySubscriptionId || "",
    // Publishable, not secret - Checkout.js needs this client-side, same as any payment gateway's
    // public key.
    razorpayKeyId: config.razorpay.keyId,
    configured: isRazorpayConfigured(),
    prices: PLAN_PRICES,
    invoices: invoices.map((invoice) => ({
      id: invoice._id.toString(),
      plan: invoice.plan,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      createdAt: invoice.createdAt,
    })),
  });
});

billingRouter.post("/subscribe", requirePermission("billing:write"), validateBody(subscribeSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }
  if (!isRazorpayConfigured()) {
    return res.status(503).json({ error: "BILLING_NOT_CONFIGURED", message: "Billing is not configured yet." });
  }

  const planId = config.razorpay.planIds[req.body.plan];
  if (!planId) {
    return res.status(400).json({ error: "PLAN_NOT_AVAILABLE", message: `No Razorpay plan is configured for "${req.body.plan}" yet.` });
  }

  const organization = await Organization.findById(req.user.organizationId);
  if (!organization) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }

  let subscription;
  try {
    subscription = await createRazorpaySubscription({
      planId,
      notes: { organizationId: organization._id.toString(), workspaceId: req.user.workspaceId, plan: req.body.plan },
    });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.code || "RAZORPAY_SUBSCRIBE_FAILED", message: error.message });
  }

  organization.razorpaySubscriptionId = subscription.id;
  organization.billingStatus = "pending";
  // Stashed so /verify (and the webhook) know which tier this subscription is for before
  // Organization.plan itself changes - Organization.settings is already used as this kind of
  // free-form bag elsewhere (see admin.js's organization.settings.billing).
  organization.settings = {
    ...(organization.settings || {}),
    billing: { ...(organization.settings?.billing || {}), pendingPlan: req.body.plan },
  };
  organization.markModified("settings");
  await organization.save();

  res.json({ subscriptionId: subscription.id, keyId: config.razorpay.keyId, plan: req.body.plan });
});

billingRouter.post("/verify", requirePermission("billing:write"), validateBody(verifySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const organization = await Organization.findById(req.user.organizationId);
  if (!organization?.razorpaySubscriptionId) {
    return res.status(400).json({ error: "NO_PENDING_SUBSCRIPTION", message: "No subscription is pending verification." });
  }

  const valid = verifySubscriptionSignature({
    paymentId: req.body.razorpay_payment_id,
    // Our own stored subscription id, never req.body.razorpay_subscription_id taken on faith -
    // see verifySubscriptionSignature's own comment for why that distinction matters.
    subscriptionId: organization.razorpaySubscriptionId,
    signature: req.body.razorpay_signature,
  });
  if (!valid) {
    return res.status(400).json({ error: "INVALID_SIGNATURE", message: "Payment signature verification failed." });
  }

  const previousPlan = organization.plan;
  const plan = organization.settings?.billing?.pendingPlan || organization.plan;
  organization.plan = plan;
  organization.billingStatus = "active";
  await organization.save();

  const priceInfo = PLAN_PRICES[plan];
  try {
    await Invoice.create({
      organizationId: organization._id,
      workspaceId: req.user.workspaceId,
      plan,
      amount: priceInfo?.amount || 0,
      currency: priceInfo?.currency || "INR",
      status: "paid",
      razorpayPaymentId: req.body.razorpay_payment_id,
      razorpaySubscriptionId: organization.razorpaySubscriptionId,
    });
  } catch (error) {
    // Duplicate razorpayPaymentId (client retried an already-verified payment) - the Invoice row
    // from the first attempt already exists, not a real failure.
    if (error.code !== 11000) throw error;
  }

  res.json({ ok: true, plan: organization.plan, billingStatus: organization.billingStatus });

  // Fired after the response, same fire-and-forget shape as admin.js's entitlements/plan route -
  // reuses that exact event so this billing flow feeds the same Dashboard->Vega stream a manual
  // admin plan change already does, not a second parallel mechanism.
  notifyVega(organization._id.toString(), "plan_changed", { plan: organization.plan, previousPlan }).catch(() => undefined);
});

billingRouter.post("/cancel", requirePermission("billing:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const organization = await Organization.findById(req.user.organizationId);
  if (!organization?.razorpaySubscriptionId) {
    return res.status(400).json({ error: "NO_ACTIVE_SUBSCRIPTION", message: "There is no active subscription to cancel." });
  }

  try {
    await cancelRazorpaySubscription(organization.razorpaySubscriptionId);
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.code || "RAZORPAY_CANCEL_FAILED", message: error.message });
  }

  organization.billingStatus = "cancelling";
  await organization.save();
  res.json({ ok: true, billingStatus: organization.billingStatus });
});

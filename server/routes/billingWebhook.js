import { Router } from "express";
import mongoose from "mongoose";
import { Invoice, Organization } from "../models/index.js";
import { isValidRazorpayWebhookSignature } from "../services/razorpayProvider.js";
import { logger } from "../services/logger.js";

export const billingWebhookRouter = Router();

const STATUS_BY_EVENT = {
  "subscription.activated": "active",
  "subscription.pending": "pending",
  "subscription.halted": "halted",
  "subscription.cancelled": "cancelled",
};

// Unauthenticated by design - Razorpay's own POST carries no JWT, same reasoning as
// instagramPublicRouter/whatsappWebhookRouter. Recurring charges happen with no browser present,
// so this is the source of truth for subscription state, not just a backstop for /verify.
billingWebhookRouter.post("/", async (req, res) => {
  if (!isValidRazorpayWebhookSignature(req.rawBody, req.headers["x-razorpay-signature"])) {
    return res.status(403).json({ error: "INVALID_SIGNATURE", message: "Razorpay webhook signature verification failed." });
  }

  if (mongoose.connection.readyState !== 1) return res.sendStatus(200);

  const event = req.body?.event || "";
  const subscriptionEntity = req.body?.payload?.subscription?.entity;
  const paymentEntity = req.body?.payload?.payment?.entity;
  const subscriptionId = subscriptionEntity?.id;
  if (!subscriptionId) return res.sendStatus(200);

  const organization = await Organization.findOne({ razorpaySubscriptionId: subscriptionId });
  if (!organization) {
    logger.warn({ event, subscriptionId }, "Razorpay webhook: no organization found for this subscription");
    return res.sendStatus(200);
  }

  if (event === "subscription.charged") {
    const plan = subscriptionEntity.notes?.plan || organization.settings?.billing?.pendingPlan || organization.plan;
    try {
      await Invoice.create({
        organizationId: organization._id,
        // Round-tripped through the `notes` field passed when the subscription was first created
        // (billing.js's /subscribe route) - the webhook has no req.user/session to read this from.
        workspaceId: subscriptionEntity.notes?.workspaceId,
        plan,
        amount: paymentEntity?.amount || 0,
        currency: paymentEntity?.currency || "INR",
        status: "paid",
        razorpayPaymentId: paymentEntity?.id || "",
        razorpaySubscriptionId: subscriptionId,
        periodStart: subscriptionEntity.current_start ? new Date(subscriptionEntity.current_start * 1000) : undefined,
        periodEnd: subscriptionEntity.current_end ? new Date(subscriptionEntity.current_end * 1000) : undefined,
      });
    } catch (error) {
      // Duplicate razorpayPaymentId (Razorpay retried the same webhook delivery) - not a real
      // failure, the Invoice row from the first delivery already exists.
      if (error.code !== 11000) throw error;
    }
    organization.billingStatus = "active";
    await organization.save();
    return res.sendStatus(200);
  }

  const nextStatus = STATUS_BY_EVENT[event];
  if (nextStatus) {
    organization.billingStatus = nextStatus;
    if (nextStatus === "active" && subscriptionEntity.customer_id) {
      organization.razorpayCustomerId = subscriptionEntity.customer_id;
    }
    await organization.save();
  }

  res.sendStatus(200);
});

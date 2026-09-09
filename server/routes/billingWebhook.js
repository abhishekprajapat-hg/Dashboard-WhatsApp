import { Router } from "express";
import mongoose from "mongoose";
import { Invoice, Organization, User } from "../models/index.js";
import { isValidRazorpayWebhookSignature } from "../services/razorpayProvider.js";
import { issueGstInvoiceFields, generateInvoicePdfBuffer } from "../services/gstInvoice.js";
import { sendInvoiceEmail } from "../services/mailer.js";
import { logger } from "../services/logger.js";

// Real payment succeeded (this webhook already fired, money already moved) - a failure generating
// the PDF or sending the email must never look like the Invoice itself failed to record. Logged
// and swallowed; the invoice row (and its real GST numbering) stands regardless, downloadable
// later from the Billing page even if this specific send attempt failed.
async function issueAndEmailInvoice(invoice, organization) {
  try {
    const pdfBuffer = await generateInvoicePdfBuffer(invoice);
    const owner = await User.findById(organization.ownerUserId).select("email name");
    if (!owner?.email) return;
    await sendInvoiceEmail({ to: owner.email, name: owner.name || organization.name, invoice, pdfBuffer });
    invoice.pdfSentAt = new Date();
    await invoice.save();
  } catch (error) {
    logger.warn({ err: error, invoiceId: invoice._id.toString() }, "Could not email GST invoice - the invoice itself is still recorded and downloadable");
  }
}

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
    const amount = paymentEntity?.amount || 0;
    let invoice;
    try {
      const gstFields = await issueGstInvoiceFields({ organization, totalAmountMinorUnits: amount });
      invoice = await Invoice.create({
        organizationId: organization._id,
        // Round-tripped through the `notes` field passed when the subscription was first created
        // (billing.js's /subscribe route) - the webhook has no req.user/session to read this from.
        workspaceId: subscriptionEntity.notes?.workspaceId,
        plan,
        amount,
        currency: paymentEntity?.currency || "INR",
        status: "paid",
        razorpayPaymentId: paymentEntity?.id || "",
        razorpaySubscriptionId: subscriptionId,
        periodStart: subscriptionEntity.current_start ? new Date(subscriptionEntity.current_start * 1000) : undefined,
        periodEnd: subscriptionEntity.current_end ? new Date(subscriptionEntity.current_end * 1000) : undefined,
        ...gstFields,
      });
    } catch (error) {
      // Duplicate razorpayPaymentId (Razorpay retried the same webhook delivery) - not a real
      // failure, the Invoice row from the first delivery already exists. A real invoice number was
      // still consumed from the counter for the attempt that lost the race - acceptable (GST
      // requires gapless, not permission to reuse a number), not worth a compensating decrement
      // that could itself race a concurrent legitimate invoice.
      if (error.code !== 11000) throw error;
    }
    if (invoice) await issueAndEmailInvoice(invoice, organization);
    organization.billingStatus = "active";
    if (subscriptionEntity.current_start) organization.currentPeriodStart = new Date(subscriptionEntity.current_start * 1000);
    if (subscriptionEntity.current_end) organization.currentPeriodEnd = new Date(subscriptionEntity.current_end * 1000);
    await organization.save();
    return res.sendStatus(200);
  }

  const nextStatus = STATUS_BY_EVENT[event];
  if (nextStatus) {
    organization.billingStatus = nextStatus;
    if (nextStatus === "active" && subscriptionEntity.customer_id) {
      organization.razorpayCustomerId = subscriptionEntity.customer_id;
    }
    // Razorpay includes current_start/current_end on every subscription-entity payload, not just
    // "charged" - keep the denormalized period in sync on every event that carries it (e.g.
    // "activated" fires before the first "charged" and already has real cycle dates).
    if (subscriptionEntity.current_start) organization.currentPeriodStart = new Date(subscriptionEntity.current_start * 1000);
    if (subscriptionEntity.current_end) organization.currentPeriodEnd = new Date(subscriptionEntity.current_end * 1000);
    await organization.save();
  }

  res.sendStatus(200);
});

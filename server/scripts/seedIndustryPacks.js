// Seeds the starter Industry Pack catalog (master plan Phase 8) - idempotent upsert by `key`, safe
// to re-run (e.g. after adding a new pack or editing an existing one's templates) without
// duplicating or touching organizations/workspaces. Run with: node scripts/seedIndustryPacks.js
import "dotenv/config";
import mongoose from "mongoose";
import { IndustryPack } from "../models/index.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";

// Three real, usable starting points - not placeholder text. Each becomes a set of draft
// WhatsApp Templates (status: "draft") cloned into a newly provisioned workspace via
// POST /api/platform-admin/organizations/:id/provision - a workspace edits/submits them for real
// from there, same as any hand-authored template.
const packs = [
  {
    key: "retail",
    label: "Retail & E-commerce",
    industry: "retail",
    description: "Order confirmations, restock alerts, and cart recovery for an online or in-store retailer.",
    templates: [
      {
        name: "order_confirmation",
        category: "utility",
        body: "Hi {{1}}, thanks for your order #{{2}}! Total: {{3}}. We'll let you know as soon as it ships.",
        variables: ["customer_name", "order_number", "order_total"],
      },
      {
        name: "back_in_stock",
        category: "marketing",
        body: "Hi {{1}}, good news - {{2}} is back in stock! Tap below to shop now before it sells out again.",
        variables: ["customer_name", "product_name"],
        buttons: [{ type: "URL", text: "Shop now", url: "https://example.com/products/{{1}}" }],
      },
      {
        name: "cart_recovery",
        category: "marketing",
        body: "Hi {{1}}, you left {{2}} in your cart. Complete your purchase now and we'll cover the delivery.",
        variables: ["customer_name", "cart_summary"],
      },
    ],
  },
  {
    key: "restaurant",
    label: "Restaurant & Food Service",
    industry: "restaurant",
    description: "Reservation confirmations, pickup-ready alerts, and feedback requests for a restaurant or cafe.",
    templates: [
      {
        name: "reservation_confirmation",
        category: "utility",
        body: "Hi {{1}}, your table for {{2}} on {{3}} at {{4}} is confirmed. We look forward to hosting you!",
        variables: ["customer_name", "party_size", "date", "time"],
      },
      {
        name: "order_ready_for_pickup",
        category: "utility",
        body: "Hi {{1}}, your order #{{2}} is ready for pickup at {{3}}.",
        variables: ["customer_name", "order_number", "location"],
      },
      {
        name: "feedback_request",
        category: "utility",
        body: "Hi {{1}}, thanks for dining with us! We'd love to hear how it went - reply with a rating from 1 to 5.",
        variables: ["customer_name"],
      },
    ],
  },
  {
    key: "professional_services",
    label: "Professional Services",
    industry: "professional_services",
    description: "Appointment reminders, proposal follow-ups, and invoice reminders for a consultancy, agency, or clinic.",
    templates: [
      {
        name: "appointment_reminder",
        category: "utility",
        body: "Hi {{1}}, this is a reminder for your appointment with {{2}} on {{3}} at {{4}}. Reply CONFIRM to confirm or RESCHEDULE to change it.",
        variables: ["customer_name", "staff_name", "date", "time"],
      },
      {
        name: "proposal_sent",
        category: "utility",
        body: "Hi {{1}}, we've sent your proposal for {{2}}. Please take a look and let us know if you have any questions.",
        variables: ["customer_name", "project_name"],
      },
      {
        name: "invoice_due_reminder",
        category: "utility",
        body: "Hi {{1}}, this is a friendly reminder that invoice #{{2}} for {{3}} is due on {{4}}.",
        variables: ["customer_name", "invoice_number", "amount", "due_date"],
      },
    ],
  },
];

async function seedIndustryPacks() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

  for (const pack of packs) {
    const result = await IndustryPack.findOneAndUpdate(
      { key: pack.key },
      { $set: { ...pack, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`upserted industry pack "${result.key}" (${result.templates.length} templates)`);
  }

  await mongoose.disconnect();
}

seedIndustryPacks()
  .then(() => {
    console.log("done");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

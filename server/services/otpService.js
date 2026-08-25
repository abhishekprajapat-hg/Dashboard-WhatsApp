import crypto from "crypto";
import { config } from "../config.js";
import { Template, VerificationCode, WhatsAppAccount } from "../models/index.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { sendWhatsAppTemplate } from "./whatsappProvider.js";

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function normalizePhone(phone = "") {
  return String(phone).replace(/[^\d]/g, "");
}

function generateCode() {
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, "0");
}

export async function generateAndSendOtp(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    const error = new Error("A valid phone number is required.");
    error.code = "INVALID_PHONE";
    error.status = 400;
    throw error;
  }

  // Send from Nemnidhi's own platform number, never the new client's - they don't have one yet at
  // signup time. Toggled per-account in Settings -> WhatsApp rather than an env-configured id, so
  // this isn't a second place this project hardcodes "which account is us".
  const systemAccount = await WhatsAppAccount.findOne({ isSystemAccount: true, status: "connected" });
  if (!systemAccount) {
    const error = new Error("No system WhatsApp account is configured to send OTP codes.");
    error.code = "OTP_SENDER_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  const template = await Template.findOne({
    workspaceId: systemAccount.workspaceId,
    name: config.whatsappOtpTemplateName,
    status: "approved",
  });
  if (!template) {
    const error = new Error(`WhatsApp template "${config.whatsappOtpTemplateName}" is not synced/approved yet.`);
    error.code = "OTP_TEMPLATE_NOT_READY";
    error.status = 503;
    throw error;
  }

  const code = generateCode();

  // Invalidate any still-open code for this phone first - codes shouldn't stack, only the latest
  // one a person actually received should ever verify successfully.
  await VerificationCode.updateMany(
    { phone, purpose: "signup", consumedAt: { $exists: false } },
    { $set: { consumedAt: new Date() } }
  );
  await VerificationCode.create({
    phone,
    purpose: "signup",
    codeHash: hashPassword(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await sendWhatsAppTemplate({ account: systemAccount, to: phone, template, parameters: [code] });

  return { sent: true };
}

export async function verifyOtp(rawPhone, code) {
  const phone = normalizePhone(rawPhone);
  const record = await VerificationCode.findOne({ phone, purpose: "signup", consumedAt: { $exists: false } }).sort({ createdAt: -1 });

  if (!record || record.expiresAt < new Date()) {
    return { verified: false, reason: "expired_or_missing" };
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    return { verified: false, reason: "too_many_attempts" };
  }

  const matches = verifyPassword(String(code || ""), record.codeHash);
  if (!matches) {
    await VerificationCode.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    return { verified: false, reason: "incorrect_code" };
  }

  await VerificationCode.updateOne({ _id: record._id }, { $set: { consumedAt: new Date() } });
  return { verified: true, phone };
}

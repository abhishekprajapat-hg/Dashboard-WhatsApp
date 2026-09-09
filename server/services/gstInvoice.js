import PDFDocument from "pdfkit";
import { config } from "../config.js";
import { nextSequence } from "../models/Counter.js";

// This product's own invoice series prefix - GST Rule 46(b) explicitly permits a registered
// person to run multiple invoice series under one GSTIN (e.g. one per product line) as long as
// each series is internally gapless/sequential and distinguishable, so this never collides with
// numbering used by Nemnidhi's other products/systems.
const INVOICE_PREFIX = "NEM-WA";
const GST_RATE = 0.18;
const SAC_CODE = "998314"; // Software development/SaaS services

// India's GST financial year runs April 1 - March 31, e.g. 1 Apr 2026 - 31 Mar 2027 is "2026-27".
export function financialYearLabel(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based; April = 3
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Atomic per-financial-year counter (models/Counter.js's findOneAndUpdate $inc) so two webhook
// deliveries racing at the same instant can never be handed the same number.
export async function nextInvoiceNumber(date = new Date()) {
  const fy = financialYearLabel(date);
  const seq = await nextSequence(`invoice:${INVOICE_PREFIX}:${fy}`);
  return `${INVOICE_PREFIX}-${fy}-${String(seq).padStart(4, "0")}`;
}

// `totalAmountMinorUnits` is the real amount actually charged (paise, tax-inclusive - Razorpay
// charges a fixed amount against a Plan, this codebase never adds tax on top at charge time), so
// the taxable value is back-calculated from it rather than the other way around. CGST+SGST
// (9%+9%) applies when the recipient's state matches the supplier's; IGST (18%) otherwise.
// recipientState empty (client hasn't filled in their GST billing profile yet) defaults to IGST -
// the conservative assumption, since most of this business's clients are inter-state - and is
// flagged via placeOfSupplyAssumed so it can be corrected once the client provides their real
// state, rather than silently treated as equally authoritative as a confirmed split.
export function computeGstSplit({ totalAmountMinorUnits, supplierState, recipientState }) {
  const placeOfSupplyAssumed = !recipientState;
  const sameState = Boolean(recipientState) && recipientState.trim().toLowerCase() === supplierState.trim().toLowerCase();

  const taxableValue = Math.round(totalAmountMinorUnits / (1 + GST_RATE));
  const totalTax = totalAmountMinorUnits - taxableValue;

  if (sameState) {
    const cgstAmount = Math.round(totalTax / 2);
    const sgstAmount = totalTax - cgstAmount; // absorbs the odd paisa, if any - cgst+sgst+taxable must equal the real charged total exactly
    return {
      taxableValue,
      cgstRate: GST_RATE / 2,
      cgstAmount,
      sgstRate: GST_RATE / 2,
      sgstAmount,
      igstRate: 0,
      igstAmount: 0,
      placeOfSupplyAssumed,
    };
  }

  return {
    taxableValue,
    cgstRate: 0,
    cgstAmount: 0,
    sgstRate: 0,
    sgstAmount: 0,
    igstRate: GST_RATE,
    igstAmount: totalTax,
    placeOfSupplyAssumed,
  };
}

// Builds every GST field an Invoice document needs, ready to spread into Invoice.create()/save().
// Shared by billingWebhook.js (recurring subscription.charged) and billing.js's /verify (first
// payment) so both real payment paths produce an identically-structured, correctly-numbered tax
// invoice rather than one route drifting from the other over time.
export async function issueGstInvoiceFields({ organization, totalAmountMinorUnits, issuedAt = new Date() }) {
  const invoiceNumber = await nextInvoiceNumber(issuedAt);
  const split = computeGstSplit({
    totalAmountMinorUnits,
    supplierState: config.gstSupplier.state,
    recipientState: organization.billingState || "",
  });

  return {
    invoiceNumber,
    sacCode: SAC_CODE,
    ...split,
    supplierName: config.gstSupplier.legalName,
    supplierGstin: config.gstSupplier.gstin,
    supplierAddress: config.gstSupplier.address,
    supplierState: config.gstSupplier.state,
    recipientName: organization.billingLegalName || organization.name,
    recipientGstin: organization.billingGstin || "",
    recipientAddress: organization.billingAddress || "",
    recipientState: organization.billingState || "",
  };
}

function formatMoney(minorUnits, currency = "INR") {
  const symbol = currency === "INR" ? "Rs. " : `${currency} `;
  return `${symbol}${(minorUnits / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const PLAN_LABEL = { basic: "Basic", medium: "Medium", pro: "Pro" };

// Pure PDF layout, no I/O beyond the returned buffer - callers (billingWebhook.js for email
// delivery, routes/billing.js for on-demand download) decide what to do with the bytes.
export function generateInvoicePdfBuffer(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#111").text(invoice.supplierName);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(invoice.supplierAddress)
      .text(`GSTIN: ${invoice.supplierGstin}`)
      .text(`State: ${invoice.supplierState}`);

    doc.moveUp(4);
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#111").text("TAX INVOICE", { align: "right" });
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(`Invoice No: ${invoice.invoiceNumber}`, { align: "right" })
      .text(`Invoice Date: ${formatDate(invoice.createdAt)}`, { align: "right" })
      .text(`SAC Code: ${invoice.sacCode}`, { align: "right" });

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(1);

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text("Billed to");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(invoice.recipientName || "-")
      .text(invoice.recipientAddress || "-")
      .text(`GSTIN: ${invoice.recipientGstin || "Unregistered"}`)
      .text(`State: ${invoice.recipientState || "Not provided"}${invoice.placeOfSupplyAssumed ? " (assumed - client has not confirmed their billing state)" : ""}`);

    if (invoice.periodStart && invoice.periodEnd) {
      doc.moveDown(0.5);
      doc.fontSize(9).font("Helvetica").fillColor("#444").text(`Billing period: ${formatDate(invoice.periodStart)} - ${formatDate(invoice.periodEnd)}`);
    }

    doc.moveDown(1.5);

    // Column boxes must stay within the page's content area (50-545, A4 with 50pt margins) - each
    // x+width is kept <= 545 so a right-aligned value never wraps to a second line instead of
    // staying on one, which happened here with the original narrower "Total" column.
    const tableTop = doc.y;
    const col = { desc: 50, taxable: 240, taxLabel: 325, taxAmount: 410, total: 475 };
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#111");
    doc.text("Description", col.desc, tableTop);
    doc.text("Taxable Value", col.taxable, tableTop, { width: 80, align: "right" });
    doc.text("Tax", col.taxLabel, tableTop, { width: 80, align: "right" });
    doc.text("Tax Amt", col.taxAmount, tableTop, { width: 60, align: "right" });
    doc.text("Total", col.total, tableTop, { width: 70, align: "right" });
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor("#ddd").stroke();

    const rowY = tableTop + 22;
    doc.fontSize(9).font("Helvetica").fillColor("#333");
    doc.text(`Dashboard-WhatsApp - ${PLAN_LABEL[invoice.plan] || invoice.plan} plan subscription`, col.desc, rowY, { width: 185 });
    doc.text(formatMoney(invoice.taxableValue, invoice.currency), col.taxable, rowY, { width: 80, align: "right" });

    const totalTax = invoice.cgstAmount + invoice.sgstAmount + invoice.igstAmount;
    const taxLabel = invoice.igstAmount > 0 ? `IGST @ ${Math.round(invoice.igstRate * 100)}%` : `CGST ${Math.round(invoice.cgstRate * 100)}%+SGST ${Math.round(invoice.sgstRate * 100)}%`;
    doc.fontSize(8).text(taxLabel, col.taxLabel, rowY, { width: 80, align: "right" });
    doc.fontSize(9).text(formatMoney(totalTax, invoice.currency), col.taxAmount, rowY, { width: 60, align: "right" });
    doc.text(formatMoney(invoice.amount, invoice.currency), col.total, rowY, { width: 70, align: "right" });

    doc.moveTo(50, rowY + 20).lineTo(545, rowY + 20).strokeColor("#ddd").stroke();

    doc.fontSize(9).font("Helvetica-Bold").fillColor("#111").text("Total (incl. GST)", col.taxable, rowY + 30, { width: 165, align: "right" });
    doc.text(formatMoney(invoice.amount, invoice.currency), col.total, rowY + 30, { width: 70, align: "right" });

    doc.moveDown(4);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#888")
      .text("This is a computer-generated invoice and does not require a signature.", 50, rowY + 80);
    if (invoice.razorpayPaymentId) {
      doc.text(`Payment reference: ${invoice.razorpayPaymentId}`);
    }

    doc.end();
  });
}

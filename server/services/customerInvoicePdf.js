import PDFDocument from "pdfkit";

function formatMoney(minorUnits, currency = "INR") {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${(Number(minorUnits || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_LABEL = {
  draft: "DRAFT",
  sent: "INVOICE",
  partially_paid: "INVOICE (Partially Paid)",
  paid: "INVOICE (Paid)",
  overdue: "INVOICE (Overdue)",
  cancelled: "INVOICE (Cancelled)",
};

// Pure PDF layout, no I/O beyond the returned buffer - same shape as gstInvoice.js's
// generateInvoicePdfBuffer, deliberately simpler (no GST breakdown, see CustomerInvoice.js's own
// comment on why that's out of scope for v1). invoice must already have contactId populated
// (name/phone at minimum) and issuerName/issuerAddress passed in from the caller's Workspace/
// Organization, since this model doesn't snapshot supplier details the way the GST invoice does.
export function generateCustomerInvoicePdfBuffer(invoice, { issuerName, contact }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#111").text(issuerName || "Invoice");

    doc.moveUp(1);
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#111").text(STATUS_LABEL[invoice.status] || "INVOICE", { align: "right" });
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(`Invoice No: ${invoice.invoiceNumber}`, { align: "right" })
      .text(`Invoice Date: ${formatDate(invoice.issuedAt || invoice.createdAt)}`, { align: "right" })
      .text(`Due: ${formatDate(invoice.dueDate)}`, { align: "right" });

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(1);

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text("Billed to");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(contact?.name || contact?.waName || "-")
      .text(contact?.phone || "-")
      .text(contact?.email || "");

    doc.moveDown(1.5);

    const tableTop = doc.y;
    const col = { desc: 50, qty: 320, unit: 380, total: 475 };
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#111");
    doc.text("Description", col.desc, tableTop);
    doc.text("Qty", col.qty, tableTop, { width: 50, align: "right" });
    doc.text("Unit price", col.unit, tableTop, { width: 85, align: "right" });
    doc.text("Amount", col.total, tableTop, { width: 70, align: "right" });
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor("#ddd").stroke();

    let rowY = tableTop + 22;
    doc.fontSize(9).font("Helvetica").fillColor("#333");
    for (const item of invoice.lineItems || []) {
      doc.text(item.description, col.desc, rowY, { width: 260 });
      doc.text(String(item.quantity || 1), col.qty, rowY, { width: 50, align: "right" });
      doc.text(formatMoney(item.unitPrice, invoice.currency), col.unit, rowY, { width: 85, align: "right" });
      doc.text(formatMoney(item.amount, invoice.currency), col.total, rowY, { width: 70, align: "right" });
      rowY += 18;
    }

    doc.moveTo(50, rowY + 4).lineTo(545, rowY + 4).strokeColor("#ddd").stroke();
    let summaryY = rowY + 14;

    doc.fontSize(9).font("Helvetica").fillColor("#444").text("Subtotal", col.unit, summaryY, { width: 85, align: "right" });
    doc.text(formatMoney(invoice.subtotal, invoice.currency), col.total, summaryY, { width: 70, align: "right" });
    summaryY += 16;

    if (invoice.taxAmount > 0) {
      doc.text(invoice.taxLabel || "Tax", col.unit, summaryY, { width: 85, align: "right" });
      doc.text(formatMoney(invoice.taxAmount, invoice.currency), col.total, summaryY, { width: 70, align: "right" });
      summaryY += 16;
    }

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text("Total", col.unit, summaryY, { width: 85, align: "right" });
    doc.text(formatMoney(invoice.total, invoice.currency), col.total, summaryY, { width: 70, align: "right" });
    summaryY += 18;

    if (invoice.amountPaid > 0) {
      doc.fontSize(9).font("Helvetica").fillColor("#1a7a3c").text("Paid", col.unit, summaryY, { width: 85, align: "right" });
      doc.text(formatMoney(invoice.amountPaid, invoice.currency), col.total, summaryY, { width: 70, align: "right" });
      summaryY += 16;
      const balance = Math.max(0, invoice.total - invoice.amountPaid);
      doc.font("Helvetica-Bold").fillColor("#111").text("Balance due", col.unit, summaryY, { width: 85, align: "right" });
      doc.text(formatMoney(balance, invoice.currency), col.total, summaryY, { width: 70, align: "right" });
    }

    if (invoice.notes) {
      doc.moveDown(3);
      doc.fontSize(9).font("Helvetica").fillColor("#444").text(invoice.notes, 50, doc.y, { width: 495 });
    }

    doc.end();
  });
}

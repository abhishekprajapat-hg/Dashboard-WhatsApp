import PDFDocument from "pdfkit";

function formatDate(date) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Pure PDF layout, no I/O - same shape/library as customerInvoicePdf.js, deliberately simpler: a
// delivery challan lists what's being shipped, not pricing (that's the invoice's job).
export function generateDeliveryChallanPdfBuffer(shipment, { issuerName, contact }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#111").text(issuerName || "Delivery Challan");

    doc.moveUp(1);
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#111").text("DELIVERY CHALLAN", { align: "right" });
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(`Challan No: ${shipment.shipmentNumber}`, { align: "right" })
      .text(`Date: ${formatDate(shipment.createdAt)}`, { align: "right" });

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(1);

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text("Ship to");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(contact?.name || contact?.waName || "-")
      .text(contact?.phone || "-")
      .text(shipment.shippingAddress || "-");

    if (shipment.carrier || shipment.trackingReference) {
      doc.moveDown(0.5);
      doc
        .fontSize(9)
        .text(`Carrier: ${shipment.carrier || "-"}`)
        .text(`Tracking reference: ${shipment.trackingReference || "-"}`);
    }

    doc.moveDown(1.5);

    const tableTop = doc.y;
    const col = { desc: 50, qty: 460 };
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#111");
    doc.text("Description", col.desc, tableTop);
    doc.text("Qty", col.qty, tableTop, { width: 85, align: "right" });
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor("#ddd").stroke();

    let rowY = tableTop + 22;
    doc.fontSize(9).font("Helvetica").fillColor("#333");
    for (const item of shipment.items || []) {
      doc.text(item.description, col.desc, rowY, { width: 380 });
      doc.text(String(item.quantity || 1), col.qty, rowY, { width: 85, align: "right" });
      rowY += 18;
    }

    doc.moveDown(3);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text("This challan is issued for goods movement purposes and does not represent a tax invoice.", 50, doc.y, { width: 495 });

    doc.end();
  });
}

import PDFDocument from "pdfkit";

function formatDate(date) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// A generated document (v1: proposals only) is free-form prose, not a line-item table like the
// invoice/challan PDFs - simple letterhead + body paragraphs is the right shape here.
export function generateBusinessDocumentPdfBuffer(document, { issuerName, contact }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).font("Helvetica-Bold").fillColor("#111").text(issuerName || "");
    doc.fontSize(9).font("Helvetica").fillColor("#888").text(formatDate(document.createdAt));

    doc.moveDown(1.5);
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#111").text(document.title);

    if (contact?.name) {
      doc.moveDown(0.5);
      doc.fontSize(9).font("Helvetica").fillColor("#444").text(`Prepared for: ${contact.name}${contact.phone ? ` (${contact.phone})` : ""}`);
    }

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(1.5);

    doc.fontSize(10).font("Helvetica").fillColor("#222").text(document.content, { align: "left", lineGap: 4 });

    doc.end();
  });
}

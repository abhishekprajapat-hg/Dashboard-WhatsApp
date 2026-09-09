import test from "node:test";
import assert from "node:assert/strict";
import { financialYearLabel, computeGstSplit } from "../services/gstInvoice.js";

test("financialYearLabel follows India's April-March GST financial year", () => {
  assert.equal(financialYearLabel(new Date("2026-09-10")), "2026-27");
  assert.equal(financialYearLabel(new Date("2026-03-31")), "2025-26");
  assert.equal(financialYearLabel(new Date("2026-04-01")), "2026-27");
  assert.equal(financialYearLabel(new Date("2027-01-15")), "2026-27");
});

test("computeGstSplit: same-state charges CGST+SGST (9%+9%) and the split sums back to the exact charged total", () => {
  const split = computeGstSplit({ totalAmountMinorUnits: 99900, supplierState: "Madhya Pradesh", recipientState: "Madhya Pradesh" });
  assert.equal(split.igstAmount, 0);
  assert.equal(split.cgstRate, 0.09);
  assert.equal(split.sgstRate, 0.09);
  assert.equal(split.taxableValue + split.cgstAmount + split.sgstAmount, 99900);
  assert.equal(split.placeOfSupplyAssumed, false);
});

test("computeGstSplit: different-state charges IGST (18%) and the split sums back to the exact charged total", () => {
  const split = computeGstSplit({ totalAmountMinorUnits: 299900, supplierState: "Madhya Pradesh", recipientState: "Maharashtra" });
  assert.equal(split.cgstAmount, 0);
  assert.equal(split.sgstAmount, 0);
  assert.equal(split.igstRate, 0.18);
  assert.equal(split.taxableValue + split.igstAmount, 299900);
  assert.equal(split.placeOfSupplyAssumed, false);
});

test("computeGstSplit: state comparison is case-insensitive", () => {
  const split = computeGstSplit({ totalAmountMinorUnits: 99900, supplierState: "Madhya Pradesh", recipientState: "madhya pradesh" });
  assert.equal(split.igstAmount, 0);
  assert.ok(split.cgstAmount > 0);
});

// A client who hasn't filled in their billing state yet must not silently get a confidently-wrong
// CGST/SGST split - IGST is the conservative default, and it's flagged so it can be corrected.
test("computeGstSplit: unknown recipient state defaults to IGST and sets placeOfSupplyAssumed", () => {
  const split = computeGstSplit({ totalAmountMinorUnits: 799900, supplierState: "Madhya Pradesh", recipientState: "" });
  assert.equal(split.cgstAmount, 0);
  assert.equal(split.sgstAmount, 0);
  assert.ok(split.igstAmount > 0);
  assert.equal(split.taxableValue + split.igstAmount, 799900);
  assert.equal(split.placeOfSupplyAssumed, true);
});

test("computeGstSplit: odd-paisa tax never gets lost or double-counted between CGST and SGST", () => {
  // A total chosen so the tax amount is odd, forcing a 1-paisa rounding decision between the two halves.
  const split = computeGstSplit({ totalAmountMinorUnits: 100001, supplierState: "Madhya Pradesh", recipientState: "Madhya Pradesh" });
  assert.equal(split.taxableValue + split.cgstAmount + split.sgstAmount, 100001);
});

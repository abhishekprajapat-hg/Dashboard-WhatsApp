import test from "node:test";
import assert from "node:assert/strict";
import { isOptOutMessage } from "../routes/whatsapp.js";

test("recognizes standard opt-out keywords, case-insensitively and with trailing punctuation", () => {
  for (const word of ["STOP", "stop", "Stop.", "UNSUBSCRIBE", "unsubscribe!", "CANCEL", "Opt Out", "OPTOUT", "end", "QUIT?"]) {
    assert.equal(isOptOutMessage(word), true, `expected "${word}" to be recognized as an opt-out`);
  }
});

test("does not false-positive on real sentences that merely contain a keyword", () => {
  for (const sentence of [
    "can I cancel my order?",
    "please stop sending me the wrong invoice",
    "I want to unsubscribe from the newsletter but keep support messages",
    "quit playing games with my heart",
  ]) {
    assert.equal(isOptOutMessage(sentence), false, `expected "${sentence}" to NOT be treated as an opt-out`);
  }
});

test("does not match an empty or whitespace-only body", () => {
  assert.equal(isOptOutMessage(""), false);
  assert.equal(isOptOutMessage("   "), false);
});

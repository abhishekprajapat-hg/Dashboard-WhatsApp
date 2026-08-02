import test from "node:test";
import assert from "node:assert/strict";
import { buildEmailRequest, buildSmsRequest, sendEmail, sendSms } from "../services/notificationChannels.js";

// Same approach as aiProviders.unit.test.js: pure request builders tested directly, and the
// actual fetch exercised with a stubbed globalThis.fetch - no network access or live credentials.

test("buildEmailRequest matches SendGrid's v3/mail/send shape, with and without a from name", () => {
  const withName = buildEmailRequest({ apiKey: "SG.test", fromAddress: "hi@example.com", fromName: "WhatsCRM", to: "lead@example.com", subject: "Hi", body: "Body text" });
  assert.equal(withName.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(withName.headers.Authorization, "Bearer SG.test");
  assert.deepEqual(withName.body.personalizations, [{ to: [{ email: "lead@example.com" }] }]);
  assert.deepEqual(withName.body.from, { email: "hi@example.com", name: "WhatsCRM" });
  assert.equal(withName.body.subject, "Hi");
  assert.equal(withName.body.content[0].value, "Body text");

  const withoutName = buildEmailRequest({ apiKey: "SG.test", fromAddress: "hi@example.com", fromName: "", to: "lead@example.com", subject: "Hi", body: "Body text" });
  assert.deepEqual(withoutName.body.from, { email: "hi@example.com" });
});

test("buildSmsRequest matches Twilio's Messages.json shape used for the WhatsApp channel, minus the whatsapp: prefix", () => {
  const { url, headers, formBody } = buildSmsRequest({ accountSid: "ACtest", authToken: "tokentest", fromNumber: "+15550001111", to: "+15550002222", body: "Hi there" });
  assert.equal(url, "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
  assert.equal(headers.Authorization, `Basic ${Buffer.from("ACtest:tokentest").toString("base64")}`);
  assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(formBody.get("From"), "+15550001111");
  assert.equal(formBody.get("To"), "+15550002222");
  assert.equal(formBody.get("Body"), "Hi there");
  // Unlike the WhatsApp channel, plain SMS must NOT prefix numbers with "whatsapp:".
  assert.ok(!formBody.get("From").includes("whatsapp:"));
});

test("sendEmail sends the built request and returns sent status on a 2xx response", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  // Response.headers is a real Headers-like object with .get() - a plain object satisfies that
  // shape here without needing a real Response/Headers instance.
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 202, headers: { get: (key) => (key === "x-message-id" ? "msg_123" : null) } };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await sendEmail({ apiKey: "SG.test", fromAddress: "hi@example.com", to: "lead@example.com", subject: "Hi", body: "Body" });
  assert.equal(result.status, "sent");
  assert.equal(result.messageId, "msg_123");
  assert.equal(calls[0].url, "https://api.sendgrid.com/v3/mail/send");
});

test("sendEmail throws SendGrid's error message on a non-2xx response", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ errors: [{ message: "The provided authorization grant is invalid" }] }) });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => sendEmail({ apiKey: "bad", fromAddress: "hi@example.com", to: "lead@example.com", subject: "Hi", body: "Body" }),
    /invalid/
  );
});

test("sendEmail rejects locally before any request when required fields are missing", async () => {
  await assert.rejects(() => sendEmail({ apiKey: "", fromAddress: "hi@example.com", to: "lead@example.com", subject: "Hi", body: "Body" }), /API key/);
  await assert.rejects(() => sendEmail({ apiKey: "sk", fromAddress: "", to: "lead@example.com", subject: "Hi", body: "Body" }), /from/);
  await assert.rejects(() => sendEmail({ apiKey: "sk", fromAddress: "hi@example.com", to: "", subject: "Hi", body: "Body" }), /recipient/);
});

test("sendSms sends the built request and returns the Twilio message sid", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 201, json: async () => ({ sid: "SMtest123" }) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await sendSms({ accountSid: "ACtest", authToken: "tokentest", fromNumber: "+15550001111", to: "+15550002222", body: "Hi there" });
  assert.equal(result.status, "sent");
  assert.equal(result.messageId, "SMtest123");
  assert.ok(calls[0].options.body instanceof URLSearchParams);
});

test("sendSms throws Twilio's error message on a non-2xx response", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ message: "The 'To' number is not a valid phone number." }) });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => sendSms({ accountSid: "ACtest", authToken: "tokentest", fromNumber: "+15550001111", to: "not-a-number", body: "Hi" }),
    /valid phone number/
  );
});

test("sendSms rejects locally before any request when required fields are missing", async () => {
  await assert.rejects(() => sendSms({ accountSid: "", authToken: "", fromNumber: "+1", to: "+1", body: "Hi" }), /Account SID/);
  await assert.rejects(() => sendSms({ accountSid: "AC", authToken: "tok", fromNumber: "", to: "+1", body: "Hi" }), /from/);
  await assert.rejects(() => sendSms({ accountSid: "AC", authToken: "tok", fromNumber: "+1", to: "", body: "Hi" }), /recipient/);
});

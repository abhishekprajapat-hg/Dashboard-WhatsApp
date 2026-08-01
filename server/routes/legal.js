import { Router } from "express";

export const legalRouter = Router();

const BUSINESS = {
  name: "Nemnidhi",
  product: "WhatsCRM (Dashboard-WhatsApp)",
  address: "B20 - 5th Floor, Gravity Mall, Mechanic Nagar, Indore, India",
  supportEmail: "support@nemnidhi.com",
  phone: "+91 7000445463",
};

function updatedDate() {
  return new Date().toISOString().slice(0, 10);
}

function page({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — ${BUSINESS.product}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    color: #1a1a1a;
    background: #fafafa;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e7eb; background: #0b0f0d; }
    a { color: #4ade80; }
    .card { background: #111815 !important; border-color: #1f2b25 !important; }
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; }
  .brand .mark { width: 32px; height: 32px; border-radius: 8px; background: #22c55e; display: flex; align-items: center; justify-content: center; }
  .brand .mark svg { width: 18px; height: 18px; }
  .brand span { font-weight: 600; font-size: 15px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { font-size: 13px; opacity: 0.65; margin-bottom: 28px; }
  h2 { font-size: 15px; margin: 28px 0 8px; }
  p, li { font-size: 14px; opacity: 0.9; }
  a { color: #16a34a; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <span class="mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M18 17h28a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H32l-11 8v-8h-3a7 7 0 0 1-7-7V24a7 7 0 0 1 7-7z" fill="#fff"/><path d="M22 29h20M22 37h14" stroke="#16a34a" stroke-width="5" stroke-linecap="round"/></svg></span>
      <span>${BUSINESS.product}</span>
    </div>
    <div class="card">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}

legalRouter.get("/terms-of-service", (_req, res) => {
  res.type("html").send(page({
    title: "Terms of Service",
    bodyHtml: `
      <h1>Terms of Service</h1>
      <div class="meta">Last updated ${updatedDate()} &middot; ${BUSINESS.name}</div>

      <p>These Terms of Service ("Terms") govern access to and use of ${BUSINESS.product} (the "Service"), operated by ${BUSINESS.name} ("we", "us"). By creating a workspace or otherwise using the Service, you agree to these Terms.</p>

      <h2>1. The Service</h2>
      <p>${BUSINESS.product} is a business dashboard that connects to the WhatsApp Business Platform to help a workspace manage conversations, contacts, campaigns, templates, and automations. Use of WhatsApp messaging features through the Service is also subject to Meta's <a href="https://www.whatsapp.com/legal/business-terms" rel="noopener">WhatsApp Business Terms</a> and <a href="https://developers.facebook.com/terms" rel="noopener">Meta Platform Terms</a>.</p>

      <h2>2. Accounts and Workspaces</h2>
      <p>You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account and workspace. Administrators are responsible for the access levels they grant to team members.</p>

      <h2>3. Acceptable Use</h2>
      <p>You agree not to use the Service to send unsolicited, deceptive, or non-compliant messages, to violate WhatsApp's commerce and messaging policies, to store data you do not have a lawful basis to process, or to attempt to interfere with the Service's security or availability.</p>

      <h2>4. Customer Data</h2>
      <p>Data you submit or that is collected through connected WhatsApp Business accounts (such as contact details and message content) remains yours. We process it only to provide the Service, as described in our data handling practices. See the <a href="/legal/data-deletion">Data Deletion Instructions</a> for how to request removal.</p>

      <h2>5. Third-Party Platforms</h2>
      <p>The Service integrates with the WhatsApp Business Platform and, optionally, third-party services you configure (such as webhook endpoints or Google Sheets). We are not responsible for the availability or behavior of those third-party platforms.</p>

      <h2>6. Termination</h2>
      <p>Either party may stop using or providing the Service at any time. We may suspend access for activity that violates these Terms or WhatsApp's platform policies.</p>

      <h2>7. Disclaimer and Liability</h2>
      <p>The Service is provided "as is" without warranties of any kind. To the extent permitted by law, ${BUSINESS.name} is not liable for indirect, incidental, or consequential damages arising from use of the Service.</p>

      <h2>8. Changes</h2>
      <p>We may update these Terms from time to time. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.</p>

      <h2>9. Contact</h2>
      <p>${BUSINESS.name}<br/>${BUSINESS.address}<br/>Email: <a href="mailto:${BUSINESS.supportEmail}">${BUSINESS.supportEmail}</a><br/>Phone: ${BUSINESS.phone}</p>
    `,
  }));
});

legalRouter.get("/data-deletion", (_req, res) => {
  res.type("html").send(page({
    title: "Data Deletion Instructions",
    bodyHtml: `
      <h1>Data Deletion Instructions</h1>
      <div class="meta">Last updated ${updatedDate()} &middot; ${BUSINESS.name}</div>

      <p>${BUSINESS.product} stores data such as contact details, conversation history, and campaign records on behalf of the workspaces that use it, including data received through connected WhatsApp Business accounts.</p>

      <h2>Workspace administrators</h2>
      <p>Administrators can delete an individual contact and their associated conversation history directly from the <strong>CRM</strong> view inside the dashboard. Deleting a contact removes their stored profile data from that workspace.</p>

      <h2>Requesting deletion from us directly</h2>
      <p>Any workspace user, WhatsApp contact, or other individual whose data is stored in the Service can request deletion by emailing <a href="mailto:${BUSINESS.supportEmail}">${BUSINESS.supportEmail}</a> with:</p>
      <ul>
        <li>The workspace name or WhatsApp Business phone number involved</li>
        <li>The phone number, name, or other identifier of the data to be deleted</li>
      </ul>
      <p>We will confirm the request and complete deletion from our production database within 30 days, except where we are required to retain data for a longer period by law.</p>

      <h2>Disconnecting a WhatsApp Business account</h2>
      <p>Removing a WhatsApp Business account connection from <strong>Settings &rarr; WhatsApp</strong> stops the Service from receiving further data from that number. It does not itself delete previously stored conversation history &mdash; use the contact-level deletion above, or contact us, to remove that.</p>

      <h2>Contact</h2>
      <p>${BUSINESS.name}<br/>${BUSINESS.address}<br/>Email: <a href="mailto:${BUSINESS.supportEmail}">${BUSINESS.supportEmail}</a><br/>Phone: ${BUSINESS.phone}</p>
    `,
  }));
});

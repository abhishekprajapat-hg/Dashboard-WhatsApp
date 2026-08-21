import { config } from "../config.js";
import { decodeCredentials } from "./whatsappProvider.js";

async function graphRequest(path, { method = "GET", accessToken, body, isForm = false } = {}) {
  const url = `https://graph.facebook.com/${config.metaGraphApiVersion}/${path}`;
  const init = { method, headers: {} };

  if (isForm) {
    init.body = body;
  } else if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${separator}access_token=${encodeURIComponent(accessToken)}`, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || "WhatsApp Flows API request failed.");
    error.status = response.status || 502;
    error.code = payload.error?.code || "WHATSAPP_FLOW_REQUEST_FAILED";
    error.meta = payload;
    throw error;
  }

  return payload;
}

// Static flows only (v1 scope) - every screen terminates with a "complete" action, so no
// encrypted data-exchange endpoint is needed. Dynamic (data_exchange) flows are a deliberate
// follow-up, not built here - see HANDOFF.md for the reasoning.
export const FLOW_TEMPLATES = {
  lead_capture: {
    label: "Lead Capture",
    categories: ["LEAD_GENERATION"],
    buildFlowJson: () => ({
      version: "6.2",
      screens: [
        {
          id: "LEAD_CAPTURE",
          title: "Get in touch",
          terminal: true,
          success: true,
          data: {},
          layout: {
            type: "SingleColumnLayout",
            children: [
              {
                type: "Form",
                name: "lead_form",
                children: [
                  { type: "TextInput", name: "full_name", label: "Full name", "input-type": "text", required: true },
                  { type: "TextInput", name: "phone", label: "Phone number", "input-type": "phone", required: true },
                  { type: "TextInput", name: "email", label: "Email", "input-type": "email", required: false },
                  { type: "TextArea", name: "interest", label: "What are you interested in?", required: false },
                  {
                    type: "Footer",
                    label: "Submit",
                    "on-click-action": {
                      name: "complete",
                      payload: {
                        full_name: "${form.full_name}",
                        phone: "${form.phone}",
                        email: "${form.email}",
                        interest: "${form.interest}",
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    }),
  },
  appointment_request: {
    label: "Appointment Request",
    categories: ["APPOINTMENT_BOOKING"],
    buildFlowJson: () => ({
      version: "6.2",
      screens: [
        {
          id: "APPOINTMENT_REQUEST",
          title: "Request an appointment",
          terminal: true,
          success: true,
          data: {},
          layout: {
            type: "SingleColumnLayout",
            children: [
              {
                type: "Form",
                name: "appointment_form",
                children: [
                  { type: "TextInput", name: "full_name", label: "Full name", "input-type": "text", required: true },
                  { type: "TextInput", name: "phone", label: "Phone number", "input-type": "phone", required: true },
                  { type: "DatePicker", name: "preferred_date", label: "Preferred date", required: true },
                  {
                    type: "Dropdown",
                    name: "preferred_time",
                    label: "Preferred time",
                    required: true,
                    "data-source": [
                      { id: "morning", title: "Morning (9am - 12pm)" },
                      { id: "afternoon", title: "Afternoon (12pm - 4pm)" },
                      { id: "evening", title: "Evening (4pm - 7pm)" },
                    ],
                  },
                  { type: "TextArea", name: "notes", label: "Anything we should know?", required: false },
                  {
                    type: "Footer",
                    label: "Request appointment",
                    "on-click-action": {
                      name: "complete",
                      payload: {
                        full_name: "${form.full_name}",
                        phone: "${form.phone}",
                        preferred_date: "${form.preferred_date}",
                        preferred_time: "${form.preferred_time}",
                        notes: "${form.notes}",
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    }),
  },
};

export async function createFlow({ account, template, name }) {
  const definition = FLOW_TEMPLATES[template];
  if (!definition) {
    const error = new Error(`Unknown flow template "${template}".`);
    error.code = "UNKNOWN_FLOW_TEMPLATE";
    throw error;
  }

  const credentials = decodeCredentials(account);
  const flowJson = definition.buildFlowJson();

  const created = await graphRequest(`${account.businessAccountId}/flows`, {
    method: "POST",
    accessToken: credentials.accessToken,
    body: {
      name,
      categories: definition.categories,
      flow_json: JSON.stringify(flowJson),
    },
  });

  return { metaFlowId: created.id, flowJson, categories: definition.categories };
}

export async function publishFlow({ account, metaFlowId }) {
  const credentials = decodeCredentials(account);
  await graphRequest(`${metaFlowId}/publish`, { method: "POST", accessToken: credentials.accessToken });
}

export async function deleteFlow({ account, metaFlowId }) {
  const credentials = decodeCredentials(account);
  await graphRequest(metaFlowId, { method: "DELETE", accessToken: credentials.accessToken });
}

export async function sendFlowMessage({ account, flow, to, screenId, headerText, bodyText, ctaLabel }) {
  const credentials = decodeCredentials(account);
  const flowToken = `flow_${flow._id}_${Date.now()}`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      ...(headerText ? { header: { type: "text", text: headerText } } : {}),
      body: { text: bodyText || `Please fill out ${flow.name}.` },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flow.metaFlowId,
          flow_cta: (ctaLabel || "Open").slice(0, 20),
          flow_action: "navigate",
          flow_action_payload: { screen: screenId },
        },
      },
    },
  };

  const response = await fetch(`https://graph.facebook.com/${config.metaGraphApiVersion}/${account.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responsePayload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(responsePayload?.error?.message || "WhatsApp Flow send failed.");
    error.meta = responsePayload;
    error.code = responsePayload?.error?.code || "WHATSAPP_FLOW_SEND_FAILED";
    error.status = response.status;
    throw error;
  }

  return {
    providerMessageId: responsePayload?.messages?.[0]?.id || `meta_flow_${Date.now()}`,
    flowToken,
  };
}

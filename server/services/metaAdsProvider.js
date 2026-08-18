import { config } from "../config.js";
import { decodeCredentials, encodeCredentials } from "./whatsappProvider.js";

function isLocalCredential(credentials = {}) {
  return !credentials.accessToken || credentials.accessToken === "local-placeholder-token";
}

export function decodeAdsCredentials(account) {
  return decodeCredentials(account);
}

export function encodeAdsCredentials(credentials = {}) {
  return encodeCredentials(credentials);
}

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
    const error = new Error(payload.error?.message || "Meta Marketing API request failed.");
    error.status = response.status || 502;
    error.code = payload.error?.code || "META_ADS_REQUEST_FAILED";
    error.meta = payload;
    throw error;
  }

  return payload;
}

export async function testMetaAdsConnection(account) {
  if (!account) {
    const error = new Error("Meta Ads account not found.");
    error.code = "ACCOUNT_NOT_FOUND";
    throw error;
  }

  const credentials = decodeAdsCredentials(account);
  if (isLocalCredential(credentials)) {
    return { ok: true, mode: "local", message: "Local placeholder credentials are valid for development testing." };
  }

  const details = await graphRequest(`${account.adAccountId}?fields=name,currency,account_status`, {
    accessToken: credentials.accessToken,
  });

  return {
    ok: true,
    mode: "meta",
    message: `Meta Ads account "${details.name}" is reachable (currency ${details.currency}).`,
  };
}

export async function uploadAdImage(account, imageBuffer, filename = "creative.jpg") {
  const credentials = decodeAdsCredentials(account);
  const form = new FormData();
  form.append("bytes", imageBuffer.toString("base64"));

  const payload = await graphRequest(`${account.adAccountId}/adimages`, {
    method: "POST",
    accessToken: credentials.accessToken,
    body: form,
    isForm: true,
  });

  const images = payload.images || {};
  const firstKey = Object.keys(images)[0];
  const imageHash = firstKey ? images[firstKey].hash : null;

  if (!imageHash) {
    const error = new Error("Meta did not return an image hash for the uploaded creative.");
    error.code = "META_ADS_IMAGE_UPLOAD_FAILED";
    error.meta = payload;
    throw error;
  }

  return imageHash;
}

export async function createClickToWhatsAppCampaign(account, { name, dailyBudgetMinorUnits, message, imageHash }) {
  const credentials = decodeAdsCredentials(account);
  const accessToken = credentials.accessToken;
  const pageId = account.pageId;
  const whatsappPhoneNumber = account.whatsappPhoneNumber || undefined;

  const campaign = await graphRequest(`${account.adAccountId}/campaigns`, {
    method: "POST",
    accessToken,
    body: {
      name,
      objective: "OUTCOME_ENGAGEMENT",
      status: "PAUSED",
      special_ad_categories: [],
    },
  });

  const adSet = await graphRequest(`${account.adAccountId}/adsets`, {
    method: "POST",
    accessToken,
    body: {
      name: `${name} - Ad Set`,
      campaign_id: campaign.id,
      optimization_goal: "CONVERSATIONS",
      destination_type: "WHATSAPP",
      billing_event: "IMPRESSIONS",
      daily_budget: dailyBudgetMinorUnits,
      status: "PAUSED",
      promoted_object: {
        page_id: pageId,
        ...(whatsappPhoneNumber ? { whatsapp_phone_number: whatsappPhoneNumber } : {}),
      },
      targeting: {
        geo_locations: { countries: ["IN"] },
        age_min: 18,
        age_max: 65,
      },
    },
  });

  const ad = await graphRequest(`${account.adAccountId}/ads`, {
    method: "POST",
    accessToken,
    body: {
      name: `${name} - Ad`,
      adset_id: adSet.id,
      status: "PAUSED",
      creative: {
        object_story_spec: {
          page_id: pageId,
          link_data: {
            message,
            image_hash: imageHash,
            link: "https://api.whatsapp.com/send",
            call_to_action: {
              type: "WHATSAPP_MESSAGE",
              value: { app_destination: "WHATSAPP" },
            },
          },
        },
      },
    },
  });

  return {
    metaCampaignId: campaign.id,
    metaAdSetId: adSet.id,
    metaAdId: ad.id,
  };
}

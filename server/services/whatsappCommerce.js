import { config } from "../config.js";
import { decodeCredentials } from "./whatsappProvider.js";

// Single Product messages only (v1 scope) - Multi-Product List and full Catalog-browse messages
// are deliberate follow-ups, not built here. Meta-only (no Twilio/Wati support for catalog
// messages), matching whatsappFlows.js's sendFlowMessage precedent - direct fetch, no
// multi-provider branching, no local-credential shortcut (catalog sends need a real, connected
// catalog to mean anything, so there's no meaningful "local" mode for this one).
export async function sendWhatsAppProductMessage({ account, to, catalogId, productRetailerId, bodyText, footerText }) {
  const credentials = decodeCredentials(account);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "product",
      ...(bodyText ? { body: { text: bodyText } } : {}),
      ...(footerText ? { footer: { text: footerText } } : {}),
      action: { catalog_id: catalogId, product_retailer_id: productRetailerId },
    },
  };

  const response = await fetch(`https://graph.facebook.com/${config.metaGraphApiVersion}/${account.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responsePayload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(responsePayload?.error?.message || "WhatsApp product message send failed.");
    error.meta = responsePayload;
    error.code = responsePayload?.error?.code || "WHATSAPP_PRODUCT_SEND_FAILED";
    error.status = response.status;
    throw error;
  }

  return { providerMessageId: responsePayload?.messages?.[0]?.id || `meta_product_${Date.now()}`, status: "sent" };
}

// retailer_id/name/image_url/price/availability - the standard Product Catalog "products" edge
// fields, confirmed live against a real catalog (2026-08-23). This edge needs the `catalog_management`
// permission - a genuinely different scope from `whatsapp_business_messaging`/`whatsapp_business_management`
// (confirmed live: the main WhatsApp access token got a real "(#100) not been approved" error here
// until a separate token was generated for the app's "Manage products with Catalog API" use case).
// credentials.catalogAccessToken is that separate token; falls back to the main accessToken only for
// a setup where a single token happens to carry both scopes.
//
// The products edge takes a JSON-encoded `filter` param (Marketing API's general list-filter syntax),
// not a plain `q` string - confirmed the param name via docs, but the exact operator shape
// (`i_contains`) is NOT yet verified against a real catalog (the live test that confirmed this whole
// endpoint works used no search term). If search behaves oddly, this is the first place to check.
export async function fetchCatalogProducts({ account, catalogId, search = "" }) {
  const credentials = decodeCredentials(account);
  const url = new URL(`https://graph.facebook.com/${config.metaGraphApiVersion}/${catalogId}/products`);
  url.searchParams.set("fields", "retailer_id,name,image_url,price,availability");
  if (search) url.searchParams.set("filter", JSON.stringify({ name: { i_contains: search } }));

  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${credentials.catalogAccessToken || credentials.accessToken}` } });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Could not fetch catalog products.");
    error.meta = payload;
    error.code = payload?.error?.code || "WHATSAPP_CATALOG_FETCH_FAILED";
    error.status = response.status;
    throw error;
  }

  return payload.data || [];
}

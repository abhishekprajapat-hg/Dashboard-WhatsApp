import { AlertTriangle, ExternalLink } from "lucide-react";

// Meta requires the client to add their own payment method directly inside Meta Business Manager -
// as a Tech Provider (not a Solution Partner with a shared credit line), there is no Graph API to
// attach one on their behalf. This only ever reads and displays status; "Add payment method" hands
// the client off to Meta's own real billing hub rather than attempting anything in-app.
const META_BILLING_HUB_URL = "https://business.facebook.com/billing_hub/payment_settings";

interface BillingStatusBannerProps {
  hasPaymentMethod: boolean;
  reasonText?: string;
}

export function BillingStatusBanner({ hasPaymentMethod, reasonText }: BillingStatusBannerProps) {
  if (hasPaymentMethod) return null;

  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">No payment method on file with Meta</p>
        <p className="mt-0.5 text-warning/80">
          {reasonText || "Meta requires a payment method for this account or delivery will be blocked."} Add one directly in Meta
          Business Manager - Nemnidhi can't add this on your behalf.
        </p>
        <a
          href={META_BILLING_HUB_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 font-medium text-warning underline decoration-warning/40 underline-offset-2 hover:decoration-warning"
        >
          Add payment method on Meta
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

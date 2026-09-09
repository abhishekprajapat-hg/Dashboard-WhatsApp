import { AlertCircle, AlertTriangle, ExternalLink } from "lucide-react";

// Meta requires the client to manage payment methods and account-health issues directly inside
// Meta Business Manager - as a Tech Provider (not a Solution Partner with a shared credit line),
// there is no Graph API to fix these on their behalf. This only ever reads and displays status;
// the link hands the client off to Meta's own real hub rather than attempting anything in-app.
const META_BILLING_HUB_URL = "https://business.facebook.com/billing_hub/payment_settings";

interface BillingStatusBannerProps {
  // "issue" - Meta confirmed a real, actionable problem (missing ad-account payment method,
  // WhatsApp delivery blocked/limited, etc).
  // "unknown" - the check itself failed (e.g. reading a WABA's `primary_funding_id` requires
  // Business Solution Provider status, which a Tech Provider token can never have - confirmed live
  // against a real account, a partnership-tier gate no token scope can unlock). Deliberately
  // rendered differently from "issue" - a failed check is not evidence of a real problem, and
  // showing the same alarming banner for both would train admins to ignore it, or worse, chase a
  // problem that doesn't exist.
  status: "issue" | "unknown";
  title?: string;
  detailText?: string;
}

export function BillingStatusBanner({ status, title, detailText }: BillingStatusBannerProps) {
  if (status === "unknown") {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title || "Could not verify billing status"}</p>
          <p className="mt-0.5">{detailText || "This isn't evidence of a real problem - Meta's check itself failed."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title || "No payment method on file with Meta"}</p>
        <p className="mt-0.5 text-warning/80">
          {detailText || "Meta requires a payment method for this account or delivery will be blocked."} Manage this directly in
          Meta Business Manager - Nemnidhi can't fix this on your behalf.
        </p>
        <a
          href={META_BILLING_HUB_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 font-medium text-warning underline decoration-warning/40 underline-offset-2 hover:decoration-warning"
        >
          Open Meta Business Manager
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { AlertTriangle, CalendarClock, CreditCard, ReceiptText } from "lucide-react";
import { cancelBillingSubscription, getBilling, subscribeBillingPlan, verifyBillingPayment } from "../lib/api";

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

interface PlanPrice {
  amount: number;
  currency: string;
  label: string;
}

interface Invoice {
  id: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  periodStart: string | null;
  periodEnd: string | null;
}

interface BillingGate {
  locked: boolean;
  reason?: string;
}

interface BillingState {
  plan: string;
  billingStatus: string;
  razorpaySubscriptionId: string;
  razorpayKeyId: string;
  configured: boolean;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  gate: BillingGate;
  prices: Record<string, PlanPrice>;
  invoices: Invoice[];
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const GATE_REASON_LABEL: Record<string, string> = {
  trial_expired: "Your 7-day trial has ended.",
  payment_failed: "Your last payment failed and Meta's automatic retries are exhausted.",
  subscription_cancelled: "Your subscription has ended.",
};

const PLAN_ORDER = ["basic", "medium", "pro"];
const PLAN_LABELS: Record<string, string> = { basic: "Basic", medium: "Medium", pro: "Pro" };

function statusVariant(status: string): "default" | "outline" | "destructive" | "warning" {
  if (status === "active") return "default";
  if (status === "halted" || status === "cancelled") return "destructive";
  if (status === "pending" || status === "cancelling") return "warning";
  return "outline";
}

function formatAmount(amountInPaise: number, currency: string) {
  return `${currency === "INR" ? "₹" : currency + " "}${(amountInPaise / 100).toLocaleString("en-IN")}`;
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the Razorpay checkout script."));
    document.body.appendChild(script);
  });
}

export function BillingSettingsPanel() {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [subscribingPlan, setSubscribingPlan] = useState("");
  const [cancelling, setCancelling] = useState(false);

  async function loadBilling() {
    setLoading(true);
    try {
      const response = await getBilling<BillingState>();
      setBilling(response);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load billing information.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBilling().catch(() => undefined);
  }, []);

  async function handleSubscribe(planKey: string) {
    setSubscribingPlan(planKey);
    setNotice("");
    try {
      const response = await subscribeBillingPlan<{ subscriptionId: string; keyId: string }>(planKey);
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay checkout is unavailable.");

      const checkout = new window.Razorpay({
        key: response.keyId,
        subscription_id: response.subscriptionId,
        name: "Nemnidhi",
        description: `${PLAN_LABELS[planKey] || planKey} plan subscription`,
        theme: { color: "#22c55e" },
        handler: async (result: { razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await verifyBillingPayment({
              razorpay_payment_id: result.razorpay_payment_id,
              razorpay_signature: result.razorpay_signature,
            });
            setNotice("Subscription active.");
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Could not verify the payment.");
          } finally {
            await loadBilling();
          }
        },
      });
      checkout.open();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start checkout.");
    } finally {
      setSubscribingPlan("");
    }
  }

  async function handleCancel() {
    if (!window.confirm("Cancel your subscription? You'll keep access through the end of the current billing cycle.")) return;
    setCancelling(true);
    setNotice("");
    try {
      await cancelBillingSubscription();
      setNotice("Subscription cancelled - access continues until the current cycle ends.");
      await loadBilling();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not cancel the subscription.");
    } finally {
      setCancelling(false);
    }
  }

  const canCancel = billing && ["pending", "active", "halted"].includes(billing.billingStatus);
  const isSuccessNotice = notice === "Subscription active." || notice.startsWith("Subscription cancelled");

  return (
    <div className="space-y-4">
      <Card className={`p-4 ${cardClass}`}>
        <div className="flex items-center gap-2 mb-1">
          <CreditCard size={16} className="text-primary" />
          <h3 className="text-sm font-medium text-foreground">Current plan</h3>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : billing ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{PLAN_LABELS[billing.plan] || billing.plan}</span>
              <Badge variant={statusVariant(billing.billingStatus)}>{billing.billingStatus}</Badge>
              {!billing.configured && (
                <span className="text-xs text-muted-foreground">Billing is not configured yet - contact your dev team to connect Razorpay.</span>
              )}
            </div>
            {(billing.currentPeriodStart || billing.currentPeriodEnd) && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock size={13} />
                Current cycle: {formatDate(billing.currentPeriodStart)} - {formatDate(billing.currentPeriodEnd)}
              </div>
            )}
            {billing.billingStatus === "trial" && billing.trialEndsAt && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock size={13} />
                Trial ends {formatDate(billing.trialEndsAt)}
              </div>
            )}
            {billing.gate.locked && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Sending messages and campaigns is paused</p>
                  <p className="mt-0.5">
                    {GATE_REASON_LABEL[billing.gate.reason || ""] || "Billing needs attention."} Subscribe or update your payment
                    method below to resume.
                  </p>
                </div>
              </div>
            )}
          </>
        ) : null}
        {canCancel && (
          <Button type="button" size="sm" variant="outline" className="mt-3 h-8 text-xs border-border" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling..." : "Cancel subscription"}
          </Button>
        )}
      </Card>

      {notice && (
        <Card className={isSuccessNotice ? `p-3 border-emerald-500/25 bg-emerald-500/10 ${cardClass}` : `p-3 border-destructive/40 bg-destructive/5 ${cardClass}`}>
          <p className={isSuccessNotice ? "text-xs text-emerald-300" : "text-xs text-destructive"}>{notice}</p>
        </Card>
      )}

      {billing && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((planKey) => {
            const price = billing.prices[planKey];
            const isCurrent = billing.plan === planKey && billing.billingStatus === "active";
            return (
              <Card key={planKey} className={`p-4 ${cardClass}`}>
                <p className="text-sm font-medium text-foreground">{PLAN_LABELS[planKey]}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{price?.label || "—"}</p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 h-8 w-full text-xs bg-primary text-primary-foreground"
                  onClick={() => handleSubscribe(planKey)}
                  disabled={!billing.configured || isCurrent || subscribingPlan === planKey}
                >
                  {isCurrent ? "Current plan" : subscribingPlan === planKey ? "Starting..." : "Subscribe"}
                </Button>
              </Card>
            );
          })}
          <Card className={`p-4 ${cardClass}`}>
            <p className="text-sm font-medium text-foreground">Custom</p>
            <p className="mt-1 text-lg font-semibold text-foreground">Contact us</p>
            <a href="mailto:hello@nemnidhi.com?subject=Custom%20plan%20enquiry" className="mt-3 block">
              <Button type="button" size="sm" variant="outline" className="h-8 w-full text-xs border-border">
                Contact sales
              </Button>
            </a>
          </Card>
        </div>
      )}

      <Card className={`p-4 ${cardClass}`}>
        <div className="flex items-center gap-2 mb-3">
          <ReceiptText size={16} className="text-primary" />
          <h3 className="text-sm font-medium text-foreground">Invoice history</h3>
        </div>
        {!billing || billing.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="space-y-2">
            {billing.invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between rounded-md border border-border/80 bg-background/60 p-2">
                <div>
                  <p className="text-sm text-foreground">{PLAN_LABELS[invoice.plan] || invoice.plan}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(invoice.createdAt).toLocaleDateString()}
                    {invoice.periodStart && invoice.periodEnd
                      ? ` · ${formatDate(invoice.periodStart)} - ${formatDate(invoice.periodEnd)}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">{formatAmount(invoice.amount, invoice.currency)}</span>
                  <Badge variant={invoice.status === "paid" ? "default" : "outline"}>{invoice.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

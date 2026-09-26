// Money and number formatting shared by the screens that show amounts. Indian grouping (1,20,000)
// and lakh/crore short forms, because that is how every client of this product reads money.

export function formatMoney(amount: number, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount || 0);
  } catch {
    return `${currency} ${Math.round(amount || 0).toLocaleString("en-IN")}`;
  }
}

/** ₹8.94 Cr, ₹55 L, ₹42.5K - for headline figures where the exact rupee doesn't matter. */
export function formatMoneyShort(amount: number, currency = "INR") {
  const value = Math.abs(amount || 0);
  const sign = amount < 0 ? "-" : "";
  const symbol = currency === "INR" || !currency ? "₹" : `${currency} `;
  const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(2).replace(/\.?0+$/, ""));
  if (value >= 1e7) return `${sign}${symbol}${trim(value / 1e7)} Cr`;
  if (value >= 1e5) return `${sign}${symbol}${trim(value / 1e5)} L`;
  if (value >= 1e3) return `${sign}${symbol}${trim(value / 1e3)}K`;
  return `${sign}${symbol}${Math.round(value)}`;
}

/** "Rohan Mehta", "Rohan Mehta and Meera Iyer", "Rohan Mehta, Meera Iyer and 3 more" */
export function listNames(names: string[], max = 2) {
  const clean = names.filter(Boolean);
  if (clean.length <= 1) return clean[0] || "";
  if (clean.length <= max) return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
  return `${clean.slice(0, max).join(", ")} and ${clean.length - max} more`;
}

export function initialsOf(name: string) {
  return (
    (name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

import { useEffect, useState } from "react";
import { Package, Search, X } from "lucide-react";
import { getCatalogProducts, getWhatsAppAccounts } from "../../lib/api";
import { Input } from "../ui/input";

interface CatalogProduct {
  retailer_id: string;
  name: string;
  image_url?: string;
  price?: string;
  availability?: string;
}

interface ProductPickerModalProps {
  onClose: () => void;
  onSelect: (product: { catalogId: string; productRetailerId: string; name: string }) => void;
}

// Single Product messages only (v1 scope) - assumes exactly one connected WhatsApp account has a
// Catalog ID set (the common case for this app; multi-account catalog selection is a follow-up,
// not built here).
export function ProductPickerModal({ onClose, onSelect }: ProductPickerModalProps) {
  const [accountId, setAccountId] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getWhatsAppAccounts<{ data: { id: string; catalogId?: string }[] }>()
      .then((response) => {
        const withCatalog = response.data.find((account) => account.catalogId);
        if (!withCatalog) {
          setError("No connected WhatsApp account has a Catalog ID configured yet. Set one in Settings → WhatsApp first.");
          setLoading(false);
          return;
        }
        setAccountId(withCatalog.id);
        setCatalogId(withCatalog.catalogId || "");
      })
      .catch(() => {
        setError("Could not load WhatsApp accounts.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    setError("");
    const timeout = window.setTimeout(() => {
      getCatalogProducts<{ data: CatalogProduct[] }>(accountId, search)
        .then((response) => setProducts(response.data))
        .catch((err) => setError(err instanceof Error ? err.message : "Could not load catalog products."))
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [accountId, search]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Send a product</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick a product from your connected catalog to send in this conversation.</p>
          </div>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {accountId && (
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" className="pl-9" />
          </div>
        )}

        {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

        {!error && loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading products...</p>}

        {!error && !loading && products.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No products found.</p>
        )}

        {!error && !loading && products.length > 0 && (
          <div className="space-y-1.5">
            {products.map((product) => (
              <button
                key={product.retailer_id}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-border/70 p-2 text-left hover:bg-secondary"
                onClick={() => onSelect({ catalogId, productRetailerId: product.retailer_id, name: product.name })}
              >
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="h-12 w-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    <Package size={18} />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
                  {product.price && <p className="text-xs text-muted-foreground">{product.price}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

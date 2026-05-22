// Product variant picker for the Exchange refund flow.
//
// Search box queries /api/products/search (debounced 300ms), shows matching
// variants, lets the merchant click to select one. Selected variant displays
// as a card with image / title / price / SKU and a "Change" button.

import { useEffect, useRef, useState } from "react";
import { Icon, Input } from "./ui";
import { formatMoney } from "../lib/money";

export interface PickedVariant {
  id: string;
  productId: string;
  title: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  price: number;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  imageUrl: string | null;
}

export function ProductPicker({
  value,
  onChange,
  currency,
  placeholder = "Search products by name or SKU…",
}: {
  value: PickedVariant | null;
  onChange: (v: PickedVariant | null) => void;
  currency: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced search.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const resp = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}`);
        const json = await resp.json();
        setResults(json.variants ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  // Selected state — show card + change button.
  if (value) {
    return (
      <div className="rounded-md border border-accent/30 bg-accent/[0.06] p-3 flex items-start gap-3">
        {value.imageUrl ? (
          <img
            src={value.imageUrl}
            alt={value.productTitle}
            className="w-14 h-14 rounded-md object-cover border border-divider shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-md bg-bg grid place-content-center shrink-0 border border-divider">
            <Icon name="Image" size={20} className="text-faint" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-ink truncate">{value.productTitle}</div>
          {value.variantTitle && value.variantTitle !== "Default Title" && (
            <div className="text-[12px] text-muted truncate">{value.variantTitle}</div>
          )}
          <div className="flex items-center gap-2 mt-1 text-[11.5px] text-faint">
            {value.sku && <span>SKU {value.sku}</span>}
            {!value.availableForSale && (
              <span className="px-1.5 py-0.5 rounded bg-danger/15 text-danger font-semibold">Out of stock</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13.5px] font-semibold text-ink tabular-nums">
            {formatMoney(value.price, currency)}
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQ("");
              setResults([]);
              setOpen(true);
            }}
            className="text-[11.5px] text-accent2 hover:text-white mt-1 transition-colors"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  // Search state.
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Icon
          name="Search"
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
        />
        <Input
          value={q}
          onChange={(e: any) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="pl-9"
        />
        {loading && (
          <Icon
            name="Loader"
            size={13}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted animate-spin"
          />
        )}
      </div>

      {open && (q.trim().length >= 2 || results.length > 0) && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-md border border-border bg-surface shadow-pop">
          {!loading && results.length === 0 && (
            <div className="px-3 py-4 text-[12.5px] text-muted text-center">
              No products found for &ldquo;{q}&rdquo;
            </div>
          )}
          {results.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                onChange(v);
                setOpen(false);
                setQ("");
              }}
              className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-bg/40 transition-colors border-b border-divider last:border-0"
            >
              {v.imageUrl ? (
                <img
                  src={v.imageUrl}
                  alt={v.productTitle}
                  className="w-10 h-10 rounded object-cover border border-divider shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-bg grid place-content-center shrink-0 border border-divider">
                  <Icon name="Image" size={14} className="text-faint" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink truncate">{v.productTitle}</div>
                {v.variantTitle && v.variantTitle !== "Default Title" && (
                  <div className="text-[11.5px] text-muted truncate">{v.variantTitle}</div>
                )}
                {v.sku && <div className="text-[10.5px] text-faint truncate">SKU {v.sku}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12.5px] font-semibold text-ink tabular-nums">
                  {formatMoney(v.price, currency)}
                </div>
                {!v.availableForSale && (
                  <div className="text-[10px] text-danger font-semibold mt-0.5">Out of stock</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

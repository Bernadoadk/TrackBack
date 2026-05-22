// Universal money formatter — respects the shop's currency.
//
// Falls back gracefully when the runtime doesn't recognize a currency code
// (e.g. XOF in older Node ICU). Used in both client and server bundles.

const SYMBOL_FALLBACK: Record<string, string> = {
  USD: "$",
  CAD: "$",
  AUD: "$",
  NZD: "$",
  HKD: "$",
  SGD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  XOF: "FCFA",
  XAF: "FCFA",
  XPF: "₣",
  MAD: "DH",
  TND: "DT",
  DZD: "DA",
  EGP: "E£",
  NGN: "₦",
  KES: "KSh",
  ZAR: "R",
  GHS: "GH₵",
  INR: "₹",
  AED: "AED",
  SAR: "SAR",
  TRY: "₺",
  BRL: "R$",
  MXN: "$",
  ARS: "$",
  CLP: "$",
  KRW: "₩",
  THB: "฿",
  RUB: "₽",
  PLN: "zł",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  CHF: "CHF",
};

// Currencies that conventionally don't use decimal places.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function formatMoney(
  amount: number | string | null | undefined,
  currency: string = "USD",
): string {
  const num =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? parseFloat(amount) || 0
        : 0;
  const code = (currency || "USD").toUpperCase();
  const decimals = ZERO_DECIMAL.has(code) ? 0 : 2;

  // Try Intl first — gives proper locale-aware formatting (e.g. "1 000 F CFA").
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  } catch {
    // Fallback: "<symbol><amount>" or "<amount> <code>" if no symbol.
    const symbol = SYMBOL_FALLBACK[code];
    const formatted = num.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return symbol ? `${symbol}${formatted}` : `${formatted} ${code}`;
  }
}

/**
 * Just the symbol/abbreviation for a currency — useful for compact UI labels.
 * Returns the code itself (e.g. "USD") if no friendly form is known.
 */
export function currencySymbol(currency: string = "USD"): string {
  const code = (currency || "USD").toUpperCase();
  return SYMBOL_FALLBACK[code] ?? code;
}

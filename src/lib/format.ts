export const formatMoney = (value: number, currency: "TRY" | "USD" | "EUR" = "TRY") =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: currency === "TRY" ? 0 : 2 }).format(value);

export const formatPercent = (value: number, digits = 1) =>
  new Intl.NumberFormat("tr-TR", { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: "exceptZero" }).format(value);

export const formatNumber = (value: number, digits = 2) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(value);

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

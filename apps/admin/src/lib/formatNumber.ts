const COUNT = new Intl.NumberFormat("ar", { numberingSystem: "latn" });
const DECIMAL = new Intl.NumberFormat("ar", {
  numberingSystem: "latn",
  maximumFractionDigits: 1,
});

/** A count in Western digits, grouped: "1,038". */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** A number with at most one decimal: "190.5". */
export function formatDecimal(n: number): string {
  return DECIMAL.format(n);
}

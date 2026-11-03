export type DiscountMode = "percent" | "fixed";
export type TenderMethod = "Cash" | "Card" | "UPI" | "Bank Transfer" | "Other";

export function toPaise(rupees: number | string): number {
  const parsed = typeof rupees === "string" ? Number(rupees) : rupees;
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

export function formatINR(paise: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    ...options,
  }).format((Number(paise) || 0) / 100);
}

export function discountAmount(basePaise: number, mode: DiscountMode, value: number): number {
  if (basePaise <= 0 || value <= 0) return 0;
  const amount = mode === "percent" ? Math.round(basePaise * Math.min(value, 100) / 100) : Math.round(value);
  return Math.min(basePaise, Math.max(0, amount));
}

export function spreadDiscount(amount: number, bases: number[]): number[] {
  const total = bases.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (amount <= 0 || total <= 0) return bases.map(() => 0);
  let allocated = 0;
  return bases.map((base, index) => {
    if (index === bases.length - 1) return Math.max(0, amount - allocated);
    const share = Math.min(Math.max(0, base), Math.round(amount * Math.max(0, base) / total));
    allocated += share;
    return share;
  });
}

export function barcode13(): string {
  const body = `890${Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("")}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export function invoiceLabel(id: number, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${stamp}-${String(id).padStart(5, "0")}`;
}

/** Allocate successive partial returns without losing or duplicating paise. */
export function proportionalReturnAmount(totalPaise: number, totalQuantity: number, alreadyReturned: number, returnQuantity: number): number {
  if (totalPaise <= 0 || totalQuantity <= 0 || returnQuantity <= 0) return 0;
  const before = Math.round(totalPaise * Math.max(0, alreadyReturned) / totalQuantity);
  const after = Math.round(totalPaise * Math.min(totalQuantity, Math.max(0, alreadyReturned) + returnQuantity) / totalQuantity);
  return Math.max(0, after - before);
}

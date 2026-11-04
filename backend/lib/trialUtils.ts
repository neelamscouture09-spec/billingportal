import { Prisma } from ".././generated/prisma/client";

export class TrialError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export type DiscountMode = "fixed" | "percent";
export function isMoney(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}
export function isDecimal(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 &&
    new Prisma.Decimal(String(x)).decimalPlaces() <= 2;
}
export function safeNumber(n: bigint) {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < 0) throw new TrialError("Amount exceeds supported range");
  return Number(n);
}
export function percent(base: bigint, value: number) {
  return BigInt(new Prisma.Decimal(base.toString()).mul(String(value)).div(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}
export function productPricePaise(price: Prisma.Decimal) {
  const paise = price.mul(100);
  if (!paise.isInteger()) throw new TrialError("Product price is invalid");
  return BigInt(paise.toFixed(0));
}
export function calculateDiscount(base: bigint, mode: DiscountMode, value: number) {
  if (!isDecimal(value) || (mode === "percent" && value > 100)) throw new TrialError("Invalid discount input");
  const discount = mode === "percent" ? percent(base, value)
    : BigInt(new Prisma.Decimal(String(value)).mul(100).toFixed(0));
  if (discount > base) throw new TrialError("Discount exceeds product amount");
  return discount;
}
export function dayInIndia(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find(x => x.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}`;
}
export const validMethods = new Set(["Cash", "Card", "UPI", "Bank Transfer", "Other"]);
export type InputPayment = { method: string; amountPaise: number };
export function paymentsFrom(value: unknown): InputPayment[] {
  if (!Array.isArray(value) || value.length > 20) throw new TrialError("Invalid payment entries");
  return value.map(p => {
    if (!p || typeof p !== "object" || !validMethods.has(p.method) || !isMoney(p.amountPaise) || p.amountPaise <= 0)
      throw new TrialError("Invalid payment method or amount");
    return { method: p.method, amountPaise: p.amountPaise };
  });
}
export type LoadedTrial = Prisma.TrialInvoiceGetPayload<{
  include: { items: true; payments: true };
}>;
export function trialJson(trial: LoadedTrial) {
  return {
    id: trial.id, requestId: trial.requestId, trialNumber: trial.trialNumber,
    status: trial.status, createdAt: trial.createdAt.toISOString(),
    settledAt: trial.settledAt?.toISOString() ?? null,
    customerName: trial.customerName, customerPhone: trial.customerPhone,
    customerEmail: trial.customerEmail, customerAddress: trial.customerAddress,
    subtotalPaise: safeNumber(trial.subtotalPaise),
    productDiscountPaise: safeNumber(trial.productDiscountPaise),
    billDiscountMode: trial.billDiscountMode, billDiscountValue: trial.billDiscountValue.toString(),
    billDiscountPaise: safeNumber(trial.billDiscountPaise),
    totalPaise: safeNumber(trial.totalPaise),
    finalTotalPaise: trial.finalTotalPaise == null ? null : safeNumber(trial.finalTotalPaise),
    paidPaise: safeNumber(trial.paidPaise), refundedPaise: safeNumber(trial.refundedPaise),
    balancePaise: safeNumber(trial.balancePaise), checkoutInvoiceId: trial.checkoutInvoiceId,
    items: trial.items.map(i => ({
      id: i.id, productId: i.productId, productName: i.productName,
      barcode: i.barcode, size: i.size, category: i.category,
      supplierName: i.supplierName, supplierCode: i.supplierCode,
      quantity: i.quantity, unitPricePaise: safeNumber(i.unitPricePaise),
      productDiscountPaise: safeNumber(i.productDiscountPaise),
      discountMode: i.discountMode, discountValue: i.discountValue.toString(),
      netPaise: safeNumber(i.unitPricePaise * BigInt(i.quantity) - i.productDiscountPaise),
      status: i.status, source: i.source,
    })),
    payments: trial.payments.map(p => ({
      id: p.id, method: p.method, amountPaise: safeNumber(p.amountPaise),
      kind: p.kind, createdAt: p.createdAt.toISOString(),
    })),
  };
}

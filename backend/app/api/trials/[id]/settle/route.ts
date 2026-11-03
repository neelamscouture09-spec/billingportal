import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { prisma } from "../../../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../../../lib/cors";
import {
  TrialError, paymentsFrom, productPricePaise, calculateDiscount,
  dayInIndia, safeNumber, trialJson, type DiscountMode,
} from "../../../../../lib/trialUtils";
const send = (req: NextRequest, value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: corsHeaders(req) });
export const OPTIONS = (req: NextRequest) => corsOptions(req);
type Body = {
  keptTrialItemIds: string[];
  addedProductIds: string[];
  payments: { method: string; amountPaise: number }[];
  refunds: { method: string; amountPaise: number }[];
};
function parse(value: unknown): Body {
  if (!value || typeof value !== "object") throw new TrialError("Invalid settlement request");
  const b = value as Body;
  if (!Array.isArray(b.keptTrialItemIds) || !Array.isArray(b.addedProductIds) ||
      b.keptTrialItemIds.some(x => typeof x !== "string") ||
      b.addedProductIds.some(x => typeof x !== "string") ||
      b.keptTrialItemIds.length > 100 || b.addedProductIds.length > 100 ||
      new Set(b.keptTrialItemIds).size !== b.keptTrialItemIds.length ||
      new Set(b.addedProductIds).size !== b.addedProductIds.length)
    throw new TrialError("Invalid or duplicate product selection");
  b.payments = paymentsFrom(b.payments ?? []);
  b.refunds = paymentsFrom(b.refunds ?? []);
  return b;
}
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: Body;
  try { body = parse(await req.json()); }
  catch (e) { return send(req, { success: false, error: e instanceof Error ? e.message : "Invalid JSON" }, 400); }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async tx => {
        const trial = await tx.trialInvoice.findUnique({
          where: { id }, include: { items: true, payments: true },
        });
        if (!trial) throw new TrialError("Trial not found", 404);
        if (trial.status !== "OPEN") throw new TrialError("This trial has already been settled", 409);
        const allTrialIds = new Set(trial.items.map(i => i.id));
        if (body.keptTrialItemIds.some(x => !allTrialIds.has(x)))
          throw new TrialError("An item does not belong to this trial");
        const kept = trial.items.filter(i => body.keptTrialItemIds.includes(i.id));
        const returned = trial.items.filter(i => !body.keptTrialItemIds.includes(i.id));
        const trialProductIds = new Set(trial.items.map(i => i.productId));
        if (body.addedProductIds.some(x => trialProductIds.has(x)))
          throw new TrialError("Added products cannot repeat trial items");
        const additional = await tx.product.findMany({
          where: { id: { in: body.addedProductIds } },
          include: { supplierCode: { include: { supplier: true } } },
        });
        if (additional.length !== body.addedProductIds.length || additional.some(p => p.sold || p.onTrial))
          throw new TrialError("Some additional products are unavailable", 409);
        const entries = [
          ...kept.map(i => ({
            productId: i.productId, name: i.productName, barcode: i.barcode,
            size: i.size, category: i.category, supplierName: i.supplierName,
            supplierCode: i.supplierCode, supplierCodeId: i.supplierCodeId,
            unit: i.unitPricePaise, discount: i.productDiscountPaise,
            discountMode: i.discountMode as DiscountMode, discountValue: i.discountValue,
          })),
          ...additional.map(p => ({
            productId: p.id, name: p.name, barcode: p.barcode,
            size: p.size, category: p.category,
            supplierName: p.supplierCode?.supplier.name ?? null,
            supplierCode: p.supplierCode?.code ?? null,
            supplierCodeId: p.supplierCodeId,
            unit: productPricePaise(p.sellingPrice), discount: BigInt(0),
            discountMode: "fixed" as DiscountMode, discountValue: new Prisma.Decimal(0),
          })),
        ];
        const subtotal = entries.reduce((n, e) => n + e.unit, BigInt(0));
        const itemDiscount = entries.reduce((n, e) => n + e.discount, BigInt(0));
        const postProduct = subtotal - itemDiscount;
        const billMode = trial.billDiscountMode as DiscountMode;
        const originalBillValue = Number(trial.billDiscountValue.toString());
        const billDiscount = billMode === "fixed"
          ? (BigInt(trial.billDiscountValue.mul(100).toFixed(0)) > postProduct
              ? postProduct : BigInt(trial.billDiscountValue.mul(100).toFixed(0)))
          : calculateDiscount(postProduct, "percent", originalBillValue);
        const finalTotal = postProduct - billDiscount;
        const oldPayments = trial.payments.filter(p => p.kind !== "REFUND").reduce((n, p) => n + p.amountPaise, BigInt(0));
        const oldRefunds = trial.payments.filter(p => p.kind === "REFUND").reduce((n, p) => n + p.amountPaise, BigInt(0));
        const newPayments = body.payments.reduce((n, p) => n + BigInt(p.amountPaise), BigInt(0));
        const newRefunds = body.refunds.reduce((n, p) => n + BigInt(p.amountPaise), BigInt(0));
        const collected = oldPayments + newPayments;
        const refunded = oldRefunds + newRefunds;
        if (refunded > collected || collected - refunded !== finalTotal)
          throw new TrialError(`Settlement must balance exactly: final ${safeNumber(finalTotal)} paise, net payments ${safeNumber(collected - refunded)} paise`);
        // Net tenders must reconcile to the final bill, including prior advances and refunds.
        const byMethod = new Map<string, bigint>();
        for (const p of trial.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? BigInt(0)) + (p.kind === "REFUND" ? -p.amountPaise : p.amountPaise));
        for (const p of body.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? BigInt(0)) + BigInt(p.amountPaise));
        for (const p of body.refunds) byMethod.set(p.method, (byMethod.get(p.method) ?? BigInt(0)) - BigInt(p.amountPaise));
        if ([...byMethod.values()].some(n => n < BigInt(0)))
          throw new TrialError("Refund method must have sufficient collected amount; choose the original payment method");
        // Validate reservation ownership before writing anything.
        for (const i of trial.items) {
          const product = await tx.product.findUnique({ where: { id: i.productId }, select: { sold: true, onTrial: true } });
          if (!product || product.sold || !product.onTrial)
            throw new TrialError(`Trial reservation is missing: ${i.productName}`, 409);
        }
        for (const i of returned) {
          const changed = await tx.product.updateMany({
            where: { id: i.productId, sold: false, onTrial: true },
            data: { sold: false, onTrial: false },
          });
          if (changed.count !== 1) throw new TrialError("Unable to release returned trial item", 409);
        }
        for (const i of kept) {
          const changed = await tx.product.updateMany({
            where: { id: i.productId, sold: false, onTrial: true },
            data: { sold: true, onTrial: false },
          });
          if (changed.count !== 1) throw new TrialError("Unable to finalize kept trial item", 409);
        }
        for (const p of additional) {
          const changed = await tx.product.updateMany({
            where: { id: p.id, sold: false, onTrial: false }, data: { sold: true },
          });
          if (changed.count !== 1) throw new TrialError("Additional product was sold elsewhere", 409);
        }
        await tx.trialItem.updateMany({ where: { trialId: id, id: { in: kept.map(i => i.id) } }, data: { status: "KEPT" } });
        await tx.trialItem.updateMany({ where: { trialId: id, id: { in: returned.map(i => i.id) } }, data: { status: "RETURNED" } });
        if (additional.length) {
          await tx.trialItem.createMany({ data: additional.map(p => ({
            trialId: id, productId: p.id, productName: p.name, barcode: p.barcode,
            size: p.size, category: p.category,
            supplierName: p.supplierCode?.supplier.name ?? null,
            supplierCode: p.supplierCode?.code ?? null,
            supplierCodeId: p.supplierCodeId,
            unitPricePaise: productPricePaise(p.sellingPrice), productDiscountPaise: BigInt(0),
            discountMode: "fixed", discountValue: new Prisma.Decimal(0),
            quantity: 1, status: "KEPT", source: "ADDED",
          })) });
        }
        if (body.payments.length || body.refunds.length) {
          await tx.trialPayment.createMany({ data: [
            ...body.payments.map(p => ({ trialId: id, method: p.method, amountPaise: BigInt(p.amountPaise), kind: "SETTLEMENT" })),
            ...body.refunds.map(p => ({ trialId: id, method: p.method, amountPaise: BigInt(p.amountPaise), kind: "REFUND" })),
          ] });
        }
        let checkoutInvoiceId: string | null = null;
        let invoiceNumber: string | null = null;
        if (entries.length) {
          const now = new Date();
          const day = dayInIndia(now);
          const counter = await tx.invoiceCounter.upsert({ where: { dateKey: day },
            create: { dateKey: day, lastNumber: 1 }, update: { lastNumber: { increment: 1 } } });
          invoiceNumber = `NEEL-${day}-${String(counter.lastNumber).padStart(3, "0")}`;
          const finalInvoice = await tx.checkoutInvoice.create({
            data: {
              requestId: `trial-${trial.id}`, invoiceNumber, invoiceDate: now,
              invoiceDateKey: day, invoiceSequence: counter.lastNumber,
              customerName: trial.customerName, customerPhone: trial.customerPhone,
              customerEmail: trial.customerEmail, customerAddress: trial.customerAddress,
              subtotalPaise: subtotal, productDiscountPaise: itemDiscount,
              billDiscountMode: billMode, billDiscountValue: billMode === "fixed"
                ? new Prisma.Decimal(billDiscount.toString()) // existing checkout fixed input is paise
                : trial.billDiscountValue,
              billDiscountPaise: billDiscount, returnedDiscountPaise: BigInt(0),
              totalDiscountPaise: itemDiscount + billDiscount,
              totalPaise: finalTotal, paidPaise: finalTotal, changePaise: BigInt(0),
              paymentStatus: "PAID",
              items: { create: entries.map(e => ({
                productId: e.productId, productName: e.name, barcode: e.barcode,
                size: e.size, category: e.category, supplierName: e.supplierName,
                supplierCode: e.supplierCode, supplierCodeId: e.supplierCodeId,
                quantity: 1, unitPricePaise: e.unit, grossPaise: e.unit,
                productDiscountPaise: e.discount, discountMode: e.discountMode,
                discountValue: e.discountValue, netPaise: e.unit - e.discount,
              })) },
              tenders: { create: [...byMethod].filter(([, amount]) => amount > BigInt(0))
                .map(([method, amountPaise]) => ({ method, amountPaise })) },
            },
          });
          checkoutInvoiceId = finalInvoice.id;
        }
        const updated = await tx.trialInvoice.update({ where: { id }, data: {
          status: entries.length ? "SETTLED" : "CANCELLED", settledAt: new Date(),
          finalTotalPaise: finalTotal, paidPaise: collected,
          refundedPaise: refunded, balancePaise: BigInt(0),
          checkoutInvoiceId,
        }, include: { items: true, payments: true } });
        return { trial: trialJson(updated), checkoutInvoiceId, invoiceNumber };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 60000 });
      return send(req, { success: true, ...result });
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "";
      if (code === "P2034" && attempt < 2) continue;
      if (e instanceof TrialError) return send(req, { success: false, error: e.message }, e.status);
      console.error("[TRIAL SETTLE]", e);
      return send(req, { success: false, error: "Unable to settle trial" }, 500);
    }
  }
  return send(req, { success: false, error: "Concurrent settlement, retry" }, 409);
}

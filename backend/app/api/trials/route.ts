import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../lib/cors";
import {
  TrialError, isMoney, isDecimal, paymentsFrom, productPricePaise,
  calculateDiscount, safeNumber, dayInIndia, trialJson, type DiscountMode,
} from "../../../lib/trialUtils";
const send = (req: NextRequest, value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: corsHeaders(req) });
export const OPTIONS = (req: NextRequest) => corsOptions(req);

type CartItem = { productId: string; quantity: number;
  discountMode: DiscountMode; discountValue: number; productDiscountPaise: number };
type CreateBody = { requestId: string;
  customer: { name: string; phone: string; email: string; address: string };
  items: CartItem[]; billDiscountMode: DiscountMode; billDiscountValue: number;
  tenders: { method: string; amountPaise: number }[] };
function validate(raw: unknown): CreateBody {
  if (!raw || typeof raw !== "object") throw new TrialError("Invalid trial request");
  const b = raw as CreateBody;
  if (typeof b.requestId !== "string" || !/^[\w-]{8,100}$/.test(b.requestId))
    throw new TrialError("Invalid requestId");
  if (!b.customer || !["name", "phone", "email", "address"].every(k =>
    typeof (b.customer as unknown as Record<string, unknown>)[k] === "string"))
    throw new TrialError("Customer fields must be strings");
  if (!b.customer.name.trim() || !b.customer.phone.trim())
    throw new TrialError("Customer name and phone are required for trial items");
  if (b.customer.name.length > 200 || b.customer.phone.length > 30 ||
      b.customer.email.length > 250 || b.customer.address.length > 5000)
    throw new TrialError("Customer details too long");
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100)
    throw new TrialError("Provide 1–100 trial products");
  if (new Set(b.items.map(x => x.productId)).size !== b.items.length)
    throw new TrialError("Repeated product in trial");
  for (const item of b.items) {
    if (!item || typeof item.productId !== "string" || !item.productId || item.quantity !== 1 ||
        !["fixed", "percent"].includes(item.discountMode) || !isDecimal(item.discountValue) ||
        !isMoney(item.productDiscountPaise))
      throw new TrialError("Every trial line must be one unique product with a valid discount");
  }
  if (!["fixed", "percent"].includes(b.billDiscountMode) || !isDecimal(b.billDiscountValue) ||
      (b.billDiscountMode === "percent" && b.billDiscountValue > 100))
    throw new TrialError("Invalid bill discount");
  b.tenders = paymentsFrom(b.tenders);
  return b;
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")?.trim();
    const search = req.nextUrl.searchParams.get("search")?.trim();
    const status = req.nextUrl.searchParams.get("status")?.trim() || "all";
    if (!new Set(["all", "OPEN", "SETTLED", "CANCELLED"]).has(status))
      return send(req, { success: false, error: "Invalid status" }, 400);
    const where: Prisma.TrialInvoiceWhereInput = {
      ...(id ? { id } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(search ? { OR: [
        { trialNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { customerPhone: { contains: search } },
      ] } : {}),
    };
    const trials = await prisma.trialInvoice.findMany({
      where, include: { items: true, payments: true },
      orderBy: { createdAt: "desc" }, take: id ? 1 : 200,
    });
    if (id && !trials.length) return send(req, { success: false, error: "Trial not found" }, 404);
    return send(req, { success: true, trials: trials.map(trialJson) });
  } catch (error) {
    console.error("[TRIAL GET]", error);
    return send(req, { success: false, error: "Cannot load trials" }, 500);
  }
}

export async function POST(req: NextRequest) {
  let b: CreateBody;
  try { b = validate(await req.json()); }
  catch (e) { return send(req, { success: false, error: e instanceof Error ? e.message : "Invalid JSON" }, 400); }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const trial = await prisma.$transaction(async tx => {
        const existing = await tx.trialInvoice.findUnique({ where: { requestId: b.requestId },
          include: { items: true, payments: true } });
        if (existing) return existing;
        const products = await tx.product.findMany({
          where: { id: { in: b.items.map(x => x.productId) } },
          include: { supplierCode: { include: { supplier: true } } },
        });
        const byId = new Map(products.map(p => [p.id, p]));
        const entries = b.items.map(input => {
          const p = byId.get(input.productId);
          if (!p || p.stockQuantity - p.reservedQuantity < 1) throw new TrialError("One or more selected products are out of stock", 409);
          const price = productPricePaise(p.sellingPrice);
          const discount = calculateDiscount(price, input.discountMode, input.discountValue);
          if (safeNumber(discount) !== input.productDiscountPaise)
            throw new TrialError(`Discount mismatch for ${p.name}`);
          return { p, price, discount, input };
        });
        const subtotal = entries.reduce((n, e) => n + e.price, BigInt(0));
        const productDiscount = entries.reduce((n, e) => n + e.discount, BigInt(0));
        const afterProducts = subtotal - productDiscount;
        const billDiscount = calculateDiscount(afterProducts, b.billDiscountMode, b.billDiscountValue);
        const total = afterProducts - billDiscount;
        const paid = b.tenders.reduce((n, p) => n + BigInt(p.amountPaise), BigInt(0));
        if (paid > total) throw new TrialError("Trial advance cannot exceed proposed bill total");
        for (const e of entries) {
          const changed = await tx.product.updateMany({
            where: { id: e.p.id, stockQuantity: e.p.stockQuantity, reservedQuantity: e.p.reservedQuantity },
            data: { reservedQuantity: { increment: 1 } },
          });
          if (changed.count !== 1) throw new TrialError(`Product no longer available: ${e.p.name}`, 409);
        }
        const now = new Date();
        const trialNumber = `TRL-${dayInIndia(now)}-${randomUUID().slice(0, 8).toUpperCase()}`;
        return tx.trialInvoice.create({
          data: {
            requestId: b.requestId, trialNumber,
            customerName: b.customer.name.trim(), customerPhone: b.customer.phone.trim(),
            customerEmail: b.customer.email.trim(), customerAddress: b.customer.address.trim(),
            billDiscountMode: b.billDiscountMode,
            billDiscountValue: new Prisma.Decimal(String(b.billDiscountValue)),
            billDiscountPaise: billDiscount, subtotalPaise: subtotal,
            productDiscountPaise: productDiscount, totalPaise: total,
            paidPaise: paid, balancePaise: total - paid,
            items: { create: entries.map(e => ({
              productId: e.p.id, productName: e.p.name, barcode: e.p.barcode,
              size: e.p.size, category: e.p.category,
              supplierName: e.p.supplierCode?.supplier.name ?? null,
              supplierCode: e.p.supplierCode?.code ?? null,
              supplierCodeId: e.p.supplierCodeId,
              unitPricePaise: e.price, productDiscountPaise: e.discount,
              discountMode: e.input.discountMode,
              discountValue: new Prisma.Decimal(String(e.input.discountValue)),
            })) },
            payments: { create: b.tenders.map(p => ({ method: p.method,
              amountPaise: BigInt(p.amountPaise), kind: "ADVANCE" })) },
          },
          include: { items: true, payments: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 60000 });
      return send(req, { success: true, trial: trialJson(trial) }, 201);
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "";
      if ((code === "P2034" || code === "P2002") && attempt < 2) continue;
      if (e instanceof TrialError) return send(req, { success: false, error: e.message }, e.status);
      console.error("[TRIAL CREATE]", e);
      return send(req, { success: false, error: "Trial could not be saved" }, 500);
    }
  }
  return send(req, { success: false, error: "Concurrent trial update. Retry." }, 409);
}

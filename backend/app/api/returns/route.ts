// Manual merchandise returns. This route does NOT issue cash refunds and does NOT change checkout.
// A newly saved return stores a single-use credit, which the cashier manually types at POS.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../lib/cors";

const json = (req: NextRequest, body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: corsHeaders(req) });
export const OPTIONS = (req: NextRequest) => corsOptions(req);
const safe = (value: bigint) => {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) throw new Error("Amount exceeds supported precision");
  return converted;
};

// Largest remainder allocation, deterministic by invoice-item ID. Sum is EXACTLY amount.
function apportion(items: { id: string; weight: bigint }[], amount: bigint): Map<string, bigint> {
  const map = new Map(items.map(item => [item.id, 0n]));
  const sum = items.reduce((a, item) => a + item.weight, 0n);
  if (amount <= 0n || sum <= 0n) return map;
  if (amount > sum) throw new Error("INVALID_INVOICE_DISCOUNTS");
  const shares = items.map(item => ({
    id: item.id, base: amount * item.weight / sum,
    remainder: amount * item.weight % sum,
  }));
  let left = amount - shares.reduce((a, item) => a + item.base, 0n);
  shares.sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const share of shares) {
    if (left <= 0n) break;
    share.base += 1n;
    left -= 1n;
  }
  shares.forEach(share => map.set(share.id, share.base));
  return map;
}

// Deterministic cumulative split: multiple returns of the same invoice line
// always add up to exactly the original amount, including odd paise.
function portion(amount: bigint, fullQuantity: number, before: number, count: number): bigint {
  if (!Number.isSafeInteger(fullQuantity) || fullQuantity < 1 ||
      !Number.isSafeInteger(before) || before < 0 ||
      !Number.isSafeInteger(count) || count < 0 || before + count > fullQuantity)
    throw new Error("INVALID_QUANTITY");
  const units = BigInt(fullQuantity);
  return amount * BigInt(before + count) / units - amount * BigInt(before) / units;
}

type Item = { id: string; netPaise: bigint };
type OriginalInvoice = {
  items: Item[];
  billDiscountPaise: bigint;
  returnedDiscountPaise: bigint;
};
function invoiceShares(invoice: OriginalInvoice) {
  const afterProduct = invoice.items.map(item => ({ id: item.id, weight: item.netPaise }));
  const bill = apportion(afterProduct, invoice.billDiscountPaise);
  const afterBill = invoice.items.map(item => ({ id: item.id, weight: item.netPaise - (bill.get(item.id) ?? 0n) }));
  const oldCredits = apportion(afterBill, invoice.returnedDiscountPaise);
  return new Map(invoice.items.map(item => [item.id, {
    bill: bill.get(item.id) ?? 0n,
    previouslyAppliedCredit: oldCredits.get(item.id) ?? 0n,
    settlement: item.netPaise - (bill.get(item.id) ?? 0n) - (oldCredits.get(item.id) ?? 0n),
  }]));
}

const batchInclude = {
  invoice: { include: { items: true } },
  lines: { include: { invoiceItem: true } },
  credit: true,
} as const;

function serializeBatch(batch: {
  id: string; createdAt: Date;
  invoice: { invoiceNumber: string; invoiceDate: Date; customerName: string; customerPhone: string;
    subtotalPaise: bigint; productDiscountPaise: bigint; billDiscountPaise: bigint;
    billDiscountMode: string; billDiscountValue: Prisma.Decimal; returnedDiscountPaise: bigint;
    totalPaise: bigint; items: Array<{ id: string; netPaise: bigint }> };
  lines: Array<{ id: string; quantity: number; returnedBefore: number; originalPaise: bigint; creditPaise: bigint;
    invoiceItem: { id: string; productName: string; barcode: string; size: string; quantity: number;
      unitPricePaise: bigint; grossPaise: bigint; productDiscountPaise: bigint;
      discountMode: string; discountValue: Prisma.Decimal; netPaise: bigint; } }>;
  credit: { id: string; amountPaise: bigint; usedAt: Date | null; usedByInvoiceId: string | null } | null;
}) {
  const shares = invoiceShares(batch.invoice);
  const parts = batch.lines.map(line => {
    const item = line.invoiceItem;
    const before = line.returnedBefore ?? 0;
    const count = line.quantity;
    const net = portion(item.netPaise, item.quantity, before, count);
    const gross = item.unitPricePaise * BigInt(count);
    const productDiscount = gross - net;
    const bill = batch.credit ? portion(shares.get(item.id)!.bill, item.quantity, before, count) : 0n;
    const prev = batch.credit ? portion(shares.get(item.id)!.previouslyAppliedCredit, item.quantity, before, count) : 0n;
    return { item, line, gross, productDiscount, net, bill, prev };
  });
  const sum = (select: (part: typeof parts[number]) => bigint) => safe(parts.reduce((n, part) => n + select(part), 0n));
  const gross = sum(p => p.gross);
  const productDiscount = sum(p => p.productDiscount);
  const settlement = batch.credit ? safe(batch.credit.amountPaise) : 0;
  const returnedBillDiscount = sum(p => p.bill);
  const returnedOldCredit = sum(p => p.prev);
  return {
    id: batch.id,
    returnNumber: `RET-${batch.id.slice(0, 8).toUpperCase()}`,
    createdAt: batch.createdAt.toISOString(),
    invoiceNumber: batch.invoice.invoiceNumber,
    invoiceDate: batch.invoice.invoiceDate.toISOString(),
    customerName: batch.invoice.customerName,
    customerPhone: batch.invoice.customerPhone,
    originalInvoiceTotalPaise: safe(batch.invoice.totalPaise),
    originalInvoiceGrossPaise: safe(batch.invoice.subtotalPaise),
    originalInvoiceProductDiscountPaise: safe(batch.invoice.productDiscountPaise),
    originalInvoiceBillDiscountPaise: safe(batch.invoice.billDiscountPaise),
    originalInvoiceReturnedCreditPaise: safe(batch.invoice.returnedDiscountPaise),
    billDiscountMode: batch.invoice.billDiscountMode,
    billDiscountValue: batch.invoice.billDiscountValue.toString(),
    originalReturnedGrossPaise: gross,
    returnedProductDiscountPaise: productDiscount,
    allocatedDeductionsPaise: returnedBillDiscount + returnedOldCredit,
    returnedBillDiscountPaise: returnedBillDiscount,
    returnedPreviouslyAppliedCreditPaise: returnedOldCredit,
    settlementPaise: settlement,
    isLegacyStockOnly: !batch.credit,
    status: !batch.credit ? "LEGACY_NO_CREDIT" : batch.credit.usedAt ? "CLAIMED" : "PENDING",
    claimedAt: batch.credit?.usedAt?.toISOString() ?? null,
    items: parts.map(({ item, line, gross, productDiscount, net, bill, prev }) => ({
      id: item.id, name: item.productName,
      barcode: item.barcode, size: item.size,
      quantity: line.quantity, unitPricePaise: safe(item.unitPricePaise),
      grossPaise: safe(gross), productDiscountPaise: safe(productDiscount),
      discountMode: item.discountMode, discountValue: item.discountValue.toString(),
      netAfterProductDiscountPaise: safe(net),
      settlementPaise: batch.credit ? safe(line.creditPaise) : 0,
      allocatedDeductionsPaise: batch.credit ? safe(net - line.creditPaise) : 0,
      billDiscountSharePaise: safe(bill), previousCreditSharePaise: safe(prev),
    })),
  };
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  const invoiceNumber = req.nextUrl.searchParams.get("invoiceNumber")?.trim() ?? "";
  const history = req.nextUrl.searchParams.get("history") === "1";
  try {
    if (history) {
      const batches = await prisma.returnBatch.findMany({ include: batchInclude, orderBy: { createdAt: "desc" }, take: 300 });
      return json(req, { success: true, returns: batches.map(serializeBatch) });
    }
    if (search) {
      if (search.length < 2) return json(req, { success: true, suggestions: [] });
      if (search.length > 100) return json(req, { success: false, error: "Search too long" }, 400);
      const matches = await prisma.checkoutInvoice.findMany({
        where: { invoiceNumber: { contains: search, mode: "insensitive" } },
        select: { id: true, invoiceNumber: true, invoiceDate: true, customerName: true, customerPhone: true },
        orderBy: { invoiceDate: "desc" }, take: 12,
      });
      return json(req, { success: true, suggestions: matches });
    }
    if (!invoiceNumber || invoiceNumber.length > 100)
      return json(req, { success: false, error: "Provide an invoice number" }, 400);
    const invoice = await prisma.checkoutInvoice.findFirst({
      where: { invoiceNumber: { equals: invoiceNumber, mode: "insensitive" } },
      include: { items: { include: { returnLines: true } } },
    });
    if (!invoice) return json(req, { success: false, error: "Invoice not found" }, 404);
    const shares = invoiceShares(invoice);
    return json(req, { success: true, invoice: {
      id: invoice.id, invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString(),
      customerName: invoice.customerName, customerPhone: invoice.customerPhone,
      customerEmail: invoice.customerEmail, customerAddress: invoice.customerAddress,
      totalPaise: safe(invoice.totalPaise), billDiscountMode: invoice.billDiscountMode,
      billDiscountValue: invoice.billDiscountValue.toString(),
      billDiscountPaise: safe(invoice.billDiscountPaise),
      returnedDiscountPaise: safe(invoice.returnedDiscountPaise),
      items: invoice.items.map(item => {
        const returnedQuantity = item.returnLines.reduce((n, line) => n + line.quantity, 0);
        const canReturnQuantity = Math.max(0, item.quantity - returnedQuantity);
        const share = shares.get(item.id)!;
        return {
          id: item.id, productId: item.productId, productName: item.productName,
          barcode: item.barcode, size: item.size, quantity: item.quantity,
          unitPricePaise: safe(item.unitPricePaise), grossPaise: safe(item.grossPaise),
          productDiscountPaise: safe(item.productDiscountPaise),
          discountMode: item.discountMode, discountValue: item.discountValue.toString(),
          netPaise: safe(item.netPaise),
          billDiscountSharePaise: safe(share.bill),
          previousCreditSharePaise: safe(share.previouslyAppliedCredit),
          settlementPaise: safe(share.settlement),
          canReturn: canReturnQuantity > 0 && invoice.paymentStatus === "PAID",
          returnedQuantity, canReturnQuantity,
          returnStatus: canReturnQuantity === 0 ? "RETURNED" : returnedQuantity > 0 ? "PARTIALLY_RETURNED" : "NOT_RETURNED",
        };
      }),
    } });
  } catch (error) {
    console.error("[RETURNS GET]", error);
    return json(req, { success: false, error: "Unable to load return information" }, 500);
  }
}

export async function POST(req: NextRequest) {
  let body: { invoiceId: string; items: { invoiceItemId: string; quantity: number }[] };
  try {
    body = await req.json();
    if (!body || typeof body.invoiceId !== "string" || !body.invoiceId.trim() ||
        !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100 ||
        body.items.some(item => !item || typeof item.invoiceItemId !== "string" || !item.invoiceItemId.trim() ||
          !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) ||
        new Set(body.items.map(item => item.invoiceItemId)).size !== body.items.length)
      return json(req, { success: false, error: "Select valid return quantities" }, 400);
  } catch { return json(req, { success: false, error: "Invalid JSON" }, 400); }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const batchId = await prisma.$transaction(async tx => {
        const invoice = await tx.checkoutInvoice.findUnique({ where: { id: body.invoiceId }, include: { items: true } });
        if (!invoice) throw new Error("INVOICE_NOT_FOUND");
        if (invoice.paymentStatus !== "PAID") throw new Error("INVOICE_NOT_PAID");
        const requested = new Map(body.items.map(item => [item.invoiceItemId, item.quantity]));
        const selected = invoice.items.filter(item => requested.has(item.id));
        if (selected.length !== body.items.length) throw new Error("INVALID_ITEMS");
        const previousLines = await tx.returnLine.findMany({
          where: { invoiceItemId: { in: selected.map(item => item.id) } },
          select: { invoiceItemId: true, quantity: true },
        });
        const alreadyReturned = new Map<string, number>();
        for (const line of previousLines) alreadyReturned.set(line.invoiceItemId,
          (alreadyReturned.get(line.invoiceItemId) ?? 0) + line.quantity);
        const shares = invoiceShares(invoice);
        const lines = selected.map(item => {
          const before = alreadyReturned.get(item.id) ?? 0;
          const quantity = requested.get(item.id)!;
          if (before + quantity > item.quantity) throw new Error("QUANTITY_EXCEEDED");
          const amounts = shares.get(item.id)!;
          const originalPaise = portion(item.netPaise, item.quantity, before, quantity);
          const creditPaise = originalPaise
            - portion(amounts.bill, item.quantity, before, quantity)
            - portion(amounts.previouslyAppliedCredit, item.quantity, before, quantity);
          if (creditPaise < 0n) throw new Error("INVALID_INVOICE_DISCOUNTS");
          return { item, quantity, before, originalPaise, creditPaise };
        });
        const creditTotal = lines.reduce((sum, line) => sum + line.creditPaise, 0n);
        // Serializable transaction plus unique (invoiceItemId, returnedBefore)
        // prevents concurrent duplicate stock restoration and over-returning.
        const batch = await tx.returnBatch.create({ data: {
          invoiceId: invoice.id,
          lines: { create: lines.map(({ item, quantity, before, originalPaise, creditPaise }) => ({
            invoiceItemId: item.id, productId: item.productId, quantity,
            returnedBefore: before, originalPaise, creditPaise,
            includeDiscount: true, reason: "MERCHANDISE_RETURN_CREDIT",
          })) },
          credit: { create: { invoiceId: invoice.id, amountPaise: creditTotal } },
        } });
        for (const { item, quantity } of lines) {
          const updated = await tx.product.updateMany({
            where: { id: item.productId }, data: { stockQuantity: { increment: quantity } },
          });
          if (updated.count !== 1) throw new Error("PRODUCT_NOT_FOUND");
        }
        return batch.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 30000 });
      const saved = await prisma.returnBatch.findUnique({ where: { id: batchId }, include: batchInclude });
      if (!saved) throw new Error("SAVED_RETURN_NOT_FOUND");
      return json(req, { success: true, returned: serializeBatch(saved) }, 201);
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
      if (code === "P2034" && attempt < 2) continue;
      if (code === "P2002") return json(req, { success: false, error: "The selected quantity has already been returned; refresh the invoice" }, 409);
      const msg = error instanceof Error ? error.message : "";
      const known: Record<string, string> = {
        INVOICE_NOT_FOUND: "Invoice not found", INVOICE_NOT_PAID: "Only paid invoices can be returned",
        INVALID_ITEMS: "Selected products do not belong to this invoice",
        QUANTITY_EXCEEDED: "Return quantity exceeds the remaining eligible units",
        INVALID_INVOICE_DISCOUNTS: "Invalid original invoice discount amounts",
        PRODUCT_NOT_FOUND: "Product is no longer available for stock restoration",
      };
      if (known[msg]) return json(req, { success: false, error: known[msg] }, 409);
      console.error("[RETURNS POST]", error);
      return json(req, { success: false, error: "Could not save return" }, 500);
    }
  }
  return json(req, { success: false, error: "Concurrent return conflict; retry" }, 409);
}

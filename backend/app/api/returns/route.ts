// backend/app/api/returns/route.ts
// Full invoice-line stock restock. No automatic refund or customer credit.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../lib/cors";

const json = (req: NextRequest, data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: corsHeaders(req) });
export const OPTIONS = (req: NextRequest) => corsOptions(req);

function safePaise(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Invoice amount exceeds safe precision");
  return number;
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  const invoiceNumber = req.nextUrl.searchParams.get("invoiceNumber")?.trim() ?? "";
  try {
    if (search) {
      if (search.length < 2) return json(req, { success: true, suggestions: [] });
      if (search.length > 100) return json(req, { success: false, error: "Search too long" }, 400);
      const results = await prisma.checkoutInvoice.findMany({
        where: { invoiceNumber: { contains: search, mode: "insensitive" } },
        select: { id: true, invoiceNumber: true, invoiceDate: true, customerName: true, customerPhone: true },
        orderBy: { invoiceDate: "desc" }, take: 12,
      });
      return json(req, {
        success: true,
        suggestions: results.map(x => ({ ...x, invoiceDate: x.invoiceDate.toISOString() })),
      });
    }
    if (!invoiceNumber || invoiceNumber.length > 100)
      return json(req, { success: false, error: "Valid invoiceNumber is required" }, 400);

    const invoice = await prisma.checkoutInvoice.findFirst({
      where: { invoiceNumber: { equals: invoiceNumber, mode: "insensitive" } },
      include: { items: { include: { returnLines: true } } },
    });
    if (!invoice) return json(req, { success: false, error: "Invoice not found" }, 404);

    return json(req, {
      success: true,
      invoice: {
        id: invoice.id, invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate.toISOString(),
        customerName: invoice.customerName, customerPhone: invoice.customerPhone,
        items: invoice.items.map(item => {
          const returned = item.returnLines.length > 0;
          return {
            id: item.id, productId: item.productId, productName: item.productName,
            size: item.size, barcode: item.barcode, quantity: item.quantity,
            grossPaise: safePaise(item.grossPaise),
            productDiscountPaise: safePaise(item.productDiscountPaise),
            discountMode: item.discountMode ?? "fixed",
            discountValue: item.discountValue?.toString() ?? "0",
            netPaise: safePaise(item.netPaise),
            // Legacy fields consumed by the existing Returns page.
            sold: !returned, returnStatus: returned ? "RETURNED" : "NOT_RETURNED",
            canReturn: !returned,
            returnedQuantity: returned ? item.quantity : 0,
            canReturnQuantity: returned ? 0 : item.quantity,
          };
        }),
      },
    });
  } catch (error) {
    console.error("[RETURNS GET]", error);
    return json(req, { success: false, error: "Unable to retrieve invoices" }, 500);
  }
}

type RestoreRequest = { invoiceId: string; invoiceItemIds: string[] };

// Each selected invoice line is returned in full (including quantity > 1).
// A unique ReturnLine per invoice item prevents double-restocking.
// Does not process cash refunds, exchange credits, or partial-line returns.
export async function POST(req: NextRequest) {
  let body: RestoreRequest;
  try {
    body = await req.json();
    if (!body || typeof body.invoiceId !== "string" || !body.invoiceId.trim() ||
      !Array.isArray(body.invoiceItemIds) || body.invoiceItemIds.length < 1 || body.invoiceItemIds.length > 100 ||
      body.invoiceItemIds.some(id => typeof id !== "string" || !id.trim()) ||
      new Set(body.invoiceItemIds).size !== body.invoiceItemIds.length) {
      return json(req, { success: false, error: "Invalid return selection" }, 400);
    }
  } catch {
    return json(req, { success: false, error: "Invalid JSON" }, 400);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async tx => {
        const invoice = await tx.checkoutInvoice.findUnique({
          where: { id: body.invoiceId }, include: { items: true },
        });
        if (!invoice) throw new Error("INVOICE_NOT_FOUND");
        if (invoice.paymentStatus !== "PAID") throw new Error("INVOICE_NOT_PAID");
        const selected = invoice.items.filter(item => body.invoiceItemIds.includes(item.id));
        if (selected.length !== body.invoiceItemIds.length) throw new Error("ITEM_MISMATCH");

        const existingReturns = await tx.returnLine.findMany({
          where: { invoiceItemId: { in: selected.map(i => i.id) } },
          select: { invoiceItemId: true },
        });
        if (existingReturns.length) throw new Error("ALREADY_RESTORED");

        // Persist return history in the same transaction as stock increments.
        const batch = await tx.returnBatch.create({
          data: {
            invoiceId: invoice.id,
            lines: { create: selected.map(item => ({
              invoiceItemId: item.id, productId: item.productId,
              quantity: item.quantity,
              originalPaise: item.netPaise,
              creditPaise: BigInt(0),
              includeDiscount: false,
              reason: "RESTOCK_ONLY",
            })) },
          },
        });

        for (const item of selected) {
          const updated = await tx.product.updateMany({
            where: { id: item.productId },
            data: { stockQuantity: { increment: item.quantity } },
          });
          if (updated.count !== 1) throw new Error("PRODUCT_NOT_FOUND");
        }
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          returnBatchId: batch.id,
          restoredCount: selected.length,
          restoredUnits: selected.reduce((sum, item) => sum + item.quantity, 0),
          productIds: selected.map(item => item.productId),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 30000 });
      return json(req, { success: true, ...result });
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
      if (code === "P2034" && attempt < 2) continue;
      if (code === "P2002") return json(req, { success: false, error: "One or more invoice items have already been returned. Refresh." }, 409);
      const msg = error instanceof Error ? error.message : "";
      const messages: Record<string, string> = {
        INVOICE_NOT_FOUND: "Invoice not found",
        INVOICE_NOT_PAID: "Only paid invoices can be returned",
        ITEM_MISMATCH: "Selected items do not belong to this invoice",
        ALREADY_RESTORED: "One or more selected invoice lines have already been returned",
        PRODUCT_NOT_FOUND: "Product no longer exists; cannot restock automatically",
      };
      if (messages[msg]) return json(req, { success: false, error: messages[msg] }, msg === "INVOICE_NOT_FOUND" ? 404 : 409);
      console.error("[RETURNS POST]", error);
      return json(req, { success: false, error: "Unable to restore products" }, 500);
    }
  }
  return json(req, { success: false, error: "Concurrent update, retry" }, 409);
}

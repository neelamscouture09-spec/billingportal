// backend/app/api/returns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../lib/cors";

export const runtime = "nodejs";
const json = (req: NextRequest, body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: corsHeaders(req) });
export async function OPTIONS(req: NextRequest) { return corsOptions(req); }

function safePaise(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) throw new Error("Invoice amount out of supported range");
  return converted;
}

// GET /api/returns?search=NEEL-2026 => autocomplete, max 12 matches
// GET /api/returns?invoiceNumber=NEEL-20261013-001 => invoice + item status
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
        orderBy: { invoiceDate: "desc" },
        take: 12,
      });
      return json(req, { success: true, suggestions: results.map(x => ({ ...x, invoiceDate: x.invoiceDate.toISOString() })) });
    }
    if (!invoiceNumber) return json(req, { success: false, error: "invoiceNumber is required" }, 400);
    if (invoiceNumber.length > 100) return json(req, { success: false, error: "Invalid invoice number" }, 400);
    const invoice = await prisma.checkoutInvoice.findFirst({
      where: { invoiceNumber: { equals: invoiceNumber, mode: "insensitive" } },
      include: { items: true },
    });
    if (!invoice) return json(req, { success: false, error: "Invoice not found" }, 404);
    const ids = [...new Set(invoice.items.map(item => item.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, sold: true, returnStatus: true },
    });
    const statusById = new Map(products.map(p => [p.id, p]));
    return json(req, {
      success: true,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate.toISOString(),
        customerName: invoice.customerName,
        customerPhone: invoice.customerPhone,
        items: invoice.items.map(item => {
          const current = statusById.get(item.productId);
          return {
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            size: item.size,
            barcode: item.barcode,
            quantity: item.quantity,
            grossPaise: safePaise(item.grossPaise),
            productDiscountPaise: safePaise(item.productDiscountPaise),
            discountMode: item.discountMode ?? "fixed",
            discountValue: item.discountValue?.toString() ?? "0",
            netPaise: safePaise(item.netPaise),
            sold: current?.sold ?? false,
            returnStatus: current?.returnStatus ?? "UNKNOWN",
            canReturn: item.quantity === 1 && !!current && current.sold && current.returnStatus === "NOT_RETURNED",
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

// POST /api/returns : status change only. Does NOT create credits, refunds or return records.
export async function POST(req: NextRequest) {
  let body: RestoreRequest;
  try {
    body = await req.json();
    if (!body || typeof body.invoiceId !== "string" || !body.invoiceId.trim() ||
      !Array.isArray(body.invoiceItemIds) || body.invoiceItemIds.length < 1 || body.invoiceItemIds.length > 100 ||
      body.invoiceItemIds.some(id => typeof id !== "string" || !id.trim()) ||
      new Set(body.invoiceItemIds).size !== body.invoiceItemIds.length) {
      return json(req, { success: false, error: "Invalid product return selection" }, 400);
    }
  } catch { return json(req, { success: false, error: "Invalid JSON" }, 400); }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async tx => {
        const invoice = await tx.checkoutInvoice.findUnique({
          where: { id: body.invoiceId }, include: { items: true },
        });
        if (!invoice) throw new Error("INVOICE_NOT_FOUND");
        const selected = invoice.items.filter(item => body.invoiceItemIds.includes(item.id));
        if (selected.length !== body.invoiceItemIds.length) throw new Error("ITEM_MISMATCH");
        if (selected.some(item => item.quantity !== 1)) throw new Error("QUANTITY_UNSUPPORTED");
        if (new Set(selected.map(item => item.productId)).size !== selected.length) throw new Error("DUPLICATE_PRODUCT");
        for (const item of selected) {
          const updated = await tx.product.updateMany({
            where: { id: item.productId, sold: true, returnStatus: "NOT_RETURNED" },
            data: { sold: false, returnStatus: "RETURNED" },
          });
          if (updated.count !== 1) throw new Error("ALREADY_RESTORED");
        }
        return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, restoredCount: selected.length, productIds: selected.map(x => x.productId) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 30000 });
      return json(req, { success: true, ...result });
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
      if (code === "P2034" && attempt < 2) continue;
      const msg = error instanceof Error ? error.message : "";
      const messages: Record<string, string> = {
        INVOICE_NOT_FOUND: "Invoice not found",
        ITEM_MISMATCH: "Products do not belong to this invoice",
        QUANTITY_UNSUPPORTED: "Returning multi-quantity lines requires per-unit tracking",
        DUPLICATE_PRODUCT: "Duplicate product found in selection",
        ALREADY_RESTORED: "One or more selected products are already returned or are not sold. Refresh invoice.",
      };
      if (messages[msg]) return json(req, { success: false, error: messages[msg] }, msg === "INVOICE_NOT_FOUND" ? 404 : 409);
      console.error("[RETURNS POST]", error);
      return json(req, { success: false, error: "Unable to restore products" }, 500);
    }
  }
  return json(req, { success: false, error: "Concurrent update, retry" }, 409);
}

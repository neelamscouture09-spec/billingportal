import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { prisma } from "../../../../../lib/prisma";
import { updateProductSchema, formatProduct } from "../../../../../lib/product";
import { corsHeaders, corsOptions } from "../../../../../lib/cors";

type RouteContext = { params: Promise<{ id: string }> };
export const OPTIONS = (request: NextRequest) => corsOptions(request);

export async function PATCH(request: NextRequest, context: RouteContext) {
  const headers = corsHeaders(request);
  const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  try {
    const { id } = await context.params;
    let body: unknown;
    try { body = await request.json(); }
    catch { return respond({ success: false, error: "Invalid JSON body" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return respond({ success: false, error: "Product data must be an object" }, 400);

    const input = body as Record<string, unknown>;
    const parsed = updateProductSchema.safeParse({ ...input, size: "ONE_SIZE" });
    if (!parsed.success)
      return respond({ success: false, error: "Invalid product data", details: parsed.error.flatten() }, 400);
    const data = parsed.data;
    // Stock is edited as a CURRENT on-hand quantity, not as historical openingStock.
    // Reject direct reservedQuantity changes: reservations belong to the trial workflow.
    if (input.reservedQuantity !== undefined)
      return respond({ success: false, error: "Reserved stock cannot be edited manually" }, 400);
    if (input.openingStock !== undefined)
      return respond({ success: false, error: "Edit stockQuantity to change current stock" }, 400);
    const hasStockEdit = input.stockQuantity !== undefined;
    const stockQuantity = input.stockQuantity;
    if (hasStockEdit && (typeof stockQuantity !== "number" || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 2147483647))
      return respond({ success: false, error: "Stock quantity must be a non-negative whole number" }, 400);

    // supplierCode is a Prisma relation, never a plain string field.
    if (input.supplierCode !== undefined)
      return respond({ success: false, error: "Use supplierCodeId instead of supplierCode" }, 400);
    if (input.supplierCodeId !== undefined && input.supplierCodeId !== null && typeof input.supplierCodeId !== "string")
      return respond({ success: false, error: "supplierCodeId must be a string or null" }, 400);
    const supplierCodeId = typeof input.supplierCodeId === "string" ? input.supplierCodeId.trim() || null : null;
    if (input.supplierCodeId !== undefined && supplierCodeId) {
      const relation = await prisma.supplierCode.findUnique({ where: { id: supplierCodeId }, select: { id: true } });
      if (!relation) return respond({ success: false, error: "Supplier code not found" }, 404);
    }

    let product;
    // Optimistic compare-and-swap prevents stale edits from silently overwriting a sale
    // or trial reservation that changed stock after the editor was opened.
    if (hasStockEdit) {
      product = await prisma.$transaction(async tx => {
        const current = await tx.product.findUnique({
          where: { id },
          select: { stockQuantity: true, reservedQuantity: true },
        });
        if (!current) throw new Error("PRODUCT_NOT_FOUND");
        const requested = stockQuantity as number;
        if (requested < current.reservedQuantity) throw new Error("STOCK_BELOW_RESERVED");
        const result = await tx.product.updateMany({
          where: {
            id,
            stockQuantity: current.stockQuantity,
            reservedQuantity: current.reservedQuantity,
          },
          data: {
            stockQuantity: requested,
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.sellingPrice !== undefined ? { sellingPrice: new Prisma.Decimal(data.sellingPrice) } : {}),
            ...(input.supplierCodeId !== undefined ? { supplierCodeId } : {}),
          },
        });
        if (result.count !== 1) throw new Error("STOCK_CHANGED_RETRY");
        return tx.product.findUniqueOrThrow({
          where: { id },
          include: { supplierCode: { include: { supplier: true } } },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
    } else {
      product = await prisma.product.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.sellingPrice !== undefined ? { sellingPrice: new Prisma.Decimal(data.sellingPrice) } : {}),
          ...(input.supplierCodeId !== undefined ? { supplierCodeId } : {}),
        },
        include: { supplierCode: { include: { supplier: true } } },
      });
    }
    const result = { ...formatProduct(product), stockQuantity: product.stockQuantity, reservedQuantity: product.reservedQuantity, availableStock: Math.max(0, product.stockQuantity - product.reservedQuantity) };
    return respond({ success: true, message: "Product updated successfully", product: result });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "PRODUCT_NOT_FOUND") return respond({ success: false, error: "Product not found" }, 404);
      if (error.message === "STOCK_BELOW_RESERVED") return respond({ success: false, error: "Stock cannot be lower than units reserved for open trials" }, 409);
      if (error.message === "STOCK_CHANGED_RETRY") return respond({ success: false, error: "Stock changed during this update. Refresh and try again" }, 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return respond({ success: false, error: "Product not found" }, 404);
      if (error.code === "P2002") return respond({ success: false, error: "Barcode already exists" }, 409);
      if (error.code === "P2034") return respond({ success: false, error: "Stock changed while saving. Refresh and retry" }, 409);
      if (error.code === "P2003") return respond({ success: false, error: "Invalid supplier code reference" }, 400);
    }
    console.error("[UPDATE PRODUCT]", error);
    return respond({ success: false, error: "Failed to update product" }, 500);
  }
}

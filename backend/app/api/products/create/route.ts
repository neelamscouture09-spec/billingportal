import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../../lib/prisma";
import { createProductSchema, formatProduct } from "../../../../lib/product";
import { reserveProductBarcodes } from "../../../../lib/barcode";
import { corsHeaders, corsOptions } from "../../../../lib/cors";

export const OPTIONS = (request: NextRequest) => corsOptions(request);

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request);
  const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { return respond({ success: false, error: "Invalid JSON body" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return respond({ success: false, error: "Product data must be an object" }, 400);

    const input = body as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(input, "barcode"))
      return respond({ success: false, error: "Do not send barcode. It is generated automatically." }, 400);
    if (input.supplierCode !== undefined && input.supplierCode !== null && input.supplierCode !== "")
      return respond({ success: false, error: "Use supplierCodeId instead of supplierCode" }, 400);

    // Preserve compatibility with the existing createProductSchema, which may
    // still require category. The cashier never enters a category.
    const parsed = createProductSchema.safeParse({ ...input, size: "ONE_SIZE", category: "Uncategorized" });
    if (!parsed.success)
      return respond({ success: false, error: "Invalid product data", details: parsed.error.flatten() }, 400);
    const data = parsed.data;
    // Quantity is required for the new grouped-product workflow.
    const requestedStock = input.openingStock;
    if (typeof requestedStock !== "number" || !Number.isSafeInteger(requestedStock) || requestedStock < 0 || requestedStock > 2147483647)
      return respond({ success: false, error: "Opening stock must be a non-negative whole number" }, 400);

    const rawSupplierCodeId = input.supplierCodeId;
    if (rawSupplierCodeId !== undefined && rawSupplierCodeId !== null && typeof rawSupplierCodeId !== "string")
      return respond({ success: false, error: "supplierCodeId must be a string or null" }, 400);
    const supplierCodeId = typeof rawSupplierCodeId === "string" ? rawSupplierCodeId.trim() || null : null;

    const product = await prisma.$transaction(async tx => {
      if (supplierCodeId) {
        const supplierCode = await tx.supplierCode.findUnique({ where: { id: supplierCodeId }, select: { id: true } });
        if (!supplierCode) throw new Error("SUPPLIER_CODE_NOT_FOUND");
      }
      const [barcode] = await reserveProductBarcodes(tx, 1);
      return tx.product.create({
        data: {
          name: data.name, size: "ONE_SIZE", category: "Uncategorized",
          supplierCodeId,
          sellingPrice: new Prisma.Decimal(data.sellingPrice),
          openingStock: requestedStock, stockQuantity: requestedStock, reservedQuantity: 0,
          barcode, sold: false,
        },
        include: { supplierCode: { include: { supplier: true } } },
      });
    }, { maxWait: 10000, timeout: 20000 });

    const result = { ...formatProduct(product), stockQuantity: product.stockQuantity, reservedQuantity: product.reservedQuantity, availableStock: product.stockQuantity - product.reservedQuantity };
    return respond({ success: true, message: "Product created successfully", product: result }, 201);
  } catch (error) {
    console.error("[CREATE PRODUCT ERROR]", error);
    if (error instanceof Error && error.message === "SUPPLIER_CODE_NOT_FOUND")
      return respond({ success: false, error: "Selected supplier code does not exist. Refresh suppliers and try again." }, 404);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return respond({ success: false, error: "A duplicate unique value was detected" }, 409);
      if (error.code === "P2003") return respond({ success: false, error: "Invalid supplier code reference" }, 400);
    }
    return respond({ success: false, error: "Failed to create product" }, 500);
  }
}

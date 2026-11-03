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
    const parsed = updateProductSchema.safeParse(input);
    if (!parsed.success)
      return respond({ success: false, error: "Invalid product data", details: parsed.error.flatten() }, 400);
    const data = parsed.data;

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

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.size !== undefined ? { size: data.size } : {}),
        ...(data.sellingPrice !== undefined ? { sellingPrice: new Prisma.Decimal(data.sellingPrice) } : {}),
        ...(data.openingStock !== undefined ? { openingStock: data.openingStock } : {}),
        ...(data.sold !== undefined ? { sold: data.sold } : {}),
        ...(input.supplierCodeId !== undefined ? { supplierCodeId } : {}),
      },
      include: { supplierCode: { include: { supplier: true } } },
    });
    const result = formatProduct(product);
    return respond({ success: true, message: "Product updated successfully", product: result });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return respond({ success: false, error: "Product not found" }, 404);
      if (error.code === "P2002") return respond({ success: false, error: "Barcode already exists" }, 409);
      if (error.code === "P2003") return respond({ success: false, error: "Invalid supplier code reference" }, 400);
    }
    console.error("[UPDATE PRODUCT]", error);
    return respond({ success: false, error: "Failed to update product" }, 500);
  }
}

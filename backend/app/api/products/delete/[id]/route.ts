// backend/app/api/products/delete/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { prisma } from "../../../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../../../lib/cors";

type RouteContext = { params: Promise<{ id: string }> };
export const OPTIONS = (request: NextRequest) => corsOptions(request);

export async function DELETE(request: NextRequest, context: RouteContext) {
  const headers = corsHeaders(request);
  const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  try {
    const { id } = await context.params;
    const result = await prisma.$transaction(async tx => {
      const product = await tx.product.findUnique({
        where: { id },
        select: { id: true, stockQuantity: true, reservedQuantity: true },
      });
      if (!product) return "NOT_FOUND";
      if (product.stockQuantity > 0 || product.reservedQuantity > 0) return "HAS_STOCK";

      // Invoice rows keep historical product IDs as scalar fields; no FK protects them.
      const [saleCount, trialCount, returnCount] = await Promise.all([
        tx.checkoutItem.count({ where: { productId: id } }),
        tx.trialItem.count({ where: { productId: id } }),
        tx.returnLine.count({ where: { productId: id } }),
      ]);
      if (saleCount || trialCount || returnCount) return "HAS_HISTORY";

      // Re-check live quantity in the conditional delete; avoid deleting a restocked item.
      const deleted = await tx.product.deleteMany({
        where: { id, stockQuantity: 0, reservedQuantity: 0 },
      });
      return deleted.count === 1 ? "DELETED" : "CHANGED";
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 30000 });

    if (result === "NOT_FOUND") return respond({ success: false, error: "Product not found" }, 404);
    if (result === "HAS_STOCK") return respond({ success: false, error: "Cannot delete a product with stock or reserved trial units. Adjust stock first." }, 409);
    if (result === "HAS_HISTORY") return respond({ success: false, error: "Cannot delete a product referenced by sales, returns or trials. Keep it for history." }, 409);
    if (result === "CHANGED") return respond({ success: false, error: "Stock changed while deleting. Refresh and retry." }, 409);
    return respond({ success: true, message: "Product deleted successfully", deletedProductId: id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2034") return respond({ success: false, error: "Concurrent stock update. Retry." }, 409);
      if (error.code === "P2003") return respond({ success: false, error: "Product is referenced by another record" }, 409);
    }
    console.error("[DELETE PRODUCT]", error);
    return respond({ success: false, error: "Failed to delete product" }, 500);
  }
}

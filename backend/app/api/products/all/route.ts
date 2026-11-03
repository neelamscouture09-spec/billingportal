import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../../lib/prisma";
import { formatProduct } from "../../../../lib/product";
import { corsHeaders, corsOptions } from "../../../../lib/cors";

export const OPTIONS = (req: NextRequest) => corsOptions(req);

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request);
  try {
    const params = request.nextUrl.searchParams;
    const sold = params.get("sold") ?? "false";
    const onTrial = params.get("onTrial") ?? "false";
    if (!["true", "false", "all"].includes(sold) || !["true", "false", "all"].includes(onTrial)) {
      return NextResponse.json({ success: false, error: "sold/onTrial must be true, false or all" }, { status: 400, headers });
    }
    const search = params.get("search")?.trim() || "";
    const barcode = params.get("barcode")?.trim() || "";
    const size = params.get("size")?.trim() || "";
    const supplierName = params.get("supplierName")?.trim() || "";
    const supplierCode = params.get("supplierCode")?.trim() || "";
    const supplierCodeId = params.get("supplierCodeId")?.trim() || "";

    const where: Prisma.ProductWhereInput = {
      ...(sold !== "all" ? { sold: sold === "true" } : {}),
      ...(onTrial !== "all" ? { onTrial: onTrial === "true" } : {}),
      ...(barcode ? { barcode } : {}),
      ...(supplierCodeId ? { supplierCodeId } : {}),
      ...(size ? { size: { equals: size, mode: "insensitive" } } : {}),
      ...(supplierCode || supplierName ? { supplierCode: { is: {
        ...(supplierCode ? { code: { equals: supplierCode, mode: "insensitive" as const } } : {}),
        ...(supplierName ? { supplier: { is: { name: { equals: supplierName, mode: "insensitive" as const } } } } : {}),
      } } } : {}),
      ...(search ? { AND: [{ OR: [
        { name: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
        { size: { contains: search, mode: "insensitive" } },
        { supplierCode: { is: { code: { contains: search, mode: "insensitive" } } } },
        { supplierCode: { is: { supplier: { is: { name: { contains: search, mode: "insensitive" } } } } } },
      ] }] } : {}),
    };

    const products = await prisma.product.findMany({
      where,
      include: { supplierCode: { include: { supplier: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      count: products.length,
      products: products.map(p => {
        // Keep category only as an internal compatibility field for existing
        // Home/Trials consumers. The Products page never shows or edits it.
        const formatted = formatProduct(p);
        return {
          ...formatted, sold: p.sold, onTrial: p.onTrial, returnStatus: p.returnStatus,
          supplierCodeId: p.supplierCodeId,
          supplierCode: p.supplierCode ? {
            id: p.supplierCode.id, code: p.supplierCode.code,
            supplierId: p.supplierCode.supplierId, supplier: p.supplierCode.supplier,
          } : null,
          supplierName: p.supplierCode?.supplier.name ?? null,
          supplierCodeValue: p.supplierCode?.code ?? null,
        };
      }),
    }, { status: 200, headers });
  } catch (error) {
    console.error("[PRODUCTS GET]", error);
    return NextResponse.json({ success: false, error: "Failed to fetch products" }, { status: 500, headers });
  }
}

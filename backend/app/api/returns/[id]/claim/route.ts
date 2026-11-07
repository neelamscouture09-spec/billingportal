// Manual claim: marks the return credit used after staff completes a new sale.
// Deliberately NOT linked to checkout, as requested. Never transfers money.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../../../lib/cors";

export const OPTIONS = (req: NextRequest) => corsOptions(req);
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 100) return NextResponse.json({ success: false, error: "Invalid return ID" }, { status: 400, headers: corsHeaders(req) });
  try {
    // Database conditional update ensures two clicks from different browsers cannot both claim.
    const updated = await prisma.returnCredit.updateMany({
      where: { batchId: id, usedAt: null, usedByInvoiceId: null },
      data: { usedAt: new Date() },
    });
    if (updated.count === 1) {
      const credit = await prisma.returnCredit.findUnique({ where: { batchId: id }, select: { usedAt: true } });
      return NextResponse.json({ success: true, status: "CLAIMED", claimedAt: credit?.usedAt?.toISOString() }, { headers: corsHeaders(req) });
    }
    const current = await prisma.returnCredit.findUnique({ where: { batchId: id }, select: { usedAt: true, usedByInvoiceId: true } });
    return NextResponse.json({ success: false, error: current ? "This return has already been claimed" : "Return credit not found (older stock-only return)" }, { status: current ? 409 : 404, headers: corsHeaders(req) });
  } catch (error) {
    console.error("[RETURN CLAIM]", error);
    return NextResponse.json({ success: false, error: "Unable to mark return as claimed" }, { status: 500, headers: corsHeaders(req) });
  }
}

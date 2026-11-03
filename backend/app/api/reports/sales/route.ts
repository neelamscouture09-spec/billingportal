// backend/app/api/reports/sales/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../../lib/cors";


export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

function response(request: NextRequest, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}
function toISTStart(value: string) {
  return new Date(`${value}T00:00:00+05:30`);
}
function toISTNextDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  // India is UTC+05:30 year-round, so the next midnight in IST is UTC 18:30.
  return new Date(Date.UTC(year, month - 1, day + 1, -5, -30));
}
function money(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) throw new Error("Invoice monetary amount exceeds supported precision");
  return converted;
}

// GET /api/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD
// Dates are inclusive and interpreted in Asia/Kolkata.
// Omitting both dates returns all saved checkout invoices.
export async function GET(request: NextRequest) {
  try {
    const from = request.nextUrl.searchParams.get("from")?.trim() || "";
    const to = request.nextUrl.searchParams.get("to")?.trim() || "";
    if ((from && !validDate(from)) || (to && !validDate(to))) {
      return response(request, { success: false, error: "from and to must be valid YYYY-MM-DD dates" }, 400);
    }
    if (from && to && from > to) {
      return response(request, { success: false, error: "From date cannot be after To date" }, 400);
    }

    const invoiceDate = {
      ...(from ? { gte: toISTStart(from) } : {}),
      ...(to ? { lt: toISTNextDay(to) } : {}),
    };

    const invoices = await prisma.checkoutInvoice.findMany({
      where: {
        ...(from || to ? { invoiceDate } : {}),
        paymentStatus: "PAID",
      },
      include: {
        items: { orderBy: { productName: "asc" } },
        tenders: { orderBy: { method: "asc" } },
      },
      orderBy: [{ invoiceDate: "desc" }, { invoiceSequence: "desc" }],
    });

    const rows = invoices.map(invoice => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString(),
      createdAt: invoice.createdAt.toISOString(),
      status: invoice.paymentStatus,
      customerName: invoice.customerName || "Walk-in customer",
      customerPhone: invoice.customerPhone,
      customerEmail: invoice.customerEmail,
      customerAddress: invoice.customerAddress,
      subtotalPaise: money(invoice.subtotalPaise),
      productDiscountPaise: money(invoice.productDiscountPaise),
      billDiscountPaise: money(invoice.billDiscountPaise),
      totalDiscountPaise: money(invoice.totalDiscountPaise),
      totalPaise: money(invoice.totalPaise),
      paidPaise: money(invoice.paidPaise),
      changePaise: money(invoice.changePaise),
      billDiscountMode: invoice.billDiscountMode,
      billDiscountValue: invoice.billDiscountValue.toString(),
      itemsCount: invoice.items.reduce((total, item) => total + item.quantity, 0),
      items: invoice.items.map(item => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        barcode: item.barcode,
        size: item.size,
        category: item.category,
        supplierName: item.supplierName,
        supplierCode: item.supplierCode,
        quantity: item.quantity,
        unitPricePaise: money(item.unitPricePaise),
        grossPaise: money(item.grossPaise),
        productDiscountPaise: money(item.productDiscountPaise),
        discountMode: item.discountMode,
        discountValue: item.discountValue?.toString() ?? null,
        netPaise: money(item.netPaise),
      })),
      tenders: invoice.tenders.map(tender => ({
        method: tender.method,
        amountPaise: money(tender.amountPaise),
      })),
    }));

    const summary = rows.reduce((totals, row) => {
      totals.transactions += 1;
      totals.totalSalesPaise += row.subtotalPaise;
      totals.productDiscountPaise += row.productDiscountPaise;
      totals.billDiscountPaise += row.billDiscountPaise;
      totals.totalDiscountsPaise += row.totalDiscountPaise;
      totals.revenuePaise += row.totalPaise;
      totals.receivedPaise += row.paidPaise - row.changePaise;
      totals.itemsSold += row.itemsCount;
      for (const tender of row.tenders) {
        totals.paymentsByMethod[tender.method] = (totals.paymentsByMethod[tender.method] ?? 0) + tender.amountPaise;
      }
      return totals;
    }, {
      transactions: 0, totalSalesPaise: 0, productDiscountPaise: 0,
      billDiscountPaise: 0, totalDiscountsPaise: 0, revenuePaise: 0,
      receivedPaise: 0, itemsSold: 0, paymentsByMethod: {} as Record<string, number>,
    });

    return response(request, {
      success: true,
      from: from || null,
      to: to || null,
      timeZone: "Asia/Kolkata",
      count: rows.length,
      summary: {
        ...summary,
        averageOrderPaise: summary.transactions ? Math.round(summary.revenuePaise / summary.transactions) : 0,
      },
      invoices: rows,
    });
  } catch (error) {
    console.error("[SALES REPORT API]", error);
    return response(request, { success: false, error: "Unable to load saved invoice report" }, 500);
  }
}

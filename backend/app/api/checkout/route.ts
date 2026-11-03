// backend/app/api/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../lib/cors";


const MAX_ITEMS = 100;
const PAYMENT_METHODS = new Set(["Cash", "Card", "UPI", "Bank Transfer", "Other"]);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
type Mode = "fixed" | "percent";

type CheckoutItemInput = {
  productId: string;
  quantity: number;
  productDiscountPaise: number;
  discountMode?: Mode | null;
  discountValue?: number | null;
};
type CheckoutBody = {
  requestId: string;
  customer: { name: string; phone: string; email: string; address: string };
  items: CheckoutItemInput[];
  billDiscountMode: Mode;
  // fixed = amount in paise, percent = percentage (e.g. 10.5)
  billDiscountValue: number;
  // returned merchandise credit, amount in paise; optional for older POS clients
  returnedDiscountPaise?: number;
  tenders: { method: string; amountPaise: number }[];
};

type SavedInvoice = Prisma.CheckoutInvoiceGetPayload<{
  include: { items: true; tenders: true };
}>;

function json(req: NextRequest, value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: corsHeaders(req) });
}
export async function OPTIONS(req: NextRequest) {
  return corsOptions(req);
}

class CheckoutError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

function isNonnegativeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}
function valid2dp(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 &&
    new Prisma.Decimal(x.toString()).decimalPlaces() <= 2;
}
function validate(value: unknown): CheckoutBody {
  if (!value || typeof value !== "object") throw new CheckoutError("Checkout request must be an object");
  const b = value as Partial<CheckoutBody>;
  if (typeof b.requestId !== "string" || !/^[\w-]{8,100}$/.test(b.requestId))
    throw new CheckoutError("Invalid requestId (8–100 letters, digits, underscores or hyphens)");
  if (!b.customer || typeof b.customer !== "object" ||
      !["name", "phone", "email", "address"].every(k => typeof (b.customer as unknown as Record<string, unknown>)[k] === "string"))
    throw new CheckoutError("Customer name, phone, email and address must be strings");
  const c = b.customer;
  if (c.name.length > 200 || c.phone.length > 30 || c.email.length > 250 || c.address.length > 5000)
    throw new CheckoutError("Customer field exceeds its maximum length");
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEMS)
    throw new CheckoutError(`Provide 1–${MAX_ITEMS} products`);
  const ids = new Set<string>();
  for (const [index, item] of b.items.entries()) {
    if (!item || typeof item.productId !== "string" || !item.productId ||
        !isNonnegativeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000 ||
        !isNonnegativeInteger(item.productDiscountPaise))
      throw new CheckoutError(`Invalid product ID, quantity or discount on item ${index + 1}`);
    if (ids.has(item.productId)) throw new CheckoutError("Duplicate product ID in cart; combine quantities");
    ids.add(item.productId);
    if (item.discountMode != null && item.discountMode !== "fixed" && item.discountMode !== "percent")
      throw new CheckoutError(`Invalid discount mode on item ${index + 1}`);
    if (item.discountValue != null && !valid2dp(item.discountValue))
      throw new CheckoutError(`Invalid discount value on item ${index + 1}`);
    if (item.discountMode === "percent" && item.discountValue != null && item.discountValue > 100)
      throw new CheckoutError(`Product discount percent exceeds 100 on item ${index + 1}`);
  }
  if (b.billDiscountMode !== "fixed" && b.billDiscountMode !== "percent")
    throw new CheckoutError("Invalid bill discount mode");
  if (b.billDiscountMode === "fixed" ? !isNonnegativeInteger(b.billDiscountValue) :
      !valid2dp(b.billDiscountValue) || b.billDiscountValue > 100)
    throw new CheckoutError("Invalid bill discount value; fixed must be paise, percent up to 100");
  if (b.returnedDiscountPaise !== undefined && !isNonnegativeInteger(b.returnedDiscountPaise))
    throw new CheckoutError("returnedDiscountPaise must be a non-negative integer amount in paise");
  if (!Array.isArray(b.tenders) || b.tenders.length > PAYMENT_METHODS.size)
    throw new CheckoutError("Invalid payment methods");
  const methods = new Set<string>();
  for (const tender of b.tenders) {
    if (!tender || !PAYMENT_METHODS.has(tender.method) ||
        !isNonnegativeInteger(tender.amountPaise) || tender.amountPaise <= 0 || methods.has(tender.method))
      throw new CheckoutError("Invalid or duplicate payment method/amount");
    methods.add(tender.method);
  }
  return b as CheckoutBody;
}

function istDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}
function decimalPercent(base: bigint, percent: number): bigint {
  return BigInt(new Prisma.Decimal(base.toString())
    .mul(percent.toString()).div(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}
function safe(value: bigint) {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new CheckoutError("Amount exceeds supported limits");
  return Number(value);
}

// This one serializer is used for both POST success and GET, so item-level
// discounts and totals are identical regardless of which endpoint was called.
function serialize(invoice: SavedInvoice) {
  const items = invoice.items.map(item => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    name: item.productName, // compatibility with older receipt page
    barcode: item.barcode,
    size: item.size,
    category: item.category,
    supplierName: item.supplierName,
    supplierCode: item.supplierCode,
    supplierCodeId: item.supplierCodeId,
    quantity: item.quantity,
    unitPricePaise: safe(item.unitPricePaise),
    grossPaise: safe(item.grossPaise),
    productDiscountPaise: safe(item.productDiscountPaise),
    discountMode: item.discountMode,
    discountValue: item.discountValue.toString(),
    netPaise: safe(item.netPaise),
  }));
  const tenders = invoice.tenders.map(t => ({
    method: t.method,
    amountPaise: safe(t.amountPaise),
  }));
  return {
    id: invoice.id,
    requestId: invoice.requestId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString(),
    createdAt: invoice.createdAt.toISOString(),
    invoiceDateKey: invoice.invoiceDateKey,
    invoiceSequence: invoice.invoiceSequence,
    paymentStatus: invoice.paymentStatus,
    status: invoice.paymentStatus,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone,
    customerEmail: invoice.customerEmail,
    customerAddress: invoice.customerAddress,
    customer: {
      name: invoice.customerName,
      phone: invoice.customerPhone,
      email: invoice.customerEmail,
      address: invoice.customerAddress,
    },
    subtotalPaise: safe(invoice.subtotalPaise),
    productDiscountPaise: safe(invoice.productDiscountPaise),
    billDiscountMode: invoice.billDiscountMode,
    billDiscountValue: invoice.billDiscountValue.toString(),
    billDiscountPaise: safe(invoice.billDiscountPaise),
    returnedDiscountPaise: safe(invoice.returnedDiscountPaise),
    totalDiscountPaise: safe(invoice.totalDiscountPaise),
    totalPaise: safe(invoice.totalPaise),
    paidPaise: safe(invoice.paidPaise),
    changePaise: safe(invoice.changePaise),
    itemsCount: items.reduce((n, item) => n + item.quantity, 0),
    items,
    tenders,
  };
}

async function existingByRequestId(requestId: string) {
  return prisma.checkoutInvoice.findUnique({
    where: { requestId }, include: { items: true, tenders: true },
  });
}

export async function POST(req: NextRequest) {
  let body: CheckoutBody;
  try {
    body = validate(await req.json());
  } catch (error) {
    return json(req, { success: false, error: error instanceof Error ? error.message : "Invalid JSON" },
      error instanceof CheckoutError ? error.status : 400);
  }
  try {
    const prior = await existingByRequestId(body.requestId);
    if (prior) return json(req, { success: true, alreadyProcessed: true, purchase: serialize(prior) });
  } catch (error) {
    console.error("[CHECKOUT LOOKUP]", error);
    return json(req, { success: false, error: "Unable to verify checkout request ID" }, 503);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const invoice = await prisma.$transaction(async tx => {
        const products = await tx.product.findMany({
          where: { id: { in: body.items.map(i => i.productId) } },
          include: { supplierCode: { include: { supplier: true } } },
        });
        const productMap = new Map(products.map(p => [p.id, p]));
        const entries = body.items.map((item, index) => {
          const product = productMap.get(item.productId);
          if (!product || product.sold || product.onTrial) throw new CheckoutError(`Unavailable product at row ${index + 1}`, 409);
          const price = new Prisma.Decimal(product.sellingPrice.toString()).mul(100);
          if (!price.isInteger()) throw new CheckoutError(`Invalid price for ${product.name}`);
          const unit = BigInt(price.toFixed(0));
          const gross = unit * BigInt(item.quantity);
          const discount = BigInt(item.productDiscountPaise);
          if (discount > gross) throw new CheckoutError(`Discount exceeds gross price for ${product.name}`);

          // Mandatory stored discount metadata; infer fixed rupee value for
          // legacy POS clients that only send productDiscountPaise.
          let mode: Mode = item.discountMode ?? "fixed";
          let inputValue: Prisma.Decimal;
          if (item.discountValue == null || item.discountMode == null) {
            mode = "fixed";
            inputValue = new Prisma.Decimal(discount.toString()).div(100);
          } else {
            inputValue = new Prisma.Decimal(item.discountValue.toString());
            const calculated = mode === "percent"
              ? decimalPercent(gross, item.discountValue)
              : BigInt(inputValue.mul(100).toFixed(0));
            if (calculated !== discount)
              throw new CheckoutError(`Discount mode/value and discount amount do not match for ${product.name}`);
          }
          return { item, product, unit, gross, discount, mode, inputValue, net: gross - discount };
        });

        const subtotal = entries.reduce((s, e) => s + e.gross, BigInt(0));
        const productDiscount = entries.reduce((s, e) => s + e.discount, BigInt(0));
        const afterProducts = subtotal - productDiscount;
        const billDiscount = body.billDiscountMode === "fixed"
          ? BigInt(body.billDiscountValue)
          : decimalPercent(afterProducts, body.billDiscountValue);
        if (billDiscount > afterProducts) throw new CheckoutError("Bill discount exceeds available amount");
        const afterBill = afterProducts - billDiscount;
        const returnedDiscount = BigInt(body.returnedDiscountPaise ?? 0);
        if (returnedDiscount > afterBill)
          throw new CheckoutError("Returned discount cannot exceed amount remaining after other discounts");
        const totalDiscount = productDiscount + billDiscount + returnedDiscount;
        const total = subtotal - totalDiscount;
        const paid = body.tenders.reduce((s, t) => s + BigInt(t.amountPaise), BigInt(0));
        if (paid < total) throw new CheckoutError("Payment does not cover final payable");
        const change = paid - total;
        const cashPaid = BigInt(body.tenders.find(t => t.method === "Cash")?.amountPaise ?? 0);
        if (change > cashPaid) throw new CheckoutError("Change can only come from cash tender");
        for (const amount of [subtotal, productDiscount, billDiscount, returnedDiscount, totalDiscount, total, paid, change]) safe(amount);

        // One product record is one saleable item; intentionally no stock updates.
        for (const entry of entries) {
          const changed = await tx.product.updateMany({
            where: { id: entry.product.id, sold: false, onTrial: false }, data: { sold: true },
          });
          if (changed.count !== 1) throw new CheckoutError(`Already sold: ${entry.product.name}`, 409);
        }

        const invoiceDate = new Date();
        const invoiceDateKey = istDay(invoiceDate);
        const counter = await tx.invoiceCounter.upsert({
          where: { dateKey: invoiceDateKey },
          create: { dateKey: invoiceDateKey, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const invoiceNumber = `NEEL-${invoiceDateKey}-${String(counter.lastNumber).padStart(3, "0")}`;
        return tx.checkoutInvoice.create({
          data: {
            requestId: body.requestId, invoiceNumber, invoiceDate, invoiceDateKey,
            invoiceSequence: counter.lastNumber,
            customerName: body.customer.name.trim(),
            customerPhone: body.customer.phone.trim(),
            customerEmail: body.customer.email.trim(),
            customerAddress: body.customer.address.trim(),
            subtotalPaise: subtotal,
            productDiscountPaise: productDiscount,
            billDiscountMode: body.billDiscountMode,
            billDiscountValue: new Prisma.Decimal(body.billDiscountValue.toString()),
            billDiscountPaise: billDiscount,
            returnedDiscountPaise: returnedDiscount,
            totalDiscountPaise: totalDiscount,
            totalPaise: total,
            paidPaise: paid,
            changePaise: change,
            paymentStatus: "PAID",
            items: {
              create: entries.map(e => ({
                productId: e.product.id, productName: e.product.name,
                barcode: e.product.barcode, size: e.product.size,
                category: e.product.category,
                supplierName: e.product.supplierCode?.supplier.name ?? null,
                supplierCode: e.product.supplierCode?.code ?? null,
                supplierCodeId: e.product.supplierCodeId,
                quantity: e.item.quantity,
                unitPricePaise: e.unit,
                grossPaise: e.gross,
                productDiscountPaise: e.discount,
                discountMode: e.mode,
                discountValue: e.inputValue,
                netPaise: e.net,
              })),
            },
            tenders: {
              create: body.tenders.map(t => ({
                method: t.method, amountPaise: BigInt(t.amountPaise),
              })),
            },
          },
          include: { items: true, tenders: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 60000 });
      return json(req, { success: true, message: "Payment completed", purchase: serialize(invoice) }, 201);
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
      if (code === "P2034" && attempt < 2) continue;
      if (code === "P2002") {
        try {
          const prior = await existingByRequestId(body.requestId);
          if (prior) return json(req, { success: true, alreadyProcessed: true, purchase: serialize(prior) });
        } catch (lookupError) {
          console.error("[CHECKOUT CONFLICT LOOKUP]", lookupError);
        }
        if (attempt < 2) continue;
      }
      if (error instanceof CheckoutError)
        return json(req, { success: false, error: error.message }, error.status);
      console.error("[CHECKOUT POST]", error);
      return json(req, { success: false, error: "Checkout failed. No partial invoice or product-status changes were committed." }, code === "P2034" ? 409 : 500);
    }
  }
  return json(req, { success: false, error: "Concurrent checkout conflict; retry with the same requestId" }, 409);
}

// GET /api/checkout?invoiceId=<uuid> OR ?invoiceNumber=NEEL-YYYYMMDD-001
export async function GET(req: NextRequest) {
  const invoiceId = req.nextUrl.searchParams.get("invoiceId")?.trim();
  const invoiceNumber = req.nextUrl.searchParams.get("invoiceNumber")?.trim();
  if (!invoiceId && !invoiceNumber)
    return json(req, { success: false, error: "Provide invoiceId or invoiceNumber" }, 400);
  try {
    const invoice = await prisma.checkoutInvoice.findUnique({
      where: invoiceId ? { id: invoiceId } : { invoiceNumber: invoiceNumber! },
      include: { items: true, tenders: true },
    });
    if (!invoice) return json(req, { success: false, error: "Invoice not found" }, 404);
    return json(req, { success: true, invoice: serialize(invoice) });
  } catch (error) {
    console.error("[CHECKOUT GET]", error);
    return json(req, { success: false, error: "Unable to retrieve invoice" }, 500);
  }
}

// Shared A5 receipt renderer for the Sales Reports and checkout payment-success screens.
// Print mode uses white A5 paper with thin blue rules, without the branded header.
// Download mode retains the existing branded JPEG background.
const TIME_ZONE = "Asia/Kolkata";

export type ReceiptItem = {
  productName: string;
  barcode: string;
  size?: string | null;
  quantity: number;
  unitPricePaise: number;
  productDiscountPaise: number;
  netPaise: number;
};

export type ReceiptInvoice = {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  subtotalPaise: number;
  productDiscountPaise: number;
  billDiscountPaise: number;
  returnedDiscountPaise?: number;
  totalDiscountPaise: number;
  totalPaise: number;
  paidPaise: number;
  changePaise: number;
  items: ReceiptItem[];
  tenders: {method: string; amountPaise: number}[];
};

function dateLabel(timestamp: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date(timestamp));
}

function returnedAmount(invoice: ReceiptInvoice): number {
  if (invoice.returnedDiscountPaise !== null && invoice.returnedDiscountPaise !== undefined) {
    return Math.max(0, Number(invoice.returnedDiscountPaise) || 0);
  }
  const amounts = [invoice.subtotalPaise, invoice.productDiscountPaise,
    invoice.billDiscountPaise, invoice.totalPaise];
  if (!amounts.every(Number.isSafeInteger)) return 0;
  return Math.max(0, invoice.subtotalPaise - invoice.productDiscountPaise -
    invoice.billDiscountPaise - invoice.totalPaise);
}

// Copy the user-provided A5 JPEG to frontend/public/neelams_receipt_a5.jpg.

// The original design includes the GSTIN, logo, watermark, footer and shop address.

const RECEIPT_BACKGROUND = "/neelams_receipt_a5.jpg";

const A5_WIDTH_MM = 148;

const A5_HEIGHT_MM = 210;

let receiptBackgroundCache: Promise<string> | null = null;

async function receiptBackgroundData(): Promise<string> {

  if (!receiptBackgroundCache) {

    receiptBackgroundCache = (async () => {

      const response = await fetch(RECEIPT_BACKGROUND, { cache: "force-cache" });

      if (!response.ok) {

        throw new Error("A5 receipt background missing. Copy neelams_receipt_a5.jpg to frontend/public/");

      }

      const blob = await response.blob();

      return await new Promise<string>((resolve, reject) => {

        const reader = new FileReader();

        reader.onload = () => resolve(String(reader.result));

        reader.onerror = () => reject(new Error("Unable to load A5 receipt background"));

        reader.readAsDataURL(blob);

      });

    })().catch((error) => {

      receiptBackgroundCache = null;

      throw error;

    });

  }

  return receiptBackgroundCache;

}

// A5 portrait receipt. The branded JPG already contains the top separator

// under BILL OF SUPPLY; do not draw over it.

const MAX_RECEIPT_ITEMS_PER_PAGE = 5;

const RECEIPT_BLUE: [number, number, number] = [12, 58, 140];

const RECEIPT_RULE: [number, number, number] = [170, 187, 215];

function paginateReceiptItems(items: ReceiptItem[]): ReceiptItem[][] {

  if (items.length === 0) return [[]];

  const pages: ReceiptItem[][] = [];

  for (let i = 0; i < items.length; i += MAX_RECEIPT_ITEMS_PER_PAGE) {

    pages.push(items.slice(i, i + MAX_RECEIPT_ITEMS_PER_PAGE));

  }

  return pages;

}

export async function buildReceiptPdf(invoice: ReceiptInvoice, includeBackground = true) {

  const { default: jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5", compress: true });

  const background = includeBackground ? await receiptBackgroundData() : null;

  const pages = paginateReceiptItems(invoice.items);

  const left = 8;

  const right = A5_WIDTH_MM - 8;

  const money = (paise: number) => `Rs. ${(paise / 100).toFixed(2)}`;

  const draw = (value: string, x: number, y: number, align?: "right" | "center") => {

    doc.text(value, x, y, align ? { align } : undefined);

  };

  const summaryRow = (label: string, value: string, y: number, bold = false, fontSize = 7.6) => {

    doc.setFont("helvetica", bold ? "bold" : "normal");

    doc.setFontSize(fontSize);

    draw(label, left + 1, y);

    draw(value, right - 1, y, "right");

  };

  let serial = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {

    if (pageIndex > 0) doc.addPage("a5", "portrait");

    // Print: blank white A5 sheet; keep existing content positions and draw divider lines.
    // All invoice, customer, item and totals coordinates remain unchanged.
    // Download: the existing branded JPEG remains as before.
    if (background) {
      doc.addImage(background, "JPEG", 0, 0, A5_WIDTH_MM, A5_HEIGHT_MM);
    }

    doc.setTextColor(...RECEIPT_BLUE);

    doc.setDrawColor(...RECEIPT_RULE);

    doc.setLineWidth(0.16);

    // The template's branded separator is at about 43 mm.

    // Invoice and date MUST be on the same baseline, below that separator.

    const invoiceBaseline = 50;

    doc.setFont("helvetica", "bold");

    doc.setFontSize(8.5);

    draw(`INVOICE: ${invoice.invoiceNumber}`, left, invoiceBaseline);

    doc.setFont("helvetica", "normal");

    doc.setFontSize(7.6);

    draw(dateLabel(invoice.invoiceDate), right, invoiceBaseline, "right");

    if (pages.length > 1) {

      doc.setFontSize(7);

      draw(`Page ${pageIndex + 1} / ${pages.length}`, right, 54.5, "right");

    }

    if (pageIndex === 0) {

      doc.setFont("helvetica", "bold");

      doc.setFontSize(8.2);

      draw("BILL TO", left, 57);

      doc.setFont("helvetica", "normal");

      doc.setFontSize(7.7);

      draw(doc.splitTextToSize(`Name: ${invoice.customerName || "Walk-in customer"}`, 125)[0] || "", left, 62);

      draw(`Phone: ${invoice.customerPhone || "-"}`.slice(0, 70), left, 67);

      draw(`Email: ${invoice.customerEmail || "-"}`.slice(0, 80), left, 72);

      const addressLines = doc.splitTextToSize(`Address: ${invoice.customerAddress || "-"}`, 123).slice(0, 2);

      doc.setFontSize(7.3);

      doc.text(addressLines, left, 76.5);

    } else {

      doc.setFont("helvetica", "normal");

      doc.setFontSize(7.8);

      draw(`Customer: ${invoice.customerName || "Walk-in customer"}`.slice(0, 74), left, 60);

    }

    const headerY = pageIndex === 0 ? 85 : 70;

    doc.setDrawColor(...RECEIPT_RULE);

    // Restore the original product-table divider lines for both print and download.

    doc.line(left, headerY - 4, right, headerY - 4);

    doc.setFont("helvetica", "bold");

    doc.setFontSize(7.1);

    draw("#", left + 1, headerY);

    draw("PRODUCT / SIZE / BARCODE", 14, headerY);

    // Fixed, non-overlapping table columns (all distances in millimetres).
    // Product details end by 71 mm; each number is right-aligned to its own
    // column edge. AMOUNT stops at 136 mm, leaving a 12 mm paper margin.
    const columns = {
      productStart: 14,
      productEnd: 71,
      qty: { start: 74, end: 80 },
      rate: { start: 83, end: 101 },
      discount: { start: 104, end: 119 },
      amount: { start: 122, end: 136 },
    } as const;

    // Align every heading with its corresponding values, not a separate
    // visual offset. The left edge of the table rule remains unchanged.
    draw("QTY", columns.qty.end, headerY, "right");
    draw("RATE", columns.rate.end, headerY, "right");
    draw("DISC.", columns.discount.end, headerY, "right");
    draw("AMOUNT", columns.amount.end, headerY, "right");

    doc.line(left, headerY + 2.5, right, headerY + 2.5);

    // Fixed row heights keep each name and size/barcode centered between rules.

    const rowHeight = 9.2;

    const rowsStartY = headerY + 2.5;

    const currentItems = pages[pageIndex];

    currentItems.forEach((item, index) => {

      serial++;

      const rowTop = rowsStartY + index * rowHeight;

      const productLines = doc.splitTextToSize(item.productName || "-", columns.productEnd - columns.productStart).slice(0, 2);

      const nameLineY = rowTop + (productLines.length === 2 ? 3.0 : 3.5);

      const detailY = rowTop + (productLines.length === 2 ? 8.0 : 7.0);

      doc.setFont("helvetica", "normal");

      doc.setFontSize(productLines.length === 2 ? 6.5 : 7.3);

      draw(String(serial), left + 1, rowTop + 5.4);

      doc.text(productLines, columns.productStart, nameLineY);

      doc.setFontSize(6.4);

      // Keep product details within the same row: if the name uses two lines,

      // display the variant beside the second line instead of going past the rule.

      if (productLines.length === 1) {

        draw(`${item.size ? `${item.size} | ` : ""}${item.barcode || "-"}`.slice(0, 40), columns.productStart, detailY);

      } else {

        draw(`${item.size ? `${item.size} | ` : ""}${item.barcode || "-"}`.slice(0, 25), columns.productStart + 26, rowTop + 7.8);

      }

      // Fit each value strictly inside its designated column, even for
      // six-digit prices, without moving other values or shrinking the A5 page.
      const drawInColumn = (
        value: string,
        bounds: { readonly start: number; readonly end: number },
        maxFontSize = 6.9,
      ) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(maxFontSize);
        const allowedWidth = bounds.end - bounds.start;
        const measuredWidth = doc.getTextWidth(value);
        if (measuredWidth > allowedWidth) {
          doc.setFontSize(maxFontSize * (allowedWidth / measuredWidth) * 0.98);
        }
        draw(value, bounds.end, rowTop + 5.4, "right");
      };

      drawInColumn(String(item.quantity), columns.qty);
      drawInColumn(money(item.unitPricePaise), columns.rate);
      drawInColumn(money(item.productDiscountPaise), columns.discount);
      drawInColumn(money(item.netPaise), columns.amount);

      doc.setDrawColor(...RECEIPT_RULE);

      doc.line(left, rowTop + rowHeight, right, rowTop + rowHeight);

    });

    const lastPage = pageIndex === pages.length - 1;

    if (!lastPage) {

      doc.setFont("helvetica", "italic");

      doc.setFontSize(7.4);

      draw("Continued on next page...", left, 147);

      continue;

    }

    // Exactly one bill summary, on the last page only, even when the number

    // of products is a multiple of five. Its fixed start stays clear of rows.

    const rowsBottom = rowsStartY + currentItems.length * rowHeight;

    const summaryY = Math.max(141, rowsBottom + 4);

    if (summaryY > 145) {

      throw new Error("Receipt summary exceeds A5 space; check item layout.");

    }

    doc.setDrawColor(...RECEIPT_RULE);

    doc.line(left, summaryY - 3, right, summaryY - 3);

    summaryRow("Original amount", money(invoice.subtotalPaise), summaryY + 1);

    summaryRow("Product discounts", `- ${money(invoice.productDiscountPaise)}`, summaryY + 6);

    summaryRow("Bill discount", `- ${money(invoice.billDiscountPaise)}`, summaryY + 11);

    // This line is entirely absent for invoices without returned merchandise credit.

    const hasReturnedCredit = returnedAmount(invoice) > 0;

    if (hasReturnedCredit) {

      summaryRow("Returned discount", `- ${money(returnedAmount(invoice))}`, summaryY + 16);

    }

    const creditOffset = hasReturnedCredit ? 5 : 0;

    summaryRow("Total discount", `- ${money(invoice.totalDiscountPaise)}`, summaryY + 16 + creditOffset, true, 8);

    doc.line(left, summaryY + 19 + creditOffset, right, summaryY + 19 + creditOffset);

    summaryRow("FINAL PAYABLE", money(invoice.totalPaise), summaryY + 25 + creditOffset, true, 10);

    doc.setFont("helvetica", "bold");

    doc.setFontSize(7);

    const payments = invoice.tenders.map(t => `${t.method}: ${money(t.amountPaise)}`).join(" | ") || "-";

    const paymentLines = doc.splitTextToSize(`Payments: ${payments}`, A5_WIDTH_MM - 18).slice(0, 2);

    doc.text(paymentLines, left + 1, summaryY + 30 + creditOffset);

    draw(`Received: ${money(invoice.paidPaise)}    Change: ${money(invoice.changePaise)}`, left + 1, summaryY + 37 + creditOffset);

  }

  return doc;
}


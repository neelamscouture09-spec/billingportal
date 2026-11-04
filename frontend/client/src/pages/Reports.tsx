import { useCallback, useEffect, useMemo, useState } from "react";

import { BarChart3, CalendarDays, Download, FileSpreadsheet, FileText, Loader2, ReceiptText, RefreshCw, TrendingUp, Wallet, Printer, X } from "lucide-react";

import { toast } from "sonner";

import RetailLayout from "@/components/RetailLayout";

import { formatINR } from "@/lib/retail";

const API_BASE_URL = ( "https://billingportal-kappa.vercel.app/").replace(/\/+$/, "");

const TIME_ZONE = "Asia/Kolkata";

const presets = ["Today", "This Week", "This Month", "Overall", "Custom Range"] as const;

type Preset = typeof presets[number];

type Item = {

  id: string; productId: string; productName: string; barcode: string;

  size: string; category: string; supplierName: string | null; supplierCode: string | null;

  quantity: number; unitPricePaise: number; grossPaise: number;

  productDiscountPaise: number; discountMode: string | null;

  discountValue: string | null; netPaise: number;

};

type Tender = { method: string; amountPaise: number };

type Invoice = {

  id: string; invoiceNumber: string; invoiceDate: string; createdAt: string; status: string;

  customerName: string; customerPhone: string; customerEmail: string; customerAddress: string;

  subtotalPaise: number; productDiscountPaise: number; billDiscountPaise: number; returnedDiscountPaise?: number;

  totalDiscountPaise: number; totalPaise: number; paidPaise: number; changePaise: number;

  billDiscountMode: string; billDiscountValue: string; itemsCount: number;

  items: Item[]; tenders: Tender[];

};

type Summary = {

  transactions: number; totalSalesPaise: number; productDiscountPaise: number;

  billDiscountPaise: number; returnedDiscountPaise?: number; totalDiscountsPaise: number; revenuePaise: number;

  receivedPaise: number; itemsSold: number; averageOrderPaise: number;

  paymentsByMethod: Record<string, number>;

};

type ReportResponse = { success: boolean; error?: string; invoices: Invoice[]; summary: Summary };

const initialSummary: Summary = {

  transactions: 0, totalSalesPaise: 0, productDiscountPaise: 0,

  billDiscountPaise: 0, totalDiscountsPaise: 0, revenuePaise: 0,

  receivedPaise: 0, itemsSold: 0, averageOrderPaise: 0, paymentsByMethod: {},

};

function istDateKey(date: Date) {

  const parts = new Intl.DateTimeFormat("en-GB", {

    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",

  }).formatToParts(date);

  const get = (name: string) => parts.find(p => p.type === name)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;

}

function dateFromKey(key: string) {

  const [year, month, day] = key.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day, 12));

}

function shiftDate(key: string, days: number) {

  const date = dateFromKey(key);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);

}

function rangeFor(preset: Preset, customFrom: string, customTo: string, now = new Date()) {

  const today = istDateKey(now);

  if (preset === "Today") return { from: today, to: today };

  if (preset === "This Week") {

    const weekday = dateFromKey(today).getUTCDay();

    return { from: shiftDate(today, -((weekday + 6) % 7)), to: today };

  }

  if (preset === "This Month") return { from: `${today.slice(0, 7)}-01`, to: today };

  if (preset === "Overall") return { from: "", to: "" };

  return { from: customFrom, to: customTo };

}

function dateLabel(timestamp: string) {

  return new Intl.DateTimeFormat("en-IN", {

    timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric",

    hour: "2-digit", minute: "2-digit", hour12: true,

  }).format(new Date(timestamp));

}

function returnedAmount(invoice: Invoice): number {
  // Prefer the actual persisted value when the reports API supplies it.
  const reported = invoice.returnedDiscountPaise;
  if (reported !== null && reported !== undefined) {
    return Math.max(0, Number(reported) || 0);
  }

  // Backward compatibility for reports endpoints that omit the field.
  // Only reconcile a nonnegative, integer-pausing difference in totals.
  // Example: 120000 - 0 - 12000 - 36000 = 72000 (Rs. 720).
  const amounts = [invoice.subtotalPaise, invoice.productDiscountPaise,
    invoice.billDiscountPaise, invoice.totalPaise];
  if (!amounts.every(Number.isSafeInteger)) return 0;
  return Math.max(0,
    invoice.subtotalPaise - invoice.productDiscountPaise -
    invoice.billDiscountPaise - invoice.totalPaise);
}

function moneyRupees(paise: number) { return (paise / 100).toFixed(2); }

// Built-in jsPDF Helvetica does not reliably render the Indian rupee glyph.

function pdfMoney(paise: number) { return `Rs. ${moneyRupees(paise)}`; }

function paymentLabel(invoice: Invoice) {

  return invoice.tenders.map(t => `${t.method}: ${formatINR(t.amountPaise)}`).join("; ") || "—";

}

function exportName(range: {from: string; to: string}) {

  return `neelam-sales-${range.from || "all"}-${range.to || "all"}`;

}

function amountSummary(invoice: Invoice) {

  return [

    invoice.invoiceNumber, dateLabel(invoice.invoiceDate), invoice.customerName,

    invoice.customerPhone, invoice.customerEmail, invoice.customerAddress,

    invoice.itemsCount, moneyRupees(invoice.subtotalPaise),

    moneyRupees(invoice.productDiscountPaise), moneyRupees(invoice.billDiscountPaise),

    moneyRupees(returnedAmount(invoice)),

    moneyRupees(invoice.totalDiscountPaise), moneyRupees(invoice.totalPaise),

    moneyRupees(invoice.paidPaise), moneyRupees(invoice.changePaise),

    paymentLabel(invoice), invoice.status,

  ];

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

function paginateReceiptItems(items: Item[]): Item[][] {

  if (items.length === 0) return [[]];

  const pages: Item[][] = [];

  for (let i = 0; i < items.length; i += MAX_RECEIPT_ITEMS_PER_PAGE) {

    pages.push(items.slice(i, i + MAX_RECEIPT_ITEMS_PER_PAGE));

  }

  return pages;

}

async function buildReceiptPdf(invoice: Invoice) {

  const { default: jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5", compress: true });

  const background = await receiptBackgroundData();

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

    doc.addImage(background, "JPEG", 0, 0, A5_WIDTH_MM, A5_HEIGHT_MM);

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

    // Only these product-table rules; no additional header separator.

    doc.line(left, headerY - 4, right, headerY - 4);

    doc.setFont("helvetica", "bold");

    doc.setFontSize(7.1);

    draw("#", left + 1, headerY);

    draw("PRODUCT / SIZE / BARCODE", 14, headerY);

    draw("QTY", 92, headerY, "right");

    draw("RATE", 110, headerY, "right");

    draw("DISC.", 126, headerY, "right");

    draw("AMOUNT", right, headerY, "right");

    doc.line(left, headerY + 2.5, right, headerY + 2.5);

    // Fixed row heights keep each name and size/barcode centered between rules.

    const rowHeight = 9.2;

    const rowsStartY = headerY + 2.5;

    const currentItems = pages[pageIndex];

    currentItems.forEach((item, index) => {

      serial++;

      const rowTop = rowsStartY + index * rowHeight;

      const productLines = doc.splitTextToSize(item.productName || "-", 65).slice(0, 2);

      const nameLineY = rowTop + (productLines.length === 2 ? 3.0 : 3.5);

      const detailY = rowTop + (productLines.length === 2 ? 8.0 : 7.0);

      doc.setFont("helvetica", "normal");

      doc.setFontSize(productLines.length === 2 ? 6.5 : 7.3);

      draw(String(serial), left + 1, rowTop + 5.4);

      doc.text(productLines, 14, nameLineY);

      doc.setFontSize(6.4);

      // Keep product details within the same row: if the name uses two lines,

      // display the variant beside the second line instead of going past the rule.

      if (productLines.length === 1) {

        draw(`${item.size || "-"} | ${item.barcode || "-"}`.slice(0, 40), 14, detailY);

      } else {

        draw(`${item.size || "-"} | ${item.barcode || "-"}`.slice(0, 25), 45, rowTop + 7.8);

      }

      doc.setFontSize(6.9);

      draw(String(item.quantity), 92, rowTop + 5.4, "right");

      draw(money(item.unitPricePaise), 110, rowTop + 5.4, "right");

      draw(money(item.productDiscountPaise), 126, rowTop + 5.4, "right");

      draw(money(item.netPaise), right, rowTop + 5.4, "right");

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

export default function Reports() {

  const [preset, setPreset] = useState<Preset>("This Month");

  const today = istDateKey(new Date());

  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`);

  const [customTo, setCustomTo] = useState(today);

  const [report, setReport] = useState<ReportResponse>({ success: true, invoices: [], summary: initialSummary });

  const [loading, setLoading] = useState(true);

  const [exporting, setExporting] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const [receiptBusy, setReceiptBusy] = useState(false);

  const [error, setError] = useState("");

  const [lastReload, setLastReload] = useState(0);

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const validRange = preset !== "Custom Range" || (Boolean(customFrom) && Boolean(customTo) && customFrom <= customTo);

  const fetchReport = useCallback(async (signal?: AbortSignal) => {

    if (!validRange) {

      setError("Select valid dates. From must be on or before To.");

      setLoading(false);

      return;

    }

    setLoading(true);

    setError("");

    setReport({ success: true, invoices: [], summary: initialSummary });

    try {

      const params = new URLSearchParams();

      if (range.from) params.set("from", range.from);

      if (range.to) params.set("to", range.to);

      const response = await fetch(`${API_BASE_URL}/api/reports/sales${params.size ? `?${params.toString()}` : ""}`, {

        credentials: "omit", cache: "no-store", signal,

      });

      const data: ReportResponse = await response.json();

      if (!response.ok || !data.success || !Array.isArray(data.invoices) || !data.summary) {

        throw new Error(data.error || `Could not load reports (HTTP ${response.status})`);

      }

      if (!signal?.aborted) setReport(data);

    } catch (caught) {

      if (signal?.aborted) return;

      const message = caught instanceof Error ? caught.message : "Could not load reports";

      setError(message);

      toast.error(message);

    } finally {

      if (!signal?.aborted) setLoading(false);

    }

  }, [range.from, range.to, validRange]);

  useEffect(() => {

    const controller = new AbortController();

    void fetchReport(controller.signal);

    return () => controller.abort();

  }, [fetchReport, lastReload]);

  const rows = report.invoices;

  const selectedInvoice = rows.find(row => row.id === selectedInvoiceId) ?? null;

  const returnedDiscountTotal = rows.reduce((sum, invoice) => sum + returnedAmount(invoice), 0);

  const summary = report.summary;

  const totalDiscountsFromInvoices = rows.reduce((sum, invoice) => sum + invoice.totalDiscountPaise, 0);

  const daily = useMemo(() => {

    const buckets = new Map<string, { date: string; amount: number; count: number }>();

    for (const invoice of rows) {

      const key = istDateKey(new Date(invoice.invoiceDate));

      const current = buckets.get(key) ?? { date: key, amount: 0, count: 0 };

      current.amount += invoice.totalPaise;

      current.count += 1;

      buckets.set(key, current);

    }

    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));

  }, [rows]);

  const maxBar = Math.max(1, ...daily.map(item => item.amount));

  async function receiptAction(invoice: Invoice, mode: "print" | "download") {

    if (receiptBusy) return;

    // Open synchronously to avoid pop-up blockers while the template/image loads.

    const printWindow = mode === "print" ? window.open("", "_blank") : null;

    if (mode === "print" && !printWindow) {

      toast.error("Allow pop-ups to print the receipt");

      return;

    }

    if (printWindow) {

      printWindow.document.title = "Preparing receipt...";

      printWindow.document.body.textContent = "Preparing your receipt...";

    }

    setReceiptBusy(true);

    try {

      const doc = await buildReceiptPdf(invoice);

      if (mode === "download") {

        doc.save(`${invoice.invoiceNumber}-receipt.pdf`);

        toast.success("Receipt PDF downloaded");

      } else {

        doc.autoPrint();

        const blobUrl = URL.createObjectURL(doc.output("blob"));

        printWindow!.location.replace(blobUrl);

        // Leave the URL live until the user closes the PDF viewer.

        toast.success("Receipt opened for printing");

      }

    } catch (caught) {

      if (printWindow) printWindow.close();

      toast.error(caught instanceof Error ? caught.message : "Receipt creation failed");

    } finally {

      setReceiptBusy(false);

    }

  }

  async function exportExcel() {

    if (loading || !validRange || error) return;

    setExporting(true);

    try {

      const XLSX = await import("xlsx");

      const book = XLSX.utils.book_new();

      const overview = [

        ["NEELAM SALES REPORT"],

        ["Report period", preset === "Overall" ? "Overall" : `${range.from} to ${range.to}`],

        ["Time zone", TIME_ZONE],

        ["Invoices", summary.transactions],

        ["Total sales (original)", summary.totalSalesPaise / 100],

        ["Product discounts", summary.productDiscountPaise / 100],

        ["Bill discounts", summary.billDiscountPaise / 100],

        ["Returned discounts", returnedDiscountTotal / 100],

        ["Total discounts", totalDiscountsFromInvoices / 100],

        ["Revenue (final payable)", summary.revenuePaise / 100],

        ["Net collected", summary.receivedPaise / 100],

        ["Average invoice", summary.averageOrderPaise / 100],

        ["Products sold (units)", summary.itemsSold],

        [], ["Payment method", "Amount received (₹)"],

        ...Object.entries(summary.paymentsByMethod).map(([method, amount]) => [method, amount / 100]),

      ];

      const headers = ["Invoice number", "Invoice date/time IST", "Customer", "Phone", "Email", "Address", "Units", "Original sales (₹)", "Product discounts (₹)", "Bill discount (₹)", "Returned discount (₹)", "Total discount (₹)", "Final payable (₹)", "Received (₹)", "Change (₹)", "Payment methods", "Status"];

      const purchaseRows = [headers, ...rows.map(row => {

        const values = amountSummary(row);

        return values.map((value, index) => (index >= 7 && index <= 14 ? Number(value) : value));

      })];

      const itemsRows = [["Invoice number", "Invoice date/time IST", "Product", "Barcode", "Size", "Category", "Supplier", "Supplier code", "Quantity", "Unit price (₹)", "Original amount (₹)", "Discount type", "Discount input", "Product discount (₹)", "Net amount (₹)"],

        ...rows.flatMap(invoice => invoice.items.map(item => [

          invoice.invoiceNumber, dateLabel(invoice.invoiceDate), item.productName,

          item.barcode, item.size, item.category, item.supplierName || "", item.supplierCode || "",

          item.quantity, item.unitPricePaise / 100, item.grossPaise / 100,

          item.discountMode || "", item.discountValue || "", item.productDiscountPaise / 100, item.netPaise / 100,

        ]))];

      const paymentRows = [["Invoice number", "Invoice date/time IST", "Method", "Amount (₹)"],

        ...rows.flatMap(invoice => invoice.tenders.map(t => [invoice.invoiceNumber, dateLabel(invoice.invoiceDate), t.method, t.amountPaise / 100]))];

      for (const [name, data] of [

        ["Summary", overview], ["Purchases", purchaseRows],

        ["Products", itemsRows], ["Payments", paymentRows],

      ] as [string, (string | number)[][]][]) {

        const sheet = XLSX.utils.aoa_to_sheet(data);

        sheet["!cols"] = Array.from({ length: Math.max(2, ...data.map(row => row.length)) }, () => ({ wch: 22 }));

        XLSX.utils.book_append_sheet(book, sheet, name);

      }

      XLSX.writeFile(book, `${exportName(range)}.xlsx`);

      toast.success("Filtered Excel report exported");

      setExportOpen(false);

    } catch (caught) {

      toast.error(caught instanceof Error ? caught.message : "Excel export failed");

    } finally { setExporting(false); }

  }

  async function exportPdf() {

    if (loading || !validRange || error) return;

    setExporting(true);

    try {

      const { default: jsPDF } = await import("jspdf");

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      const width = doc.internal.pageSize.getWidth();

      const margin = 12;

      let y = 15;

      const pageBottom = 194;

      const line = (left: string, right: string, bold = false) => {

        if (y > pageBottom) { doc.addPage(); y = 15; }

        doc.setFont("helvetica", bold ? "bold" : "normal");

        doc.setFontSize(9);

        doc.text(left, margin, y);

        doc.text(right, width - margin, y, { align: "right" });

        y += 6;

      };

      doc.setFont("helvetica", "bold"); doc.setFontSize(16);

      doc.text("NEELAM - SALES REPORT", margin, y); y += 8;

      line("Report period", preset === "Overall" ? "Overall" : `${range.from} to ${range.to}`);

      line("Time zone", "Asia/Kolkata");

      line("Completed purchases", String(summary.transactions));

      line("Total sales - original", pdfMoney(summary.totalSalesPaise));

      line("Product discounts", pdfMoney(summary.productDiscountPaise));

      line("Bill discounts", pdfMoney(summary.billDiscountPaise));

      if (returnedDiscountTotal > 0) line("Returned discounts", pdfMoney(returnedDiscountTotal));

      line("Total discounts", pdfMoney(totalDiscountsFromInvoices));

      line("Revenue - final payable", pdfMoney(summary.revenuePaise), true);

      line("Net collection", pdfMoney(summary.receivedPaise));

      line("Average purchase", pdfMoney(summary.averageOrderPaise));

      y += 3;

      doc.setDrawColor(210); doc.line(margin, y, width - margin, y); y += 7;

      doc.setFontSize(11); doc.setFont("helvetica", "bold");

      doc.text("PURCHASES", margin, y); y += 7;

      const drawHeader = () => {

        doc.setFont("helvetica", "bold"); doc.setFontSize(8);

        const labels = ["Invoice", "Date / time IST", "Customer", "Items", "Original", "Discount", "Payable", "Payment"];

        const x = [12, 49, 92, 134, 150, 175, 204, 231];

        labels.forEach((label, i) => doc.text(label, x[i], y));

        y += 3; doc.line(margin, y, width - margin, y); y += 5;

        return x;

      };

      const x = drawHeader();

      for (const invoice of rows) {

        if (y > pageBottom) { doc.addPage(); y = 17; drawHeader(); }

        doc.setFont("helvetica", "normal"); doc.setFontSize(7);

        const cells = [invoice.invoiceNumber, dateLabel(invoice.invoiceDate), invoice.customerName || "Walk-in",

          String(invoice.itemsCount), pdfMoney(invoice.subtotalPaise), pdfMoney(invoice.totalDiscountPaise),

          pdfMoney(invoice.totalPaise), invoice.tenders.map(t => t.method).join(", ") || "—"];

        const widths = [36, 42, 40, 14, 24, 27, 26, 53];

        cells.forEach((cell, i) => doc.text(String(cell).slice(0, i === 7 ? 35 : 27), x[i], y, { maxWidth: widths[i] }));

        y += 7;

      }

      if (!rows.length) line("No completed purchases for this period", "");

      y += 5;

      if (y > pageBottom - 12) { doc.addPage(); y = 15; }

      doc.setFont("helvetica", "bold"); doc.setFontSize(10);

      doc.text("PAYMENT METHOD TOTALS (AMOUNTS TENDERED)", margin, y); y += 7;

      for (const [method, amount] of Object.entries(summary.paymentsByMethod)) line(method, pdfMoney(amount));

      doc.save(`${exportName(range)}.pdf`);

      toast.success("Filtered PDF report exported");

      setExportOpen(false);

    } catch (caught) {

      toast.error(caught instanceof Error ? caught.message : "PDF export failed");

    } finally { setExporting(false); }

  }

  return <RetailLayout>

    <div className="page-heading"><div><div className="eyebrow">BUSINESS OVERVIEW</div><h1>Sales reports</h1><p>Live checkout invoices, sales, discounts, revenue and payment collections.</p></div>

      <div style={{ display: "flex", gap: 8 }}>

        <button type="button" className="btn-outline" disabled={loading} onClick={() => setLastReload(v => v + 1)}><RefreshCw size={14} /> Refresh</button>

        <button type="button" className="btn-primary" disabled={loading || Boolean(error) || !validRange} onClick={() => setExportOpen(true)}><Download size={14} /> Export report</button>

      </div>

    </div>

    <div className="report-filter panel">

      <div className="report-period-label"><CalendarDays size={15} /><span>REPORT PERIOD</span></div>

      <div className="filter-pills">{presets.map(item => <button type="button" key={item} className={preset === item ? "active" : ""} onClick={() => setPreset(item)}>{item}</button>)}</div>

      {preset === "Custom Range" && <div className="custom-dates">

        <label>From<input type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} /></label>

        <label>To<input type="date" value={customTo} min={customFrom || undefined} onChange={event => setCustomTo(event.target.value)} /></label>

      </div>}

      <small style={{ display: "block", marginTop: 8, color: "#64748b" }}>{preset === "Overall" ? "Showing all completed purchases" : `Showing ${range.from || "start"} to ${range.to || "today"} (IST)`}</small>

    </div>

    {error && <section className="panel" role="alert" style={{ padding: 16, color: "#b91c1c", marginBottom: 15 }}>{error} <button type="button" className="btn-outline" onClick={() => setLastReload(v => v + 1)}>Retry</button></section>}

    <div className="kpi-grid">

      {[

        { label: "Total sales", value: formatINR(summary.totalSalesPaise), note: "Original prices before discounts", Icon: ReceiptText },

        { label: "Revenue", value: formatINR(summary.revenuePaise), note: "Final payable after discounts", Icon: TrendingUp },

        { label: "Purchases", value: String(summary.transactions), note: `${summary.itemsSold} units purchased`, Icon: BarChart3 },

        { label: "Total discounts", value: formatINR(totalDiscountsFromInvoices), note: "Product, bill and returned discounts", Icon: Wallet },

      ].map(({ label, value, note, Icon }) => <article className="kpi-card" key={label}><div className="kpi-top"><span>{label}</span><span className="kpi-icon"><Icon size={15} /></span></div><strong>{loading ? "…" : value}</strong><small>{note}</small></article>)}

    </div>

    <section className="report-chart">

      <div className="chart-heading"><strong>Sales activity</strong><span>{preset} · daily final payable (IST)</span></div>

      <div className="chart-bars" style={{ minHeight: 170, overflowX: "auto" }}>

        {(daily.length > 35 ? daily.slice(-35) : daily).map(day => <div className="chart-col" key={day.date} title={`${day.date} · ${day.count} purchases · ${formatINR(day.amount)}`}>

          <div className="chart-bar" style={{ height: `${Math.max(day.amount ? 6 : 2, (day.amount / maxBar) * 100)}%` }} /><small>{day.date.slice(5)}</small>

        </div>)}

        {!daily.length && <span style={{ padding: 20, color: "#64748b" }}>No purchase activity for this period.</span>}

      </div>

      <div className="chart-foot"><span><i /> Final payable per day{daily.length > 35 ? " (last 35 active days shown)" : ""}</span><strong>{formatINR(summary.revenuePaise)}</strong></div>

    </section>

    <div className="page-toolbar report-table-toolbar"><div><strong className="table-section-title">Purchase details</strong><span className="table-section-sub">{rows.length} completed invoices · {preset === "Overall" ? "Overall" : `${range.from} to ${range.to}`}</span></div>

      <span className="report-discount">Product: <strong>−{formatINR(summary.productDiscountPaise)}</strong> · Bill: <strong>−{formatINR(summary.billDiscountPaise)}</strong>{returnedDiscountTotal > 0 && <> · Returned: <strong>−{formatINR(returnedDiscountTotal)}</strong></>}</span>

    </div>

    <section className="panel data-panel"><div className="table-scroll"><table className="data-table">

      <thead><tr><th>INVOICE NUMBER</th><th>DATE / TIME</th><th>CUSTOMER</th><th>ITEMS</th><th>ORIGINAL</th><th>PRODUCT DISC.</th><th>BILL DISC.</th><th>RETURNED DISC.</th><th>FINAL PAYABLE</th><th>PAYMENTS</th><th>STATUS</th><th>ACTIONS</th></tr></thead>

      <tbody>{rows.map(invoice => <tr key={invoice.id} onClick={() => setSelectedInvoiceId(invoice.id)} style={{ cursor: "pointer" }}>

        <td><span className="invoice-code">{invoice.invoiceNumber}</span></td>

        <td>{dateLabel(invoice.invoiceDate)}</td>

        <td><span className="table-primary">{invoice.customerName || "Walk-in customer"}</span><span className="table-sub">{invoice.customerPhone || "—"}</span></td>

        <td>{invoice.itemsCount}</td>

        <td>{formatINR(invoice.subtotalPaise)}</td>

        <td>{formatINR(invoice.productDiscountPaise)}</td>

        <td>{formatINR(invoice.billDiscountPaise)}</td>

        <td>{returnedAmount(invoice) > 0 ? formatINR(returnedAmount(invoice)) : "—"}</td>

        <td><strong className="amount-strong">{formatINR(invoice.totalPaise)}</strong></td>

        <td><span title={paymentLabel(invoice)}>{invoice.tenders.map(t => t.method).join(", ") || "—"}</span></td>

        <td><span className="badge badge-green">{invoice.status}</span></td>

        <td><button type="button" className="btn-outline tiny-button" onClick={event => { event.stopPropagation(); setSelectedInvoiceId(invoice.id); }}><ReceiptText size={13} /> View / receipt</button></td>

      </tr>)}</tbody>

    </table></div>

      {!loading && !rows.length && <div className="empty-state"><div className="empty-state-icon"><BarChart3 size={21} /></div><h3>No purchases found for this period</h3><p>Try another date range, or complete a checkout to record an invoice.</p></div>}

      {loading && <div style={{ padding: 18, display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={16} className="animate-spin" /> Loading purchases…</div>}

    </section>

    {selectedInvoice && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !receiptBusy) setSelectedInvoiceId(null); }}>

      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title" style={{ width: "min(94vw, 980px)", maxWidth: 980, maxHeight: "92vh", overflowY: "auto" }}>

        <header className="modal-header">

          <div><h2 id="purchase-detail-title">Purchase · {selectedInvoice.invoiceNumber}</h2><p>{dateLabel(selectedInvoice.invoiceDate)} · {selectedInvoice.status}</p></div>

          <button type="button" className="icon-button" disabled={receiptBusy} onClick={() => setSelectedInvoiceId(null)} aria-label="Close purchase"><X size={18} /></button>

        </header>

        <div className="modal-body" style={{ display: "grid", gap: 16 }}>

          <div className="panel" style={{ padding: 16 }}>

            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 9 }}>Customer details</h3>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, fontSize: 13 }}>

              <div><strong>Name</strong><div>{selectedInvoice.customerName || "Walk-in customer"}</div></div>

              <div><strong>Phone</strong><div>{selectedInvoice.customerPhone || "—"}</div></div>

              <div><strong>Email</strong><div>{selectedInvoice.customerEmail || "—"}</div></div>

              <div><strong>Address</strong><div style={{ overflowWrap: "anywhere" }}>{selectedInvoice.customerAddress || "—"}</div></div>

            </div>

          </div>

          <div className="panel" style={{ padding: 14 }}>

            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Purchased products</h3>

            <div className="table-scroll"><table className="data-table">

              <thead><tr><th>PRODUCT</th><th>SIZE / BARCODE</th><th>SUPPLIER</th><th>QTY</th><th>UNIT PRICE</th><th>ORIGINAL</th><th>PRODUCT DISC.</th><th>NET</th></tr></thead>

              <tbody>{selectedInvoice.items.map(item => <tr key={item.id}>

                <td><strong>{item.productName}</strong><div className="table-sub">{item.category}</div></td>

                <td>{item.size}<div className="table-sub">{item.barcode}</div></td>

                <td>{item.supplierName || "—"}<div className="table-sub">{item.supplierCode || ""}</div></td>

                <td>{item.quantity}</td><td>{formatINR(item.unitPricePaise)}</td><td>{formatINR(item.grossPaise)}</td>

                <td>{formatINR(item.productDiscountPaise)}<div className="table-sub">{item.discountMode ? `${item.discountMode} ${item.discountValue ?? ""}` : ""}</div></td>

                <td><strong>{formatINR(item.netPaise)}</strong></td>

              </tr>)}</tbody>

            </table></div>

          </div>

          <div className="panel" style={{ padding: 16, display: "grid", gap: 8, fontSize: 13 }}>

            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Bill and payment details</h3>

            {([

              ["Original total", selectedInvoice.subtotalPaise],

              ["Product discounts", -selectedInvoice.productDiscountPaise],

              ["Bill discount", -selectedInvoice.billDiscountPaise],

              ...(returnedAmount(selectedInvoice) > 0 ? [["Returned discount", -returnedAmount(selectedInvoice)] as [string, number]] : []),

              ["Total discounts", -selectedInvoice.totalDiscountPaise],

              ["Final payable", selectedInvoice.totalPaise],

            ] as [string,number][]).map(([label,value]) => <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{label}</span><strong>{value < 0 ? "−" : ""}{formatINR(Math.abs(value))}</strong></div>)}

            <hr style={{ border: 0, borderTop: "1px solid #e2e8f0" }} />

            {selectedInvoice.tenders.map((tender,index) => <div key={`${tender.method}-${index}`} style={{ display: "flex", justifyContent: "space-between" }}><span>{tender.method}</span><strong>{formatINR(tender.amountPaise)}</strong></div>)}

            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Amount received</span><strong>{formatINR(selectedInvoice.paidPaise)}</strong></div>

            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Change returned</span><strong>{formatINR(selectedInvoice.changePaise)}</strong></div>

            <div className="table-sub">Invoice ID: {selectedInvoice.id}</div>

          </div>

        </div>

        <footer className="modal-footer" style={{ flexWrap: "wrap" }}>

          <button type="button" className="btn-outline" disabled={receiptBusy} onClick={() => setSelectedInvoiceId(null)}>Close</button>

          <button type="button" className="btn-outline" disabled={receiptBusy} onClick={() => void receiptAction(selectedInvoice, "download")}><Download size={15} /> Download PDF</button>

          <button type="button" className="btn-primary" disabled={receiptBusy} onClick={() => void receiptAction(selectedInvoice, "print")}>{receiptBusy ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} Print receipt</button>

        </footer>

      </section>

    </div>}

    {exportOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !exporting) setExportOpen(false); }}>

      <section className="modal-card"><header className="modal-header"><div><h2>Export sales report</h2><p>Exports use the same selected period and totals as the report above.</p></div><button type="button" className="icon-button" disabled={exporting} onClick={() => setExportOpen(false)}>×</button></header>

        <div className="modal-body"><div className="export-period"><CalendarDays size={16} /><span>{preset === "Overall" ? "Overall" : `${range.from} — ${range.to}`}</span><strong>{rows.length} purchases</strong></div>

          <div className="export-options">

            <button type="button" disabled={exporting} onClick={() => void exportPdf()}><span><FileText size={18} /></span><b>PDF report</b><small>Summary, purchases and payment totals</small></button>

            <button type="button" disabled={exporting} onClick={() => void exportExcel()}><span><FileSpreadsheet size={18} /></span><b>Excel workbook</b><small>Summary, purchases, products, payments</small></button>

          </div>

        </div><footer className="modal-footer"><button type="button" className="btn-outline" disabled={exporting} onClick={() => setExportOpen(false)}>Close</button></footer>

      </section>

    </div>}

  </RetailLayout>;

}

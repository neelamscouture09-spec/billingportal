import { useCallback, useEffect, useMemo, useState } from "react";

import { Loader2, Printer, RefreshCw, RotateCcw, Search, Minus, Plus, CheckCircle2, FileSpreadsheet, FileText, CalendarDays } from "lucide-react";

import { toast } from "sonner";

import RetailLayout from "@/components/RetailLayout";

import { ActionDialog } from "@/components/ActionDialog";

import { formatINR } from "@/lib/retail";

import { invalidateProductCache } from "@/lib/productCatalogCache";

import { buildReturnReceiptPdf, type ReturnReceipt } from "@/lib/returnReceiptPdf";



const API = (import.meta.env.VITE_API_BASE_URL || "https://billingportal-kappa.vercel.app").replace(/\/+$/, "");

type SaleItem = {

  id: string; productId: string; productName: string; barcode: string; size: string;

  quantity: number; unitPricePaise: number; grossPaise: number; productDiscountPaise: number;

  discountMode: string; discountValue: string; netPaise: number;

  billDiscountSharePaise: number; previousCreditSharePaise: number; settlementPaise: number;

  canReturn: boolean; returnStatus: string; returnedQuantity: number; canReturnQuantity: number;

};

type Invoice = {

  id: string; invoiceNumber: string; invoiceDate: string; customerName: string; customerPhone: string;

  totalPaise: number; billDiscountMode: string; billDiscountValue: string;

  billDiscountPaise: number; returnedDiscountPaise: number; items: SaleItem[];

};

type Suggestion = { id: string; invoiceNumber: string; customerName: string; customerPhone: string };

type ApiReply = { success: boolean; error?: string; [key: string]: unknown };

const showDate = (date: string) => new Date(date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

// All date filters use the shop's Asia/Kolkata calendar, independent of browser timezone.
type ReturnPeriod = "Today" | "This Week" | "This Month" | "This Year" | "Custom Range" | "Overall";
type ReturnStatus = "ALL" | "PENDING" | "CLAIMED" | "LEGACY_NO_CREDIT";
const reportPeriods: ReturnPeriod[] = ["Today", "This Week", "This Month", "This Year", "Custom Range", "Overall"];
function istDay(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (key: string) => parts.find(p => p.type === key)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function reportRange(period: ReturnPeriod, start: string, end: string) {
  const today = istDay(new Date());
  if (period === "Overall") return { from: "", to: "" };
  if (period === "Today") return { from: today, to: today };
  if (period === "This Month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (period === "This Year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (period === "Custom Range") return { from: start, to: end };
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return { from: shiftDay(today, -((weekday + 6) % 7)), to: today };
}
const rupees = (value: number) => (value / 100).toFixed(2);
const pdfRupees = (value: number) => `Rs. ${rupees(value)}`;
// Reports use saved settlement values only; never recalculate previous invoices at today's prices.
function totalsFor(rows: ReturnReceipt[]) {
  const claimed = rows.filter(r => r.status === "CLAIMED");
  const pending = rows.filter(r => r.status === "PENDING");
  const legacy = rows.filter(r => r.status === "LEGACY_NO_CREDIT");
  const valid = rows.filter(r => r.status === "CLAIMED" || r.status === "PENDING");
  const sum = (records: ReturnReceipt[], select: (item: ReturnReceipt) => number) =>
    records.reduce((n, item) => n + select(item), 0);
  return {
    count: rows.length, claimedCount: claimed.length, pendingCount: pending.length,
    legacyCount: legacy.length,
    units: sum(rows, r => r.items.reduce((n, i) => n + i.quantity, 0)),
    lines: sum(rows, r => r.items.length),
    gross: sum(valid, r => r.originalReturnedGrossPaise),
    productDiscount: sum(valid, r => r.returnedProductDiscountPaise),
    billDiscount: sum(valid, r => r.returnedBillDiscountPaise),
    previousCredit: sum(valid, r => r.returnedPreviouslyAppliedCreditPaise),
    overall: sum(valid, r => r.settlementPaise),
    claimedAmount: sum(claimed, r => r.settlementPaise),
    pendingAmount: sum(pending, r => r.settlementPaise),
  };
}


async function api<T extends ApiReply>(path: string, options: RequestInit = {}): Promise<T> {

  const resp = await fetch(`${API}${path}`, { ...options, credentials: "omit", cache: "no-store",

    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });

  let value: T;

  try { value = await resp.json(); } catch { throw new Error(`Invalid server response (${resp.status})`); }

  if (!resp.ok || !value.success) throw new Error(value.error || `Server error (${resp.status})`);

  return value;

}



export default function Returns() {

  const [search, setSearch] = useState("");

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const [invoice, setInvoice] = useState<Invoice | null>(null);

  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [history, setHistory] = useState<ReturnReceipt[]>([]);

  const [loadingInvoice, setLoadingInvoice] = useState(false);

  const [saving, setSaving] = useState(false);

  const [loadingHistory, setLoadingHistory] = useState(false);

  const [printingId, setPrintingId] = useState<string | null>(null);

  const [confirmation, setConfirmation] = useState<"return" | string | null>(null);

  const [lastSaved, setLastSaved] = useState<ReturnReceipt | null>(null);

  const [historySearch, setHistorySearch] = useState("");
  const [period, setPeriod] = useState<ReturnPeriod>("This Month");
  const [dateFrom, setDateFrom] = useState(() => `${istDay(new Date()).slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(() => istDay(new Date()));
  const [statusFilter, setStatusFilter] = useState<ReturnStatus>("ALL");
  const [exporting, setExporting] = useState<"PDF" | "Excel" | null>(null);
  const range = reportRange(period, dateFrom, dateTo);
  const invalidRange = period === "Custom Range" && (!dateFrom || !dateTo || dateFrom > dateTo);
  const filteredHistory = useMemo(() => {
    if (invalidRange) return [];
    const q = historySearch.trim().toLowerCase();
    return history.filter(r => {
      const day = istDay(r.createdAt);
      if (range.from && day < range.from) return false;
      if (range.to && day > range.to) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.returnNumber, r.invoiceNumber, r.customerName, r.customerPhone,
        ...r.items.flatMap(item => [item.name, item.barcode])]
        .some(part => (part || "").toLowerCase().includes(q));
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [history, historySearch, range.from, range.to, statusFilter, invalidRange]);
  const metrics = useMemo(() => totalsFor(filteredHistory), [filteredHistory]);
  const reportSubtitle = `${period}${period === "Custom Range" ? ` (${range.from} to ${range.to})` :
    period !== "Overall" ? ` (${range.from} to ${range.to})` : ""}`;

  async function exportExcel() {
    if (invalidRange) return toast.error("Select a valid custom date range");
    if (!filteredHistory.length) return toast.error("No matching returns to export");
    setExporting("Excel");
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.utils.book_new();
      const summaryData: (string | number)[][] = [
        ["NEELAMS COUTURE - RETURNS SUMMARY"], ["Period", reportSubtitle],
        ["Search", historySearch || "All"], ["Status", statusFilter],
        ["Total return bills", metrics.count], ["Claimed returns", metrics.claimedCount],
        ["Pending returns", metrics.pendingCount], ["Historical stock-only returns", metrics.legacyCount],
        ["Product lines returned", metrics.lines], ["Units returned", metrics.units],
        ["Original value (Rs)", Number(rupees(metrics.gross))],
        ["Product discounts (Rs)", Number(rupees(metrics.productDiscount))],
        ["Allocated bill discounts (Rs)", Number(rupees(metrics.billDiscount))],
        ["Previously applied credit (Rs)", Number(rupees(metrics.previousCredit))],
        ["Total settlement (Rs)", Number(rupees(metrics.overall))],
        ["Claimed settlement (Rs)", Number(rupees(metrics.claimedAmount))],
        ["Unclaimed settlement (Rs)", Number(rupees(metrics.pendingAmount))],
        ["Note", "Amounts exclude historical stock-only returns without saved credit values."],
      ];
      const overview = XLSX.utils.aoa_to_sheet(summaryData);
      overview["!cols"] = [{ wch: 37 }, { wch: 80 }];
      XLSX.utils.book_append_sheet(book, overview, "Summary");
      const returnRows = filteredHistory.map(r => ({
        "Return No": r.returnNumber, "Return Date (IST)": showDate(r.createdAt),
        "Original Invoice": r.invoiceNumber, "Customer": r.customerName,
        "Phone": r.customerPhone, "Status": r.status,
        "Claimed Date (IST)": r.claimedAt ? showDate(r.claimedAt) : "",
        "Product Lines": r.items.length, "Units Returned": r.items.reduce((n, i) => n + i.quantity, 0),
        "Original Returned Value (Rs)": r.status === "LEGACY_NO_CREDIT" ? "" : Number(rupees(r.originalReturnedGrossPaise)),
        "Product Discount (Rs)": r.status === "LEGACY_NO_CREDIT" ? "" : Number(rupees(r.returnedProductDiscountPaise)),
        "Bill Discount (Rs)": r.status === "LEGACY_NO_CREDIT" ? "" : Number(rupees(r.returnedBillDiscountPaise)),
        "Prior Credit (Rs)": r.status === "LEGACY_NO_CREDIT" ? "" : Number(rupees(r.returnedPreviouslyAppliedCreditPaise)),
        "Settlement (Rs)": r.status === "LEGACY_NO_CREDIT" ? "" : Number(rupees(r.settlementPaise)),
      }));
      const returnsSheet = XLSX.utils.json_to_sheet(returnRows);
      returnsSheet["!cols"] = Object.keys(returnRows[0]).map(key => ({ wch: Math.max(16, Math.min(key.length + 4, 34)) }));
      XLSX.utils.book_append_sheet(book, returnsSheet, "Return Bills");
      const itemRows = filteredHistory.flatMap(r => r.items.map(item => ({
        "Return No": r.returnNumber, "Original Invoice": r.invoiceNumber,
        "Return Date (IST)": showDate(r.createdAt), "Status": r.status,
        "Product": item.name, "Barcode": item.barcode, "Quantity": item.quantity,
        "Unit Original Price (Rs)": Number(rupees(item.unitPricePaise)),
        "Original Value (Rs)": Number(rupees(item.grossPaise)),
        "Discount Type": item.discountMode, "Discount Entered": item.discountValue,
        "Product Discount (Rs)": Number(rupees(item.productDiscountPaise)),
        "After Product Discount (Rs)": Number(rupees(item.netAfterProductDiscountPaise)),
        "Bill Discount Share (Rs)": Number(rupees(item.billDiscountSharePaise)),
        "Prior Credit Share (Rs)": Number(rupees(item.previousCreditSharePaise)),
        "Final Item Settlement (Rs)": Number(rupees(item.settlementPaise)),
      })));
      const itemsSheet = XLSX.utils.json_to_sheet(itemRows);
      itemsSheet["!cols"] = Object.keys(itemRows[0] || {Product: ""}).map(key => ({ wch: Math.max(17, Math.min(key.length + 3, 36)) }));
      XLSX.utils.book_append_sheet(book, itemsSheet, "Returned Items");
      XLSX.writeFile(book, `neelam-returns-${range.from || "all"}-${range.to || "all"}.xlsx`);
      toast.success("Return Excel report exported");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to export Excel"); }
    finally { setExporting(null); }
  }

  async function exportPdf() {
    if (invalidRange) return toast.error("Select a valid custom date range");
    if (!filteredHistory.length) return toast.error("No matching returns to export");
    setExporting("PDF");
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "landscape", format: "a4", unit: "mm", compress: true });
      const W = 297, H = 210, M = 13;
      let y = 14;
      const blue: [number,number,number] = [12, 58, 140];
      const muted: [number,number,number] = [90, 110, 135];
      const next = (needed = 8) => {
        if (y + needed > H - 14) { doc.addPage(); y = 15; return true; }
        return false;
      };
      const heading = (title: string) => {
        next(13); doc.setTextColor(...blue); doc.setFont("helvetica", "bold");
        doc.setFontSize(11); doc.text(title, M, y); y += 7;
      };
      const line = (label: string, value: string, x = M, right = 145) => {
        next(6); doc.setTextColor(...blue); doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5); doc.text(label, x, y); doc.setFont("helvetica", "bold");
        doc.text(value, right, y, { align: "right" }); y += 6;
      };
      const tableHeading = (labels: string[], starts: number[], widths: number[]) => {
        next(11); doc.setFillColor(234, 240, 249); doc.rect(M, y - 4, W - 2 * M, 9, "F");
        doc.setFont("helvetica", "bold"); doc.setTextColor(...blue); doc.setFontSize(7);
        labels.forEach((label, i) => doc.text(label, starts[i], y, { maxWidth: widths[i] }));
        y += 9;
      };
      doc.setTextColor(...blue); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
      doc.text("NEELAMS COUTURE | RETURN REPORT", M, y); y += 8;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...muted);
      doc.text(`Period: ${reportSubtitle}     Status: ${statusFilter}     Search: ${historySearch || "All"}`, M, y, { maxWidth: W - 2*M });
      y += 10;
      heading("Summary of returned bills");
      const summaryLines: Array<[string,string]> = [
        ["Total return bills", String(metrics.count)],
        ["Claimed returns", String(metrics.claimedCount)],
        ["Unclaimed / pending returns", String(metrics.pendingCount)],
        ["Old stock-only returns", String(metrics.legacyCount)],
        ["Product lines returned", String(metrics.lines)],
        ["Total units returned", String(metrics.units)],
        ["Original value of returned products", pdfRupees(metrics.gross)],
        ["Individual product discounts", `- ${pdfRupees(metrics.productDiscount)}`],
        ["Allocated bill discounts", `- ${pdfRupees(metrics.billDiscount)}`],
        ["Previously applied credit", `- ${pdfRupees(metrics.previousCredit)}`],
        ["Overall settlement", pdfRupees(metrics.overall)],
        ["Claimed settlement amount", pdfRupees(metrics.claimedAmount)],
        ["UNCLAIMED settlement amount", pdfRupees(metrics.pendingAmount)],
      ];
      summaryLines.forEach(([label,value]) => line(label,value));
      y += 2;
      doc.setFont("helvetica","italic"); doc.setFontSize(7); doc.setTextColor(...muted);
      doc.text("Claim status is marked manually. Old stock-only returns are counted but excluded from monetary totals.", M, y);
      y += 10;
      heading("Return bills (filtered)");
      const heads = ["RETURN / DATE", "ORIGINAL INVOICE", "CUSTOMER", "LINES / UNITS", "ORIGINAL", "DISCOUNTS", "SETTLEMENT", "STATUS"];
      const xs = [M+2, 57, 92, 139, 172, 207, 247, 274];
      const ws = [40, 32, 42, 31, 32, 38, 26, 12];
      tableHeading(heads,xs,ws);
      filteredHistory.forEach(r => {
        if (next(12)) tableHeading(heads,xs,ws);
        const units = r.items.reduce((sum,i)=>sum+i.quantity,0);
        const values = [r.returnNumber, r.invoiceNumber, r.customerName || "Walk-in",
          `${r.items.length} / ${units}`,
          r.status === "LEGACY_NO_CREDIT" ? "N/A" : pdfRupees(r.originalReturnedGrossPaise),
          r.status === "LEGACY_NO_CREDIT" ? "N/A" : pdfRupees(r.returnedProductDiscountPaise+r.returnedBillDiscountPaise+r.returnedPreviouslyAppliedCreditPaise),
          r.status === "LEGACY_NO_CREDIT" ? "N/A" : pdfRupees(r.settlementPaise),
          r.status === "LEGACY_NO_CREDIT" ? "OLD" : r.status === "CLAIMED" ? "CLAIMED" : "PENDING"];
        doc.setFont("helvetica","normal"); doc.setFontSize(7.1); doc.setTextColor(...blue);
        values.forEach((value,i) => doc.text(doc.splitTextToSize(String(value),ws[i])[0] || "", xs[i], y));
        doc.setFontSize(6); doc.setTextColor(...muted); doc.text(istDay(r.createdAt),xs[0],y+4);
        doc.setDrawColor(212,222,235); doc.line(M,y+6,W-M,y+6); y+=12;
      });
      y += 7;
      heading("Returned product details");
      const itemHeads = ["RETURN NO", "PRODUCT / BARCODE", "QTY", "RATE", "ORIGINAL", "ITEM DISC.", "BILL DISC.", "PRIOR CREDIT", "NET VALUE"];
      const ix = [M+2, 50, 120, 139, 169, 201, 231, 251, 269];
      const iw = [34, 65, 13, 27, 27, 27, 18, 17, 15];
      tableHeading(itemHeads,ix,iw);
      filteredHistory.forEach(r => r.items.forEach(item => {
        if (next(13)) tableHeading(itemHeads,ix,iw);
        const values = [r.returnNumber, item.name, String(item.quantity), rupees(item.unitPricePaise),
          rupees(item.grossPaise), rupees(item.productDiscountPaise), rupees(item.billDiscountSharePaise),
          rupees(item.previousCreditSharePaise), rupees(item.settlementPaise)];
        doc.setFontSize(6.8); doc.setFont("helvetica", "normal"); doc.setTextColor(...blue);
        values.forEach((value,i)=>{
          const label = i === 1 ? String(value) : String(value);
          if (i < 2) {
            doc.text(doc.splitTextToSize(label,iw[i])[0] || "",ix[i],y);
          } else {
            const available = iw[i];
            const width = doc.getTextWidth(label);
            if (width > available) doc.setFontSize(Math.max(4.8, 6.8 * available / width * 0.96));
            doc.text(label, ix[i] + available, y, {align:"right"});
            doc.setFontSize(6.8);
          }
        });
        doc.setFontSize(6.2); doc.setTextColor(...muted);
        doc.text(`${item.barcode || "-"} | ${item.discountMode === "percent" ? `${item.discountValue}%` : `${item.discountValue} fixed`}`,ix[1],y+4,{maxWidth:iw[1]});
        doc.setDrawColor(212,222,235); doc.line(M,y+6,W-M,y+6); y+=13;
      }));
      const totalPages = doc.getNumberOfPages();
      for(let page=1;page<=totalPages;page++){
        doc.setPage(page); doc.setTextColor(...muted);doc.setFontSize(7);
        doc.text(`Neelams Couture - Returns | Page ${page} of ${totalPages}`, W-M,H-7,{align:"right"});
      }
      doc.save(`neelam-returns-${range.from || "all"}-${range.to || "all"}.pdf`);
      toast.success("Return PDF report exported");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to export PDF"); }
    finally { setExporting(null); }
  }




  const loadHistory = useCallback(async () => {

    setLoadingHistory(true);

    try {

      const data = await api<{ success: boolean; error?: string; returns: ReturnReceipt[] }>("/api/returns?history=1");

      setHistory(data.returns);

    } catch (e) { toast.error(e instanceof Error ? e.message : "Cannot load return history"); }

    finally { setLoadingHistory(false); }

  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);



  async function lookupInvoice(number = search) {

    if (!number.trim()) return toast.error("Enter an invoice number");

    setLoadingInvoice(true);

    try {

      const data = await api<{ success: boolean; error?: string; invoice: Invoice }>(`/api/returns?invoiceNumber=${encodeURIComponent(number.trim())}`);

      setInvoice(data.invoice); setSearch(data.invoice.invoiceNumber); setQuantities({}); setSuggestions([]);

    } catch (e) { toast.error(e instanceof Error ? e.message : "Invoice not found"); }

    finally { setLoadingInvoice(false); }

  }

  async function searchInvoices(text: string) {

    setSearch(text);

    if (text.trim().length < 2) { setSuggestions([]); return; }

    try {

      const data = await api<{ success: boolean; error?: string; suggestions: Suggestion[] }>(`/api/returns?search=${encodeURIComponent(text.trim())}`);

      setSuggestions(data.suggestions);

    } catch { setSuggestions([]); }

  }

  // Same cumulative integer split as the backend; the displayed estimate

  // is accurate even for previous partial returns and odd-paise discounts.

  const portion = (amount: number, full: number, before: number, count: number) => {

    const all = BigInt(amount);

    return Number(all * BigInt(before + count) / BigInt(full) - all * BigInt(before) / BigInt(full));

  };

  const chosen = invoice?.items.filter(item => item.canReturn && (quantities[item.id] ?? 0) > 0) ?? [];

  const breakdown = chosen.map(item => {

    const quantity = quantities[item.id];

    const before = item.returnedQuantity;

    const net = portion(item.netPaise, item.quantity, before, quantity);

    const gross = item.unitPricePaise * quantity;

    const bill = portion(item.billDiscountSharePaise, item.quantity, before, quantity);

    const oldCredit = portion(item.previousCreditSharePaise, item.quantity, before, quantity);

    return { id: item.id, quantity, gross, itemDiscount: gross - net,

      billShare: bill, oldCreditShare: oldCredit, settlement: net - bill - oldCredit };

  });

  const gross = breakdown.reduce((n, item) => n + item.gross, 0);

  const itemDiscount = breakdown.reduce((n, item) => n + item.itemDiscount, 0);

  const billShare = breakdown.reduce((n, item) => n + item.billShare, 0);

  const oldCreditShare = breakdown.reduce((n, item) => n + item.oldCreditShare, 0);

  const settlement = breakdown.reduce((n, item) => n + item.settlement, 0);

  const updateQuantity = (item: SaleItem, next: number) => {

    if (!Number.isSafeInteger(next)) return;

    setQuantities(current => ({ ...current, [item.id]: Math.max(0, Math.min(item.canReturnQuantity, next)) }));

  };



  async function saveReturn() {

    if (!invoice || !chosen.length || saving) return;

    setSaving(true);

    try {

      const data = await api<{ success: boolean; error?: string; returned: ReturnReceipt }>("/api/returns", {

        method: "POST", body: JSON.stringify({ invoiceId: invoice.id, items: breakdown.map(item => ({ invoiceItemId: item.id, quantity: item.quantity })) }),

      });

      setLastSaved(data.returned); setConfirmation(null);

      setQuantities({}); invalidateProductCache();

      toast.success(`Return saved: ${formatINR(data.returned.settlementPaise)} pending claim`);

      await Promise.all([loadHistory(), lookupInvoice(invoice.invoiceNumber)]);

    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save return"); }

    finally { setSaving(false); }

  }

  async function claimReturn(id: string) {

    if (saving) return;

    setSaving(true);

    try {

      await api(`/api/returns/${encodeURIComponent(id)}/claim`, { method: "POST" });

      setConfirmation(null);

      toast.success("Return marked Claimed. This record cannot be claimed again.");

      await loadHistory();

    } catch (e) { toast.error(e instanceof Error ? e.message : "Claim unsuccessful"); }

    finally { setSaving(false); }

  }

  async function openReceipt(item: ReturnReceipt) {

    // Open synchronously from the button click to avoid browser popup blockers.

    const win = window.open("", "_blank");

    if (!win) return toast.error("Allow pop-ups for this site to open the return receipt.");

    win.document.title = `Return receipt ${item.returnNumber}`;

    win.document.body.textContent = "Preparing return receipt...";

    setPrintingId(item.id);

    try {

      const pdf = await buildReturnReceiptPdf(item);

      win.location.replace(pdf.output("bloburl"));

    } catch (e) {

      win.close();

      toast.error(e instanceof Error ? e.message : "Could not open receipt");

    } finally { setPrintingId(null); }

  }

  return <RetailLayout>

    <div className="page-heading"><div><div className="eyebrow">AFTER-SALES</div><h1>Product returns</h1>

      <p>Save returns, print settlement receipts, and manually mark used credits Claimed. No cash refunds.</p></div></div>

    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>

      <strong>Search original invoice</strong>

      <form onSubmit={e => { e.preventDefault(); void lookupInvoice(); }} style={{ display: "flex", gap: 10, marginTop: 12 }}>

        <div style={{ position: "relative", flex: 1 }}>

          <label className="return-search" style={{ display: "flex", alignItems: "center", gap: 8 }}>

            <Search size={16}/><input value={search} onChange={e => void searchInvoices(e.target.value)}

              placeholder="Invoice number" aria-label="Original invoice number" autoComplete="off" />

          </label>

          {!!suggestions.length && <div className="return-results" style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, maxHeight: 240, overflowY: "auto", background: "white", border: "1px solid #cbd5e1", borderRadius: 8 }}>

            {suggestions.map(s => <button key={s.id} type="button" className="return-result" onClick={() => void lookupInvoice(s.invoiceNumber)} style={{ display: "block", textAlign: "left", width: "100%", padding: 12 }}>

              <strong>{s.invoiceNumber}</strong> · {s.customerName || "Walk-in"}

            </button>)}

          </div>}

        </div>

        <button type="submit" className="btn-primary" disabled={loadingInvoice}>{loadingInvoice ? <Loader2 size={15} className="animate-spin"/> : "Find invoice"}</button>

      </form>

    </section>



    {invoice && <section className="panel" style={{ padding: 18, marginBottom: 16 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>

        <div><strong>{invoice.invoiceNumber}</strong><p>{invoice.customerName || "Walk-in"} · {invoice.customerPhone || "No phone"}</p><small>{showDate(invoice.invoiceDate)}</small></div>

        <button className="btn-outline" onClick={() => { setInvoice(null); setQuantities({}); }}>Close invoice</button>

      </div>

      <p style={{ fontSize: 13, marginBottom: 12 }}>Use − and + to select how many units to return (up to the remaining eligible quantity). Bill discount: {invoice.billDiscountMode === "percent" ? `${invoice.billDiscountValue}%` : formatINR(invoice.billDiscountPaise)}.</p>

      <div className="table-scroll"><table className="data-table">

        <thead><tr><th>PRODUCT / BARCODE</th><th>PURCHASED</th><th>ALREADY RETURNED</th><th>RETURN QTY</th><th>ORIGINAL</th><th>PRODUCT DISCOUNT</th><th>BILL DISCOUNT</th><th>NET RETURN</th><th>STATUS</th></tr></thead>

        <tbody>{invoice.items.map(item => {

          const qty = quantities[item.id] ?? 0;

          const part = breakdown.find(entry => entry.id === item.id);

          return <tr key={item.id}>

            <td><strong>{item.productName}</strong><div className="table-sub">{item.barcode}</div></td>

            <td>{item.quantity}</td>

            <td>{item.returnedQuantity}</td>

            <td><div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>

              <button className="btn-outline" type="button" aria-label={`Decrease return quantity for ${item.productName}`} disabled={qty <= 0 || saving} onClick={() => updateQuantity(item, qty - 1)}><Minus size={14}/></button>

              <strong style={{ minWidth: 24, textAlign: "center" }}>{qty}</strong>

              <button className="btn-outline" type="button" aria-label={`Increase return quantity for ${item.productName}`} disabled={!item.canReturn || qty >= item.canReturnQuantity || saving} onClick={() => updateQuantity(item, qty + 1)}><Plus size={14}/></button>

            </div><div className="table-sub">{item.canReturnQuantity} eligible</div></td>

            <td>{formatINR(part?.gross ?? 0)}</td>

            <td>{part ? (item.discountMode === "percent" ? `${Number(item.discountValue)}% (${formatINR(part.itemDiscount)})` : `${formatINR(part.itemDiscount)} (fixed)`) : "—"}</td>

            <td>{formatINR(part?.billShare ?? 0)}{(part?.oldCreditShare ?? 0) > 0 && <div className="table-sub">Prior credit: {formatINR(part!.oldCreditShare)}</div>}</td>

            <td><strong>{formatINR(part?.settlement ?? 0)}</strong></td>

            <td>{item.canReturnQuantity === 0 ? <span className="badge">Fully returned</span> : item.returnedQuantity > 0 ? "Partially returned" : "Eligible"}</td>

          </tr>;

        })}</tbody>

      </table></div>

      <div style={{ display: "grid", gap: 6, maxWidth: 400, marginTop: 14 }}>

        <div style={{ display: "flex", justifyContent: "space-between" }}>Original returned items <strong>{formatINR(gross)}</strong></div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>Product discounts <strong>− {formatINR(itemDiscount)}</strong></div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>Allocated bill discount <strong>− {formatINR(billShare)}</strong></div>

        {oldCreditShare > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}>Prior credit allocated <strong>− {formatINR(oldCreditShare)}</strong></div>}

        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, paddingTop: 8, borderTop: "1px solid #cbd5e1" }}>OVERALL SETTLEMENT <strong>{formatINR(settlement)}</strong></div>

      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>

        <button type="button" className="btn-primary" disabled={!chosen.length || saving} onClick={() => setConfirmation("return")}><RotateCcw size={16}/> Save selected return</button>

      </div>

    </section>}



    {lastSaved && <section className="panel" style={{ padding: 17, marginBottom: 16 }}>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><CheckCircle2 size={19}/>

        <strong>Return saved: {lastSaved.returnNumber}</strong><span>Settlement {formatINR(lastSaved.settlementPaise)} · PENDING</span>

        <button className="btn-primary" type="button" disabled={printingId === lastSaved.id} onClick={() => void openReceipt(lastSaved)}><Printer size={15}/> Print return receipt</button>

        <button className="btn-outline" type="button" onClick={() => setLastSaved(null)}>Dismiss</button>

      </div>

    </section>}



    <section className="panel" style={{ padding: 20 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>

        <div><h2 style={{ fontSize: 18, fontWeight: 700 }}>Saved return history</h2><p>Print any return or mark a pending return as Claimed after the new purchase.</p></div>

        <button className="btn-outline" type="button" disabled={loadingHistory} onClick={() => void loadHistory()}><RefreshCw size={15}/> Refresh</button>

      </div>

      <div style={{ display: "grid", gap: 12, marginBottom: 15 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ flex: "2 1 230px", display: "grid", gap: 5, fontSize: 12 }}>
            <strong>Search return bills</strong>
            <span className="return-search" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Search size={16}/><input value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                placeholder="Return no, invoice, customer, phone, product, barcode" aria-label="Search saved return bills" />
            </span>
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 12 }}><strong>Date filter</strong>
            <select className="btn-outline" value={period} onChange={e=>setPeriod(e.target.value as ReturnPeriod)}>
              {reportPeriods.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 12 }}><strong>Claim status</strong>
            <select className="btn-outline" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as ReturnStatus)}>
              <option value="ALL">All statuses</option><option value="PENDING">Unclaimed / pending</option>
              <option value="CLAIMED">Claimed</option><option value="LEGACY_NO_CREDIT">Old stock-only returns</option>
            </select>
          </label>
          <button type="button" className="btn-outline" disabled={!!exporting || loadingHistory || invalidRange || !filteredHistory.length}
            onClick={()=>void exportPdf()}><FileText size={15}/> {exporting==="PDF"?"Exporting...":"Export PDF"}</button>
          <button type="button" className="btn-outline" disabled={!!exporting || loadingHistory || invalidRange || !filteredHistory.length}
            onClick={()=>void exportExcel()}><FileSpreadsheet size={15}/> {exporting==="Excel"?"Exporting...":"Export Excel"}</button>
        </div>
        {period === "Custom Range" && <div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>From <input className="btn-outline" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>To <input className="btn-outline" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
          {invalidRange && <span role="alert" style={{color:"#b91c1c"}}>Choose valid dates (From must not be after To).</span>}
        </div>}
        <p style={{ fontSize: 12, opacity: .7 }}><CalendarDays size={13} style={{ display: "inline" }}/> {reportSubtitle} · {filteredHistory.length} matching return bills</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 10, marginBottom: 17 }}>
        {([
          ["Return bills", metrics.count], ["Claimed returns", metrics.claimedCount],
          ["Unclaimed returns", metrics.pendingCount], ["Old stock-only", metrics.legacyCount],
          ["Returned units", metrics.units], ["Product lines", metrics.lines],
          ["Original returned value", formatINR(metrics.gross)],
          ["Product discount", formatINR(metrics.productDiscount)],
          ["Allocated bill discount", formatINR(metrics.billDiscount)],
          ["Prior purchase credit", formatINR(metrics.previousCredit)],
          ["Total settlement", formatINR(metrics.overall)],
          ["Claimed amount", formatINR(metrics.claimedAmount)],
          ["UNCLAIMED amount", formatINR(metrics.pendingAmount)],
        ] as Array<[string,string | number]>).map(([label,value])=><div key={label}
          style={{ padding: 12, border: "1px solid #dbe3ef", borderRadius: 9, background: "var(--card, #fff)" }}>
          <small style={{display:"block",marginBottom:6}}>{label}</small><strong>{value}</strong>
        </div>)}
      </div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>RETURN</th><th>ORIGINAL INVOICE</th><th>PRODUCTS</th><th>SETTLEMENT</th><th>STATUS</th><th>ACTIONS</th></tr></thead>

        <tbody>{filteredHistory.map(r => <tr key={r.id}>

          <td><strong>{r.returnNumber}</strong><div className="table-sub">{showDate(r.createdAt)}</div></td>

          <td>{r.invoiceNumber}<div className="table-sub">{r.customerName || "Walk-in"}</div></td>

          <td>{r.items.map(item => `${item.name} × ${item.quantity}`).join(", ")}</td>

          <td><strong>{r.status === "LEGACY_NO_CREDIT" ? "—" : formatINR(r.settlementPaise)}</strong></td>

          <td><span className="badge">{r.status === "PENDING" ? "Pending" : r.status === "CLAIMED" ? "Claimed" : "Old stock-only return"}</span></td>

          <td><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

            <button className="btn-outline" type="button" disabled={printingId === r.id} onClick={() => void openReceipt(r)}><Printer size={14}/> Print</button>

            {r.status === "PENDING" && <button className="btn-primary" type="button" disabled={saving} onClick={() => setConfirmation(r.id)}>Claim</button>}

          </div></td>

        </tr>)}

          {!filteredHistory.length && <tr><td colSpan={6}>{loadingHistory ? "Loading returns..." : invalidRange ? "Select a valid date range" : "No returns match the selected filters"}</td></tr>}

        </tbody></table></div>

    </section>



    {confirmation === "return" && <ActionDialog title="Confirm product return" description="This will permanently save selected returns and add eligible units back to stock." onClose={() => { if (!saving) setConfirmation(null); }}>

      <div className="modal-body"><p>{breakdown.reduce((n, item) => n + item.quantity, 0)} unit(s) across {chosen.length} product line(s) · Settlement: <strong>{formatINR(settlement)}</strong></p>

        <div className="modal-footer"><button className="btn-outline" disabled={saving} onClick={() => setConfirmation(null)}>Cancel</button>

          <button className="btn-primary" disabled={saving} onClick={() => void saveReturn()}>{saving ? "Saving..." : "Confirm and save"}</button></div></div>

    </ActionDialog>}

    {confirmation && confirmation !== "return" && <ActionDialog title="Mark return credit as Claimed?" description="Only do this after completing the new purchase with the manually entered returned discount." onClose={() => { if (!saving) setConfirmation(null); }}>

      <div className="modal-body"><p>Once claimed, this return record cannot be claimed again. Make sure the credit was adjusted in the new purchase first.</p>

        <div className="modal-footer"><button className="btn-outline" disabled={saving} onClick={() => setConfirmation(null)}>Cancel</button>

          <button className="btn-primary" disabled={saving} onClick={() => void claimReturn(confirmation)}>{saving ? "Saving..." : "Yes, mark Claimed"}</button></div></div>

    </ActionDialog>}

  </RetailLayout>;

}

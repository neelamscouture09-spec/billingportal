import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Download, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import RetailLayout from "@/components/RetailLayout";
import { formatINR } from "@/lib/retail";

const API = (import.meta.env.VITE_API_BASE_URL || "https://billingportal-kappa.vercel.app/").replace(/\/+$/, "");
const methods = ["Cash", "Card", "UPI", "Bank Transfer", "Other"] as const;
type Method = typeof methods[number];
type PaymentRow = { id: string; method: Method; amount: string };
const createPaymentRow = (method: Method = "Cash", amount = ""): PaymentRow => ({
  id: crypto.randomUUID(), method, amount,
});
type Product = { id: string; name: string; size: string; barcode: string; sellingPrice: string | number };
type TrialItem = { id: string; productId: string; productName: string; barcode: string; size: string;
  unitPricePaise: number; productDiscountPaise: number; netPaise: number; status: string; source?: string };
type TrialPayment = { id: string; kind: string; method: string; amountPaise: number; createdAt: string };
type Trial = { id: string; trialNumber: string; status: string; createdAt: string; customerName: string;
  customerPhone: string; customerEmail?: string; customerAddress?: string; subtotalPaise: number; productDiscountPaise: number;
  billDiscountMode: string; billDiscountValue: string; billDiscountPaise: number;
  totalPaise: number; finalTotalPaise: number | null; paidPaise: number; refundedPaise: number;
  balancePaise: number; checkoutInvoiceId: string | null; items: TrialItem[]; payments: TrialPayment[] };
const money = formatINR;
const toPaiseStrict = (text: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim() || "0")) throw new Error("Enter a valid rupee amount");
  const n = Math.round(Number(text || "0") * 100);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid amount");
  return n;
};
const percent = (base: number, value: number) => Math.round(base * value / 100);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, cache: "no-store", credentials: "omit",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

// Reuse the exact branded A5 image used in Reports.tsx.
// Keep the file at frontend/public/neelams_receipt_a5.jpg.
const TRIAL_RECEIPT_BACKGROUND = "/neelams_receipt_a5.jpg";
const TRIAL_A5_WIDTH = 148;
const TRIAL_A5_HEIGHT = 210;
const TRIAL_ITEMS_PER_PAGE = 5;
const TRIAL_BLUE: [number, number, number] = [12, 58, 140];
const TRIAL_RULE: [number, number, number] = [170, 187, 215];
let trialReceiptBackgroundPromise: Promise<string> | null = null;

async function getTrialReceiptBackground(): Promise<string> {
  if (!trialReceiptBackgroundPromise) {
    trialReceiptBackgroundPromise = (async () => {
      const response = await fetch(TRIAL_RECEIPT_BACKGROUND, { cache: "force-cache" });
      if (!response.ok) throw new Error("Receipt background missing: frontend/public/neelams_receipt_a5.jpg");
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Unable to load receipt background"));
        reader.readAsDataURL(blob);
      });
    })().catch(error => {
      trialReceiptBackgroundPromise = null;
      throw error;
    });
  }
  return trialReceiptBackgroundPromise;
}

function trialReceiptDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}

// Uses the same background, positioning, blue text, 5-items-per-page layout
// and last-page summary as the Sales Reports receipt. Trials are explicitly
// labelled NOT A SALE; only a completed NEEL invoice is a sale receipt.
async function downloadTrialReceipt(trial: Trial) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait", compress: true });
  const image = await getTrialReceiptBackground();
  const left = 8, right = TRIAL_A5_WIDTH - 8;
  const allItems = trial.items;
  const pageCount = Math.max(1, Math.ceil(allItems.length / TRIAL_ITEMS_PER_PAGE));
  const rupees = (paise: number) => `Rs. ${(paise / 100).toFixed(2)}`;
  const draw = (text: string, x: number, y: number, align?: "right" | "center") =>
    pdf.text(text, x, y, align ? { align } : undefined);
  const summaryRow = (label: string, amount: string, y: number, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(bold ? 9.1 : 7.5);
    draw(label, left + 1, y);
    draw(amount, right - 1, y, "right");
  };

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    if (pageIndex) pdf.addPage("a5", "portrait");
    pdf.addImage(image, "JPEG", 0, 0, TRIAL_A5_WIDTH, TRIAL_A5_HEIGHT);
    pdf.setTextColor(...TRIAL_BLUE);
    pdf.setDrawColor(...TRIAL_RULE);
    pdf.setLineWidth(0.16);

    // The JPG says BILL OF SUPPLY by default. Mask only that printed heading
    // (leave the red separator/logo/GSTIN untouched), then identify this as a trial.
    pdf.setFillColor(255, 255, 255);
    pdf.rect(37, 35.4, 75, 7.2, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    draw(trial.status === "OPEN" ? "TRIAL DELIVERY SLIP  |  NOT A SALE" :
      "TRIAL SETTLEMENT SLIP", TRIAL_A5_WIDTH / 2, 40.7, "center");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.3);
    draw(`TRIAL: ${trial.trialNumber}`, left, 50);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.3);
    draw(trialReceiptDate(trial.createdAt), right, 50, "right");
    if (pageCount > 1) {
      pdf.setFontSize(6.6);
      draw(`Page ${pageIndex + 1} / ${pageCount}`, right, 54.5, "right");
    }

    if (pageIndex === 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.2);
      draw("ISSUED TO", left, 57);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      draw(pdf.splitTextToSize(`Name: ${trial.customerName || "-"}`, 120)[0] || "", left, 62);
      draw(`Phone: ${trial.customerPhone || "-"}`.slice(0, 65), left, 67);
      draw(`Email: ${trial.customerEmail || "-"}`.slice(0, 75), left, 72);
      pdf.setFontSize(7.1);
      pdf.text(pdf.splitTextToSize(`Address: ${trial.customerAddress || "-"}`, 122).slice(0, 2), left, 76.5);
    } else {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.6);
      draw(`Customer: ${trial.customerName || "-"}`.slice(0, 68), left, 60);
    }

    const headerY = pageIndex === 0 ? 85 : 70;
    pdf.line(left, headerY - 4, right, headerY - 4);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.9);
    draw("#", left + 1, headerY);
    draw("PRODUCT / SIZE / BARCODE", 14, headerY);
    draw("QTY", 92, headerY, "right");
    draw("RATE", 110, headerY, "right");
    draw("DISC.", 126, headerY, "right");
    draw("AMOUNT", right, headerY, "right");
    pdf.line(left, headerY + 2.5, right, headerY + 2.5);

    const rowHeight = 9.2;
    const rowsStartY = headerY + 2.5;
    const pageItems = allItems.slice(pageIndex * TRIAL_ITEMS_PER_PAGE,
      (pageIndex + 1) * TRIAL_ITEMS_PER_PAGE);
    pageItems.forEach((item, index) => {
      const y = rowsStartY + index * rowHeight;
      const nameLines = pdf.splitTextToSize(item.productName || "-", 65).slice(0, 2);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(nameLines.length === 2 ? 6.3 : 7.2);
      draw(String(pageIndex * TRIAL_ITEMS_PER_PAGE + index + 1), left + 1, y + 5.4);
      pdf.text(nameLines, 14, y + (nameLines.length === 2 ? 3 : 3.5));
      pdf.setFontSize(6.0);
      const itemStatus = trial.status === "OPEN" ? "ON TRIAL" : item.status;
      const details = `${item.size || "-"} | ${item.barcode || "-"} | ${itemStatus}`;
      if (nameLines.length === 1) draw(details.slice(0, 55), 14, y + 7);
      else draw(details.slice(0, 32), 45, y + 7.8);
      pdf.setFontSize(6.6);
      draw("1", 92, y + 5.4, "right");
      draw(rupees(item.unitPricePaise), 110, y + 5.4, "right");
      draw(rupees(item.productDiscountPaise), 126, y + 5.4, "right");
      draw(rupees(item.netPaise), right, y + 5.4, "right");
      pdf.line(left, y + rowHeight, right, y + rowHeight);
    });

    if (pageIndex !== pageCount - 1) {
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(7.3);
      draw("Continued on next page...", left, 147);
      continue;
    }

    const summaryY = Math.max(141, rowsStartY + pageItems.length * rowHeight + 4);
    if (summaryY > 145) throw new Error("Trial receipt summary exceeds the A5 page");
    pdf.line(left, summaryY - 3, right, summaryY - 3);
    const hasSettled = trial.status !== "OPEN";
    const purchaseTotal = hasSettled ? (trial.finalTotalPaise ?? 0) : trial.totalPaise;
    const netReceived = trial.paidPaise - trial.refundedPaise;
    summaryRow(hasSettled ? "Initial trial value" : "Original amount", rupees(trial.subtotalPaise), summaryY + 1);
    summaryRow("Trial product discounts", `- ${rupees(trial.productDiscountPaise)}`, summaryY + 6);
    summaryRow("Bill discount", `- ${rupees(trial.billDiscountPaise)}`, summaryY + 11);
    summaryRow(hasSettled ? "FINAL PURCHASE" : "TRIAL VALUE", rupees(hasSettled ? purchaseTotal : trial.totalPaise), summaryY + 17, true);
    pdf.line(left, summaryY + 20, right, summaryY + 20);
    summaryRow("Total received", rupees(trial.paidPaise), summaryY + 25);
    if (trial.refundedPaise > 0) summaryRow("Refunded", `- ${rupees(trial.refundedPaise)}`, summaryY + 30);
    summaryRow("NET PAID", rupees(netReceived), summaryY + (trial.refundedPaise > 0 ? 35 : 30), true);
    if (trial.status === "OPEN") {
      summaryRow("BALANCE DUE", rupees(trial.balancePaise), summaryY + (trial.refundedPaise > 0 ? 40 : 35), true);
    }
    // Payment detail should remain clear of the static terms printed near 184mm.
    const paymentLines = trial.payments.filter(p => p.amountPaise > 0)
      .map(p => `${p.kind === "REFUND" ? "Refund " : ""}${p.method}: ${rupees(p.amountPaise)}`);
    const payText = paymentLines.length ? `Payments: ${paymentLines.join(" | ")}` : "Payments: No advance received";
    const payY = trial.status === "OPEN" ? summaryY + 40 : summaryY + (trial.refundedPaise > 0 ? 40 : 35);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.0);
    pdf.text(pdf.splitTextToSize(payText, TRIAL_A5_WIDTH - 18).slice(0, 2), left + 1, Math.min(181, payY));
  }
  pdf.save(`${trial.trialNumber}-${trial.status.toLowerCase()}.pdf`);
}
export default function Trials() {
  const [, navigate] = useLocation();
  const [trials, setTrials] = useState<Trial[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("OPEN");
  const [selected, setSelected] = useState<Trial | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState<Product[]>([]);
  const [extraSearch, setExtraSearch] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([createPaymentRow()]);
  const [refunds, setRefunds] = useState<PaymentRow[]>([createPaymentRow()]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<{ trials: Trial[] }>(`/api/trials?status=${status}`);
      setTrials(data.trials);
      setSelected(old => old ? data.trials.find(t => t.id === old.id) ?? old : null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Cannot load trials"); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function openTrial(trial: Trial) {
    setSelected(trial);
    setKept(Object.fromEntries(trial.items.map(i => [i.id, i.status === "ON_TRIAL"])));
    setAdded([]); setPayments([createPaymentRow()]); setRefunds([createPaymentRow()]); setExtraSearch("");
    try {
      const data = await request<{ products: Product[] }>("/api/products/all?sold=false");
      setMore(data.products);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Cannot load additional products"); }
  }

  const visible = trials.filter(t => [t.trialNumber, t.customerName, t.customerPhone]
    .some(v => v.toLowerCase().includes(search.toLowerCase().trim())));
  const keptItems = selected?.items.filter(i => kept[i.id]) ?? [];
  const keptNet = keptItems.reduce((n, i) => n + i.netPaise, 0);
  const addedProducts = more.filter(p => added.includes(p.id));
  const addedNet = addedProducts.reduce((n, p) => n + Math.round(Number(p.sellingPrice) * 100), 0);
  const billBase = keptNet + addedNet;
  const appliedBillDiscount = selected ? selected.billDiscountMode === "percent"
    ? percent(billBase, Number(selected.billDiscountValue))
    : Math.min(billBase, Math.round(Number(selected.billDiscountValue) * 100)) : 0;
  const finalTotal = Math.max(0, billBase - appliedBillDiscount);
  const advanceNet = selected ? selected.paidPaise - selected.refundedPaise : 0;
  const amountToCollect = Math.max(0, finalTotal - advanceNet);
  const amountToRefund = Math.max(0, advanceNet - finalTotal);

  function setPaymentRow(kind: "payments" | "refunds", id: string, patch: Partial<PaymentRow>) {
    const setter = kind === "payments" ? setPayments : setRefunds;
    setter(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  function addPaymentRow(kind: "payments" | "refunds") {
    const rows = kind === "payments" ? payments : refunds;
    const unused = methods.find(method => !rows.some(row => row.method === method));
    if (!unused) return toast.error("All payment methods have been added");
    (kind === "payments" ? setPayments : setRefunds)(previous => [...previous, createPaymentRow(unused)]);
  }

  function removePaymentRow(kind: "payments" | "refunds", id: string) {
    const setter = kind === "payments" ? setPayments : setRefunds;
    setter(rows => rows.filter(row => row.id !== id));
  }

  function parsePaymentRows(rows: PaymentRow[], label: string) {
    const used = new Set<string>();
    return rows.map(row => ({ method: row.method, amountPaise: toPaiseStrict(row.amount) }))
      .filter(row => row.amountPaise > 0)
      .map(row => {
        if (used.has(row.method)) throw new Error(`Choose each ${label} method only once`);
        used.add(row.method);
        return row;
      });
  }

  let collectedPreview = 0;
  let refundedPreview = 0;
  let invalidEntry = false;
  try {
    collectedPreview = payments.reduce((sum, row) => sum + toPaiseStrict(row.amount), 0);
    refundedPreview = refunds.reduce((sum, row) => sum + toPaiseStrict(row.amount), 0);
  } catch { invalidEntry = true; }

  async function settle() {
    if (!selected || busy || selected.status !== "OPEN") return;
    let paymentEntries: { method: string; amountPaise: number }[];
    let refundEntries: { method: string; amountPaise: number }[];
    try {
      paymentEntries = parsePaymentRows(payments, "payment");
      refundEntries = parsePaymentRows(refunds, "refund");
    } catch (e) { return toast.error(e instanceof Error ? e.message : "Invalid amount"); }
    const paymentPaise = paymentEntries.reduce((sum, row) => sum + row.amountPaise, 0);
    const refundPaise = refundEntries.reduce((sum, row) => sum + row.amountPaise, 0);
    if (paymentPaise !== amountToCollect || refundPaise !== amountToRefund) {
      toast.error(`Collect ${money(amountToCollect)} and refund ${money(amountToRefund)} to settle exactly`);
      return;
    }
    setBusy(true);
    try {
      const data = await request<{ trial: Trial; invoiceNumber: string | null }>(`/api/trials/${selected.id}/settle`, {
        method: "POST", body: JSON.stringify({
          keptTrialItemIds: selected.items.filter(i => kept[i.id]).map(i => i.id),
          addedProductIds: added,
          payments: paymentEntries,
          refunds: refundEntries,
        }),
      });
      setSelected(data.trial);
      setTrials(old => old.map(t => t.id === data.trial.id ? data.trial : t));
      toast.success(data.invoiceNumber ? `Final invoice ${data.invoiceNumber} saved` : "Trial cancelled and items released");
      await downloadTrialReceipt(data.trial);
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Settlement failed"); }
    finally { setBusy(false); }
  }

  return <RetailLayout>
    <div className="page-heading"><div><div className="eyebrow">CUSTOMER TRIALS</div><h1>Trial bills</h1>
      <p>Track items on trial, advances and balances; return unwanted products and complete purchases.</p></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button>
        <button className="btn-primary" onClick={() => navigate("/")}><Plus size={15}/> Create in billing</button>
      </div></div>
    <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label className="return-search" style={{ flex: 1 }}><Search size={16}/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Trial number, customer name or phone"/></label>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="OPEN">Open trials</option><option value="SETTLED">Settled</option>
          <option value="CANCELLED">Cancelled</option><option value="all">All trials</option>
        </select>
      </div>
      {loading && <p style={{ padding: 12 }}><Loader2 size={15} className="animate-spin"/> Loading trials...</p>}
      <div className="table-scroll"><table className="data-table"><thead><tr>
        <th>TRIAL</th><th>CUSTOMER</th><th>ITEMS</th><th>INITIAL TOTAL</th><th>RECEIVED</th><th>BALANCE</th><th>STATUS</th><th>ACTION</th>
      </tr></thead><tbody>{visible.map(t => <tr key={t.id}>
        <td>{t.trialNumber}</td><td><strong>{t.customerName}</strong><div className="table-sub">{t.customerPhone}</div></td>
        <td>{t.items.length}</td><td>{money(t.totalPaise)}</td><td>{money(t.paidPaise)}</td>
        <td>{money(t.balancePaise)}</td><td>{t.status}</td>
        <td><button className="btn-outline" onClick={() => void openTrial(t)}>View / settle</button></td>
      </tr>)}</tbody></table></div>
      {!loading && !visible.length && <p style={{ padding: 14 }}>No matching trials found.</p>}
    </section>
    {selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setSelected(null); }}>
      <section className="modal-card" role="dialog" aria-modal="true" style={{ width: "min(95vw, 1000px)", maxHeight: "92vh", overflowY: "auto" }}>
        <header className="modal-header"><div><h2>{selected.trialNumber}</h2><p>{selected.customerName} · {selected.customerPhone} · {selected.status}</p></div>
          <button className="icon-button" onClick={() => setSelected(null)} disabled={busy}><X size={18}/></button></header>
        <div className="modal-body" style={{ display: "grid", gap: 16 }}>
          <section><h3>Trial items — untick unwanted products</h3><div className="table-scroll"><table className="data-table">
            <thead><tr><th>KEEP</th><th>PRODUCT</th><th>ORIGINAL</th><th>DISCOUNT</th><th>NET</th><th>STATUS</th></tr></thead>
            <tbody>{selected.items.map(i => <tr key={i.id}>
              <td><input type="checkbox" disabled={selected.status !== "OPEN"} checked={!!kept[i.id]}
                onChange={e => setKept(old => ({ ...old, [i.id]: e.target.checked }))}/></td>
              <td><strong>{i.productName}</strong><div className="table-sub">{i.size} · {i.barcode}</div></td>
              <td>{money(i.unitPricePaise)}</td><td>{money(i.productDiscountPaise)}</td><td>{money(i.netPaise)}</td><td>{i.status}</td>
            </tr>)}</tbody></table></div></section>
          {selected.status === "OPEN" && <section>
            <h3>Add more products to the final purchase</h3>
            <label className="return-search"><Search size={15}/><input value={extraSearch}
              onChange={e => setExtraSearch(e.target.value)} placeholder="Search available products by name or barcode"/></label>
            {extraSearch && <div className="table-scroll" style={{ maxHeight: 170, overflow: "auto", marginTop: 8 }}>
              {more.filter(p => !selected.items.some(i => i.productId === p.id) &&
                `${p.name} ${p.barcode}`.toLowerCase().includes(extraSearch.toLowerCase())).slice(0, 12)
                .map(p => <label key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: 8, gap: 8 }}>
                  <span><input type="checkbox" checked={added.includes(p.id)} onChange={e => setAdded(v =>
                    e.target.checked ? [...v, p.id] : v.filter(id => id !== p.id))}/> {p.name} · {p.barcode}</span>
                  <b>{money(Math.round(Number(p.sellingPrice) * 100))}</b>
                </label>)}</div>}
            {!!addedProducts.length && <p>Additional: {addedProducts.map(p => p.name).join(", ")}</p>}
          </section>}
          <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h3>Payment & settlement</h3>
            <div>Initial trial value: <strong>{money(selected.totalPaise)}</strong></div>
            <div>Original advance received: <strong>{money(selected.paidPaise)}</strong></div>
            {selected.refundedPaise > 0 && <div>Already refunded: <strong>{money(selected.refundedPaise)}</strong></div>}
            {selected.status === "OPEN" ? <>
              <div>Kept products + new products (after bill discount): <strong>{money(finalTotal)}</strong></div>
              <div>Additional payment required: <strong>{money(amountToCollect)}</strong></div>
              <div>Refund due: <strong>{money(amountToRefund)}</strong></div>
              {amountToCollect > 0 && <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong>Collect payments (multiple methods)</strong>
                  <button className="btn-outline" type="button" disabled={busy || payments.length >= methods.length}
                    onClick={() => addPaymentRow("payments")}><Plus size={14}/> Add method</button>
                </div>
                {payments.map(row => <div key={row.id} style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <label className="field" style={{ flex: "1 1 160px" }}><span>AMOUNT (₹)</span>
                    <input type="number" min="0" step="0.01" value={row.amount}
                      onChange={e => setPaymentRow("payments", row.id, { amount: e.target.value })}
                      placeholder={(amountToCollect / 100).toFixed(2)}/></label>
                  <label className="field" style={{ flex: "1 1 160px" }}><span>METHOD</span>
                    <select value={row.method} onChange={e => setPaymentRow("payments", row.id, { method: e.target.value as Method })}>
                      {methods.map(m => <option key={m} value={m} disabled={payments.some(other => other.id !== row.id && other.method === m)}>{m}</option>)}
                    </select></label>
                  <button type="button" className="btn-outline" aria-label="Remove payment method" disabled={busy}
                    onClick={() => removePaymentRow("payments", row.id)}><X size={15}/></button>
                </div>)}
                <div><strong>Payment entered: {invalidEntry ? "Invalid amount" : money(collectedPreview)}</strong> · Remaining to enter: {money(Math.max(0, amountToCollect - collectedPreview))}</div>
              </div>}
              {amountToRefund > 0 && <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong>Refund by payment method</strong>
                  <button type="button" className="btn-outline" disabled={busy || refunds.length >= methods.length}
                    onClick={() => addPaymentRow("refunds")}><Plus size={14}/> Add method</button>
                </div>
                {refunds.map(row => <div key={row.id} style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <label className="field" style={{ flex: "1 1 160px" }}><span>REFUND AMOUNT (₹)</span>
                    <input type="number" min="0" step="0.01" value={row.amount}
                      onChange={e => setPaymentRow("refunds", row.id, { amount: e.target.value })}
                      placeholder={(amountToRefund / 100).toFixed(2)}/></label>
                  <label className="field" style={{ flex: "1 1 160px" }}><span>REFUND METHOD</span>
                    <select value={row.method} onChange={e => setPaymentRow("refunds", row.id, { method: e.target.value as Method })}>
                      {methods.map(m => <option key={m} value={m} disabled={refunds.some(other => other.id !== row.id && other.method === m)}>{m}</option>)}
                    </select></label>
                  <button type="button" className="btn-outline" aria-label="Remove refund method" disabled={busy}
                    onClick={() => removePaymentRow("refunds", row.id)}><X size={15}/></button>
                </div>)}
                <div><strong>Refund entered: {invalidEntry ? "Invalid amount" : money(refundedPreview)}</strong> · Remaining to enter: {money(Math.max(0, amountToRefund - refundedPreview))}</div>
              </div>}
              <p style={{ fontSize: 12, color: "#64748b" }}>Use the original payment method for refunds. The server verifies prices, reservations, and exact settlement.</p>
            </> : <><CheckCircle2 size={17}/> Finalized total: {money(selected.finalTotalPaise ?? 0)} · Remaining balance: {money(selected.balancePaise)}</>}
          </section>
          <div className="modal-footer" style={{ flexWrap: "wrap" }}>
            <button className="btn-outline" onClick={() => void downloadTrialReceipt(selected)}><Download size={15}/> Download A5 slip</button>
            <button className="btn-outline" onClick={() => setSelected(null)}>Close</button>
            {selected.status === "OPEN" && <button className="btn-primary" disabled={busy || invalidEntry || collectedPreview !== amountToCollect || refundedPreview !== amountToRefund} onClick={() => void settle()}>
              {busy ? <Loader2 className="animate-spin" size={15}/> : <CheckCircle2 size={15}/>} Confirm settlement
            </button>}
          </div>
        </div>
      </section>
    </div>}
  </RetailLayout>;
}

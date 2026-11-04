// frontend/client/src/pages/Returns.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import RetailLayout from "@/components/RetailLayout";
import { ActionDialog } from "@/components/ActionDialog";
import { formatINR } from "@/lib/retail";
import { invalidateProductCache } from "@/lib/productCatalogCache";

const API = (import.meta.env.VITE_API_BASE_URL || "https://billingportal-kappa.vercel.app/").replace(/\/+$/, "");

// Matches GET /api/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD.
type SaleItem = {
  id: string;
  productId: string;
  productName: string;
  barcode: string;
  size: string;
  category: string;
  supplierCode?: string | null;
  quantity: number;
  unitPricePaise: number;
  grossPaise: number;
  productDiscountPaise: number;
  discountMode: string;
  discountValue: string;
  netPaise: number;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerPhone: string;
  status: string;
  totalPaise: number;
  billDiscountPaise: number;
  billDiscountMode: string;
  billDiscountValue: string;
  returnedDiscountPaise?: number;
  items: SaleItem[];
};

type SalesResponse = { success: boolean; error?: string; invoices?: Invoice[] };
type RestoreResponse = { success: boolean; error?: string; restoredCount?: number };

function istToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function monthStart(date: string) { return `${date.slice(0, 7)}-01`; }
function discountLabel(item: SaleItem) {
  if (!item.productDiscountPaise) return "No discount";
  return item.discountMode?.toLowerCase() === "percent"
    ? `${Number(item.discountValue)}% (${formatINR(item.productDiscountPaise)})`
    : `${formatINR(item.productDiscountPaise)} (₹ fixed)`;
}

type ItemAmounts = { billDiscountPaise: number; returnedCreditPaise: number; purchasedPaise: number };

// Split a saved invoice-level discount across its items without losing a paise.
// The invoice's saved billDiscountPaise is authoritative (rather than recomputing
// a percentage using floating-point arithmetic).
function allocatePaise<T extends { id: string }>(
  items: T[], weights: number[], amount: number,
): Map<string, number> {
  const allocated = new Map(items.map(item => [item.id, 0]));
  const totalWeight = weights.reduce((sum, n) => sum + n, 0);
  const target = Math.min(Math.max(0, Math.round(amount)), totalWeight);
  if (!items.length || totalWeight <= 0 || target === 0) return allocated;

  const shares = items.map((item, index) => {
    const exact = (target * weights[index]) / totalWeight;
    return { id: item.id, amount: Math.floor(exact), remainder: exact % 1 };
  });
  let remaining = target - shares.reduce((sum, share) => sum + share.amount, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  for (let index = 0; remaining > 0; index++, remaining--) {
    shares[index % shares.length].amount += 1;
  }
  shares.forEach(share => allocated.set(share.id, share.amount));
  return allocated;
}

function itemPurchaseAmounts(invoice: Invoice): Map<string, ItemAmounts> {
  const items = invoice.items;
  const netValues = items.map(item => Math.max(0, item.netPaise));
  const billShares = allocatePaise(items, netValues, invoice.billDiscountPaise || 0);
  const afterBillValues = items.map(item => item.netPaise - (billShares.get(item.id) || 0));
  const returnShares = allocatePaise(items, afterBillValues, invoice.returnedDiscountPaise || 0);
  return new Map(items.map(item => {
    const billDiscountPaise = billShares.get(item.id) || 0;
    const returnedCreditPaise = returnShares.get(item.id) || 0;
    return [item.id, {
      billDiscountPaise, returnedCreditPaise,
      purchasedPaise: item.netPaise - billDiscountPaise - returnedCreditPaise,
    }];
  }));
}

function billDiscountLabel(invoice: Invoice, amount: number): string {
  const mode = (invoice.billDiscountMode || "fixed").toLowerCase();
  return mode === "percent"
    ? `${Number(invoice.billDiscountValue)}% (${formatINR(amount)})`
    : `${formatINR(amount)} (fixed)`;
}

export default function Returns() {
  const today = istToday();
  const [from, setFrom] = useState(() => monthStart(istToday()));
  const [to, setTo] = useState(() => istToday());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [query, setQuery] = useState("");
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [returnedInSession, setReturnedInSession] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoredCount, setRestoredCount] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const fetchInvoices = useCallback(async (start: string, end: string, showToast = false) => {
    if (!start || !end || start > end) { toast.error("Select a valid date range"); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ from: start, to: end });
      const response = await fetch(`${API}/api/reports/sales?${params}`, {
        signal: controller.signal, cache: "no-store", credentials: "omit",
      });
      const data: SalesResponse = await response.json();
      if (!response.ok || data.success === false || !Array.isArray(data.invoices)) {
        throw new Error(data.error || "Could not load sales invoices");
      }
      setInvoices(data.invoices);
      // A refresh renews the invoice list, but selected returned items remain
      // disabled for this mounted session; backend validates authoritative status.
      if (showToast) toast.success(`${data.invoices.length} invoices loaded`);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Unable to load invoices";
      setLoadError(message);
      toast.error(message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Exactly one GET when this page mounts. No GET on typing or choosing an invoice.
  // When the page is unmounted and visited again, it makes a fresh GET.
  useEffect(() => {
    void fetchInvoices(monthStart(istToday()), istToday());
    return () => requestRef.current?.abort();
  }, [fetchInvoices]);

  // Local filtering from the invoices already loaded into component state.
  // No useMemo, no localStorage, and no separate invoice-lookup API request.
  const q = query.trim().toLowerCase();
  const suggestions = q.length < 1 ? [] : invoices
    .filter(row =>
      row.invoiceNumber.toLowerCase().includes(q) ||
      row.customerName.toLowerCase().includes(q) ||
      (row.customerPhone || "").includes(q)
    ).slice(0, 12);
  const chosen = (invoice?.items || []).filter(item => selected[item.id] && !returnedInSession[item.id]);
  const purchaseAmounts = invoice ? itemPurchaseAmounts(invoice) : new Map<string, ItemAmounts>();

  function openInvoice(target: Invoice) {
    setInvoice(target);
    setQuery(target.invoiceNumber);
    setShowSuggestions(false);
    setSelected({});
    setRestoredCount(null);
  }

  function findInvoice() {
    if (!query.trim()) return toast.error("Enter an invoice number");
    const match = invoices.find(row => row.invoiceNumber.toLowerCase() === query.trim().toLowerCase());
    if (match) openInvoice(match);
    else if (suggestions.length === 1) openInvoice(suggestions[0]);
    else toast.error("Select a matching invoice below or change the report date range");
  }

  async function restoreSelected() {
    if (!invoice || !chosen.length || saving) return;
    setSaving(true);
    try {
      // Status updates only: no exchange credit, no refund, and no separate GET.
      const response = await fetch(`${API}/api/returns`, {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, invoiceItemIds: chosen.map(item => item.id) }),
      });
      const result: RestoreResponse = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.error || "Return failed");
      setReturnedInSession(previous => ({
        ...previous,
        ...Object.fromEntries(chosen.map(item => [item.id, true])),
      }));
      setSelected({});
      setConfirm(false);
      setRestoredCount(result.restoredCount ?? chosen.length);
      invalidateProductCache();
      toast.success(`${result.restoredCount ?? chosen.length} product(s) available again`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to restore products");
    } finally { setSaving(false); }
  }

  return <RetailLayout>
    <div className="page-heading">
      <div><div className="eyebrow">AFTER-SALES</div><h1>Product returns</h1>
        <p>Select an invoice from sales records and restore the sold products you receive back.</p></div>
    </div>
    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Find original purchase</strong>
        <span style={{ fontSize: 12, opacity: .75 }}>{loading ? "Loading invoices…" : `${invoices.length} invoices loaded`}</span>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field"><span>FROM</span><input type="date" value={from} max={today} onChange={event => setFrom(event.target.value)} /></label>
        <label className="field"><span>TO</span><input type="date" value={to} max={today} onChange={event => setTo(event.target.value)} /></label>
        <button className="btn-outline" type="button" disabled={loading} onClick={() => void fetchInvoices(from, to, true)}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Load invoices
        </button>
      </div>
      <form onSubmit={event => { event.preventDefault(); findInvoice(); }} style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <label className="return-search" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Search size={16} />
            <input value={query} onChange={event => { setQuery(event.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)} placeholder="Invoice number, customer, or phone" aria-label="Search invoices" autoComplete="off" />
          </label>
          {showSuggestions && !!q && <div className="return-results" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 22px #0002", maxHeight: 290, overflowY: "auto" }}>
            {suggestions.length ? suggestions.map(row => <button key={row.id} type="button" className="return-result"
              onClick={() => openInvoice(row)} style={{ display: "flex", width: "100%", gap: 12, alignItems: "center", padding: 12, textAlign: "left" }}>
              <div style={{ flex: 1 }}><strong>{row.invoiceNumber}</strong><div style={{ fontSize: 12 }}>{row.customerName} · {row.customerPhone || "No phone"}</div></div>
              <span style={{ whiteSpace: "nowrap" }}>{formatINR(row.totalPaise)}</span>
            </button>) : <div style={{ padding: 12 }}>No matching invoices within selected dates</div>}
          </div>}
        </div>
        <button className="btn-primary" type="submit" disabled={loading}>{loading ? <Loader2 size={15} className="animate-spin" /> : "Find invoice"}</button>
      </form>
      {loadError && <p role="alert" style={{ color: "#b91c1c", marginTop: 12 }}>{loadError}</p>}
    </section>

    {invoice && <section className="panel" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div><strong>{invoice.invoiceNumber}</strong>
          <p>{invoice.customerName || "Walk-in"} · {invoice.customerPhone || "No phone"}</p>
          <small>{new Date(invoice.invoiceDate).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</small>
        </div>
        <button className="btn-outline" type="button" onClick={() => { setInvoice(null); setSelected({}); }}><ArrowLeft size={14}/> Back</button>
      </div>
      <p style={{ marginBottom: 8 }}>Tick the products you want to make available again. No refund or exchange credit is created.</p>
      <p style={{ marginBottom: 12, fontSize: 13 }}>
        Invoice bill discount: <strong>{billDiscountLabel(invoice, invoice.billDiscountPaise || 0)}</strong>.
        The purchased amount includes each product's discount and its share of the bill discount.
        {(invoice.returnedDiscountPaise || 0) > 0 && <> Prior returned credit: <strong>{formatINR(invoice.returnedDiscountPaise || 0)}</strong>.</>}
      </p>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>RETURN</th><th>PRODUCT</th><th>QTY</th><th>ORIGINAL</th><th>PRODUCT DISCOUNT</th><th>BILL DISCOUNT</th><th>PURCHASED</th><th>STATUS</th></tr></thead>
        <tbody>{invoice.items.map(item => {
          const returned = !!returnedInSession[item.id];
          const disabled = item.quantity !== 1 || returned;
          return <tr key={item.id}>
            <td><input type="checkbox" disabled={disabled} checked={!!selected[item.id] && !disabled}
              onChange={event => setSelected(previous => ({ ...previous, [item.id]: event.target.checked }))} aria-label={`Return ${item.productName}`} /></td>
            <td><strong>{item.productName}</strong><div className="table-sub">{item.size} · {item.barcode}</div></td>
            <td>{item.quantity}</td><td>{formatINR(item.grossPaise)}</td>
            <td>{discountLabel(item)}</td>
            <td>{billDiscountLabel(invoice, purchaseAmounts.get(item.id)?.billDiscountPaise || 0)}</td>
            <td>
              <strong>{formatINR(purchaseAmounts.get(item.id)?.purchasedPaise ?? item.netPaise)}</strong>
              {(invoice.returnedDiscountPaise || 0) > 0 && <div className="table-sub">
                Includes {formatINR(purchaseAmounts.get(item.id)?.returnedCreditPaise || 0)} return credit
              </div>}
            </td>
            <td>{returned ? <span className="badge">Returned</span> : item.quantity !== 1 ? "Unit tracking needed" : "Sold / not yet verified"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <div>Selected: <strong>{chosen.length}</strong></div>
        <button className="btn-primary" type="button" disabled={!chosen.length || saving} onClick={() => setConfirm(true)}><RotateCcw size={15}/> Restore selected products</button>
      </div>
    </section>}
    {!invoice && restoredCount !== null && <p><CheckCircle2 size={15} style={{ display: "inline" }} /> {restoredCount} product(s) restored.</p>}
    {confirm && <ActionDialog title="Confirm product return" description="Selected products will be marked available again." onClose={() => { if (!saving) setConfirm(false); }}>
      <div className="modal-body"><p>Restore <strong>{chosen.length}</strong> selected product(s)?</p>
        <div className="modal-footer"><button className="btn-outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => void restoreSelected()}>{saving ? "Saving…" : "Confirm return"}</button></div>
      </div>
    </ActionDialog>}
  </RetailLayout>;
}

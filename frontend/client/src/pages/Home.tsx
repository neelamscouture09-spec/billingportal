import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocation } from "wouter";

import {

  Barcode, Check, CheckCircle2, ChevronDown, CreditCard, Loader2,

  Minus, Package, PackagePlus, Plus, RefreshCw, Search, ShoppingBag, Edit3,

  Trash2, UserRound, Wallet, X, AlertCircle, Building2, Printer,

} from "lucide-react";

import { ActionDialog } from "@/components/ActionDialog";

import { toast } from "sonner";

import RetailLayout from "@/components/RetailLayout";

import { Button } from "@/components/ui/button";
import { buildReceiptPdf, type ReceiptInvoice } from "@/lib/receiptPdf";

import { Input } from "@/components/ui/input";

import {

  discountAmount, formatINR, spreadDiscount, toPaise,

  type DiscountMode, type TenderMethod,

} from "@/lib/retail";

// This page has no retailStore/mock-product dependency.

const API_BASE_URL = (

  import.meta.env.VITE_API_BASE_URL || "https://billingportal-kappa.vercel.app"

).replace(/\/+$/, "");

// Change this only if your real checkout route has a different path.

// The checkout backend must validate prices, stock, discounts and tender amounts.

const CHECKOUT_ENDPOINT = "/api/checkout";

type ApiSupplier = { id: string; name: string };

type ApiSupplierCode = {

  id: string;

  code: string;

  supplier?: ApiSupplier | null;

  supplierId?: string;

};

type ApiProduct = {

  id: string;

  name: string;

  size: string;

  category: string;

  barcode: string;

  sellingPrice: string | number;

  openingStock?: number | null;
  availableStock?: number;
  stockQuantity?: number;

  sold?: boolean;

  onTrial?: boolean;

  supplierCodeId?: string | null;

  supplierCode?: ApiSupplierCode | string | null;

  supplierName?: string | null;

  createdAt?: string;

};

type Product = {

  id: string;

  name: string;

  size: string;

  category: string;

  barcode: string;

  pricePaise: number;

  openingStock: number | null;
  availableStock: number;

  supplierCodeId: string | null;

  supplierCode: string;

  supplierName: string;

};

type CartLine = {

  product: Product;

  quantity: number;

  discountPaise: number;

  discountMode?: DiscountMode | null;

  discountValue?: number | null;

  selected: boolean;

};

type Customer = {

  name: string;

  phone: string;

  email: string;

  address: string;

};

type CheckoutResult = {

  id: string | number;

  invoiceNumber: string;

  invoiceDate: string;

  subtotalPaise: number;

  productDiscountPaise: number;

  billDiscountPaise: number;



  returnedDiscountPaise: number;



  totalDiscountPaise: number;

  totalPaise: number;

  paidPaise: number;

  changePaise: number;

};

type CheckoutResponse = {

  success: boolean;

  error?: string;

  message?: string;

  purchase?: CheckoutResult;

  bill?: CheckoutResult;

  transaction?: CheckoutResult;

};

const paymentMethods: TenderMethod[] = [

  "Cash", "Card", "UPI", "Bank Transfer", "Other",

];

const emptyCustomer: Customer = { name: "", phone: "", email: "", address: "" };

// Persistent draft belongs to this browser. Checkout clears it only after a

// confirmed server response. For multi-device persistence, use a server draft API.

const DRAFT_KEY = "neelam-pos-draft-v2";

function createCheckoutRequestId(): string {

  return crypto.randomUUID();

}

type StoredDraft = {

  requestId: string;

  cart: CartLine[];

  customer: Customer;

  billMode: DiscountMode;

  billValue: string;



  returnedDiscountValue: string;



  selectedMethods: TenderMethod[];

  tenderAmounts: Record<string, string>;

  autoCash: boolean;

  trialMode?: boolean;

};

function readDraft(): StoredDraft | null {

  try {

    const raw = localStorage.getItem(DRAFT_KEY);

    if (!raw) return null;

    const value: unknown = JSON.parse(raw);

    if (!value || typeof value !== "object") return null;

    const draft = value as Partial<StoredDraft>;

    if (!Array.isArray(draft.cart)) return null;

    const cart = draft.cart.filter((line): line is CartLine =>

      !!line && typeof line === "object" && !!line.product &&

      typeof line.product.id === "string" &&

      Number.isSafeInteger(line.quantity) && line.quantity > 0 &&

      Number.isSafeInteger(line.product.pricePaise) && line.product.pricePaise >= 0 &&

      Number.isSafeInteger(line.discountPaise) && line.discountPaise >= 0

    ).map(line => ({

      ...line,

      selected: false,

      discountMode: line.discountMode === "percent" ? "percent" : "fixed",

      discountPaise: line.discountMode === "percent"

        ? discountAmount(line.product.pricePaise * line.quantity, "percent", line.discountValue ?? 0)

        : Math.min(line.discountPaise, line.product.pricePaise * line.quantity),

      discountValue: line.discountMode === "percent"

        ? (line.discountValue ?? 0)

        : Math.min(line.discountPaise, line.product.pricePaise * line.quantity) / 100,

    }));

    return {

      requestId: typeof draft.requestId === "string" && draft.requestId.length > 7

        ? draft.requestId : createCheckoutRequestId(),

      cart,

      customer: draft.customer && typeof draft.customer === "object" ? draft.customer : emptyCustomer,

      billMode: draft.billMode === "fixed" ? "fixed" : "percent",

      billValue: typeof draft.billValue === "string" ? draft.billValue : "",

      returnedDiscountValue: typeof draft.returnedDiscountValue === "string" ? draft.returnedDiscountValue : "",

      selectedMethods: Array.isArray(draft.selectedMethods) && draft.selectedMethods.length

        ? draft.selectedMethods.filter((m): m is TenderMethod => paymentMethods.includes(m))

        : ["Cash"],

      tenderAmounts: draft.tenderAmounts && typeof draft.tenderAmounts === "object" ? draft.tenderAmounts : { Cash: "0" },

      autoCash: typeof draft.autoCash === "boolean" ? draft.autoCash : true,

      trialMode: draft.trialMode === true,

    };

  } catch {

    return null;

  }

}

function Field({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) {

  return <label className="field"><span>{label}</span><Input {...props} /></label>;

}

function normalizeProduct(row: ApiProduct): Product {

  const relation = row.supplierCode;

  const structuredCode = relation && typeof relation === "object" ? relation : null;

  const supplierName = structuredCode?.supplier?.name ?? row.supplierName ?? "";

  const supplierCode = structuredCode?.code ?? (typeof relation === "string" ? relation : "");

  const price = Number(row.sellingPrice);

  if (!Number.isFinite(price) || price < 0) throw new Error(`Invalid price for ${row.name}`);

  return {

    id: row.id,

    name: row.name,

    size: row.size,

    category: row.category,

    barcode: String(row.barcode ?? "").trim(),

    pricePaise: Math.round(price * 100),

    openingStock: row.openingStock ?? null,
    availableStock: row.availableStock ?? Math.max(0, row.stockQuantity ?? 0),

    supplierCodeId: row.supplierCodeId ?? structuredCode?.id ?? null,

    supplierCode,

    supplierName,

  };

}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {

  let response: Response;

  try {

    response = await fetch(`${API_BASE_URL}${path}`, {

      ...options,

      method: options.method || "GET",

      credentials: "omit", // Compatible with Access-Control-Allow-Origin: *

      cache: "no-store",

      headers: {

        ...(options.body ? { "Content-Type": "application/json" } : {}),

        ...options.headers,

      },

    });

  } catch {

    throw new Error("Cannot connect to backend. Check VITE_API_BASE_URL and backend server.");

  }

  let json: any;

  try {

    json = await response.json();

  } catch {

    throw new Error(`API returned an invalid response (HTTP ${response.status}).`);

  }

  if (!response.ok || json?.success === false) {

    throw new Error(json?.error || json?.message || `HTTP ${response.status}`);

  }

  return json as T;

}

export default function Home() {

  const [, setLocation] = useLocation();

  const scanRef = useRef<HTMLInputElement>(null);

  const scanHandlerRef = useRef<(barcode: string) => void>(() => undefined);

  const keyboardBuffer = useRef({ value: "", previous: 0, first: 0 });

  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [scan, setScan] = useState("");

  const [search, setSearch] = useState("");

  const draftOnLoad = useRef<StoredDraft | null>(readDraft());

  const [cart, setCart] = useState<CartLine[]>(() => draftOnLoad.current?.cart ?? []);

  // Persisted idempotency key prevents retrying checkout from double-billing.

  const [checkoutRequestId, setCheckoutRequestId] = useState<string>(

    () => draftOnLoad.current?.requestId ?? createCheckoutRequestId()

  );

  const [customer, setCustomer] = useState<Customer>(() => draftOnLoad.current?.customer ?? emptyCustomer);

  const [discountMode, setDiscountMode] = useState<DiscountMode>("percent");

  const [selectedDiscount, setSelectedDiscount] = useState("");

  const [billMode, setBillMode] = useState<DiscountMode>(() => draftOnLoad.current?.billMode ?? "percent");

  const [billValue, setBillValue] = useState(() => draftOnLoad.current?.billValue ?? "");



  const [returnedDiscountValue, setReturnedDiscountValue] = useState(() => draftOnLoad.current?.returnedDiscountValue ?? "");

  const [selectedMethods, setSelectedMethods] = useState<TenderMethod[]>(() => draftOnLoad.current?.selectedMethods ?? ["Cash"]);

  const [tenderAmounts, setTenderAmounts] = useState<Record<string, string>>(() => draftOnLoad.current?.tenderAmounts ?? { Cash: "0" });

  const [autoCash, setAutoCash] = useState(() => draftOnLoad.current?.autoCash ?? true);

  const [trialMode, setTrialMode] = useState(() => draftOnLoad.current?.trialMode ?? false);

  const [trialSuccess, setTrialSuccess] = useState<{ trialNumber: string; paidPaise: number; balancePaise: number } | null>(null);

  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);

  const [editingDiscountMode, setEditingDiscountMode] = useState<DiscountMode>("fixed");

  const [editingDiscountValue, setEditingDiscountValue] = useState("");

  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);

  const [checkoutPending, setCheckoutPending] = useState(false);
  const [receiptPrinting, setReceiptPrinting] = useState(false);

  const [successInfo, setSuccessInfo] = useState<{

    id: string | number;

    invoiceNumber: string;

    invoiceDate: string;

    subtotalPaise: number;

    productDiscountPaise: number;

    billDiscountPaise: number;

    returnedDiscountPaise: number;

    totalDiscountPaise: number;

    totalPaise: number;

    paidPaise: number;

    changePaise: number;

    customerName: string;

    tenders: { method: TenderMethod; amountPaise: number }[];

  } | null>(null);

  const refreshProducts = useCallback(async (showToast = false) => {

    setRefreshing(true);

    setCatalogError(null);

    try {

      const response = await requestJson<{

        success: boolean;

        products: ApiProduct[];

      }>("/api/products/all?sold=all&onTrial=all");

      if (!Array.isArray(response.products)) throw new Error("Expected a products array from API.");

      const unique = new Map<string, Product>();

      for (const row of response.products) {

        if ((row.availableStock ?? ((row.stockQuantity ?? 0))) <= 0) continue;

        const product = normalizeProduct(row);

        unique.set(product.id, product);

      }

      const fetched = [...unique.values()];

      setAllProducts(fetched);

      // Refresh any products already in the basket without changing quantities/discounts.

      const byId = new Map(fetched.map(p => [p.id, p]));

      setCart(current => current.map(line => ({

        ...line,

        product: byId.get(line.product.id) ?? line.product,

      })));

      if (showToast) toast.success(`${fetched.length} products loaded from database`);

    } catch (error) {

      const message = error instanceof Error ? error.message : "Unable to load products";

      setCatalogError(message);

      toast.error(message);

    } finally {

      setLoading(false);

      setRefreshing(false);

    }

  }, []);

  useEffect(() => { void refreshProducts(); }, [refreshProducts]);

  useEffect(() => { scanRef.current?.focus(); }, []);

  const barcodeIndex = useMemo(() => {

    const map = new Map<string, Product>();

    for (const product of allProducts) {

      if (product.barcode) map.set(product.barcode.toLowerCase(), product);

    }

    return map;

  }, [allProducts]);

  const supplierCount = useMemo(

    () => new Set(allProducts.map(p => p.supplierName).filter(Boolean)).size,

    [allProducts]

  );

  const trackedStock = useMemo(

    () => allProducts.reduce((sum, p) => sum + p.availableStock, 0),

    [allProducts]

  );

  const grossPaise = useMemo(

    () => cart.reduce((sum, line) => sum + line.product.pricePaise * line.quantity, 0),

    [cart]

  );

  const productDiscountPaise = useMemo(

    () => cart.reduce((sum, line) => sum + Math.min(line.discountPaise, line.product.pricePaise * line.quantity), 0),

    [cart]

  );

  const afterProductDiscount = grossPaise - productDiscountPaise;

  const billDiscountPaise = discountAmount(

    afterProductDiscount,

    billMode,

    billMode === "fixed" ? toPaise(billValue) : Number(billValue || 0)

  );

  // Returned Discount represents credit for merchandise returned against this new purchase.

  // It is separate from normal product/bill discounts and is not cash tendered.

  const afterBillDiscount = Math.max(0, afterProductDiscount - billDiscountPaise);

  const rawReturnedDiscountPaise = /^\d+(\.\d{1,2})?$/.test(returnedDiscountValue.trim() || "0")

    ? toPaise(returnedDiscountValue || "0") : 0;

  const returnedDiscountPaise = Math.min(afterBillDiscount, Math.max(0, rawReturnedDiscountPaise));

  const totalDiscountPaise = productDiscountPaise + billDiscountPaise + returnedDiscountPaise;

  const totalPaise = trialMode ? afterBillDiscount : afterBillDiscount - returnedDiscountPaise;

  const paidPaise = selectedMethods.reduce(

    (sum, method) => sum + toPaise(tenderAmounts[method] || "0"), 0

  );

  const remainingPaise = Math.max(0, totalPaise - paidPaise);

  const changePaise = Math.max(0, paidPaise - totalPaise);

  const matchingProducts = useMemo(() => {

    const term = search.trim().toLowerCase();

    if (!term) return [];

    return allProducts.filter(product => [

      product.name, product.barcode, product.supplierCode,

      product.supplierName, product.category,

    ].some(value => value.toLowerCase().includes(term))).slice(0, 12);

  }, [allProducts, search]);

  const summaryCards = [

    { label: "Available Products", value: String(allProducts.length), note: "Loaded from product API", Icon: Package },

    { label: "Suppliers in Catalog", value: String(supplierCount), note: "Linked supplier names", Icon: Building2 },

    { label: "Current Bill", value: formatINR(totalPaise), note: `${cart.length} cart lines`, Icon: Wallet },

  ];

  useEffect(() => {

    if (!trialMode && autoCash && selectedMethods.length === 1 && selectedMethods[0] === "Cash") {

      setTenderAmounts(previous => ({ ...previous, Cash: (totalPaise / 100).toFixed(2) }));

    }

  }, [autoCash, selectedMethods, totalPaise, trialMode]);

  // Persist the complete working draft after every change, including discounts.

  // A page navigation unmounts this component; localStorage restores it on return.

  useEffect(() => {

    try {

      const draft: StoredDraft = {

        requestId: checkoutRequestId, cart, customer, billMode, billValue, returnedDiscountValue,

        selectedMethods, tenderAmounts, autoCash, trialMode,

      };

      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    } catch (error) {

      console.warn("Could not save POS draft", error);

    }

  }, [checkoutRequestId, cart, customer, billMode, billValue, returnedDiscountValue, selectedMethods, tenderAmounts, autoCash, trialMode]);

  const addProduct = useCallback((product: Product) => {

    setCart(current => {

      const existing = current.find(line => line.product.id === product.id);

      if (existing) {

        const newQuantity = existing.quantity + 1;
        if (newQuantity > product.availableStock) {
          toast.error(`Only ${product.availableStock} units available for ${product.name}`);
          return current;
        }

        const gross = product.pricePaise * newQuantity;

        const amount = existing.discountMode === "percent"

          ? discountAmount(gross, "percent", existing.discountValue ?? 0)

          : Math.min(gross, existing.discountPaise);

        return current.map(line => line.product.id === product.id

          ? { ...line, quantity: newQuantity, discountPaise: amount,

              discountValue: line.discountMode === "percent" ? (line.discountValue ?? 0) : amount / 100 }

          : line);

      }

      if (product.availableStock < 1) {
        toast.error(`${product.name} is out of stock`);
        return current;
      }
      return [...current, { product, quantity: 1, discountPaise: 0,

        discountMode: "fixed", discountValue: 0, selected: false }];

    });

    toast.success(`${product.name} added to cart`, { duration: 1200 });

    setSearch("");

    setScan("");

    requestAnimationFrame(() => scanRef.current?.focus());

  }, []);



  const handleBarcode = useCallback((raw: string) => {

    const code = raw.trim();

    if (!code) return;

    const product = barcodeIndex.get(code.toLowerCase());

    if (!product) {

      toast.error("Barcode not found", { description: `No available product matches ${code}` });

      setScan("");

      return;

    }

    addProduct(product);

  }, [barcodeIndex, addProduct]);

  // Keep native scanner event listeners current without reinstalling them.

  scanHandlerRef.current = handleBarcode;

  useEffect(() => {

    // USB/Bluetooth HID "keyboard wedge" scanners type characters followed by Enter.

    // When the scan field is focused its normal onKeyDown handles the scan.

    // This fallback also captures fast scans while focus is elsewhere (not in a form field).

    const listener = (event: KeyboardEvent) => {

      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;

      const target = event.target as HTMLElement | null;

      if (target?.closest("input,textarea,select,[contenteditable='true']")) return;

      if (document.querySelector("[role='dialog']")) return;

      const now = performance.now();

      const buffer = keyboardBuffer.current;

      if (now - buffer.previous > 90) {

        buffer.value = "";

        buffer.first = now;

      }

      if (event.key === "Enter") {

        // >= 6 characters received quickly protects ordinary keyboard shortcuts.

        if (buffer.value.length >= 6 && now - buffer.first <= buffer.value.length * 90 + 100) {

          event.preventDefault();

          scanHandlerRef.current(buffer.value);

        }

        buffer.value = "";

        buffer.previous = 0;

        return;

      }

      if (event.key.length === 1 && buffer.value.length < 64) {

        buffer.value += event.key;

        buffer.previous = now;

      }

    };

    window.addEventListener("keydown", listener, true);

    return () => window.removeEventListener("keydown", listener, true);

  }, []);

  function setQuantity(id: string, quantity: number) {

    if (quantity < 1) {

      setCart(current => current.filter(line => line.product.id !== id));

      return;

    }

    if (!Number.isSafeInteger(quantity) || quantity > 100000) {

      toast.error("Quantity must be between 1 and 100000");

      return;

    }

    const currentLine = cart.find(line => line.product.id === id);
    if (currentLine && quantity > currentLine.product.availableStock) {
      toast.error(`Only ${currentLine.product.availableStock} units are available`);
      return;
    }
    setCart(current => current.map(line => {

      if (line.product.id !== id) return line;

      const gross = line.product.pricePaise * quantity;

      const discountPaise = line.discountMode === "percent"

        ? discountAmount(gross, "percent", line.discountValue ?? 0)

        : Math.min(gross, line.discountPaise);

      return { ...line, quantity, discountPaise,

        discountMode: line.discountMode ?? "fixed",

        discountValue: line.discountMode === "percent" ? (line.discountValue ?? 0) : discountPaise / 100 };

    }));

  }



  function parseDiscountInput(value: string, mode: DiscountMode): number | null {

    const text = value.trim();

    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;

    const number = Number(text);

    if (!Number.isFinite(number) || number < 0) return null;

    if (mode === "percent" && number > 100) return null;

    return mode === "percent" ? number : toPaise(text);

  }

  function applySelectedDiscount() {

    const selected = cart.filter(line => line.selected);

    if (!selected.length) return void toast.error("Select one or more products first");

    const amount = parseDiscountInput(selectedDiscount, discountMode);

    if (amount === null) return void toast.error("Enter a valid discount (0–100% or a rupee amount)");

    const bases = selected.map(line => line.product.pricePaise * line.quantity);

    const totalBase = bases.reduce((a, b) => a + b, 0);

    if (discountMode === "fixed" && amount > totalBase) {

      return void toast.error("Discount cannot exceed the selected products' original total");

    }

    const shares = discountMode === "percent"

      ? bases.map(base => discountAmount(base, "percent", amount))

      : spreadDiscount(amount, bases);

    const byId = new Map(selected.map((line, index) => [line.product.id, shares[index]]));

    // Replace discounts only on selected items; previous discounts on other

    // products are retained. Re-select a product to edit it later.

    setCart(current => current.map(line => byId.has(line.product.id)

      ? { ...line, discountPaise: byId.get(line.product.id) ?? 0,

          discountMode, discountValue: discountMode === "fixed"

            ? (byId.get(line.product.id) ?? 0) / 100 : amount,

          selected: false }

      : line));

    setSelectedDiscount("");

    toast.success(`Discount applied to ${selected.length} product(s)`);

  }

  function editProductDiscount(line: CartLine) {

    setEditingDiscountId(line.product.id);

    setEditingDiscountMode(line.discountMode ?? "fixed");

    setEditingDiscountValue(String(line.discountValue ?? (line.discountPaise / 100).toFixed(2)));

  }

  function saveEditedDiscount() {

    const line = cart.find(item => item.product.id === editingDiscountId);

    if (!line) return;

    const value = parseDiscountInput(editingDiscountValue, editingDiscountMode);

    if (value === null) return void toast.error("Enter a valid discount (0–100% or a rupee amount)");

    const original = line.product.pricePaise * line.quantity;

    const discount = editingDiscountMode === "percent"

      ? discountAmount(original, "percent", value)

      : value;

    if (discount > original) return void toast.error("Discount cannot exceed the product total");

    setCart(current => current.map(item => item.product.id === line.product.id

      ? { ...item, discountPaise: discount, discountMode: editingDiscountMode,

          discountValue: editingDiscountMode === "fixed" ? value / 100 : value }

      : item));

    setEditingDiscountId(null);

    toast.success("Product discount updated");

  }

  function toggleMethod(method: TenderMethod) {

    setSelectedMethods(current => {

      const exists = current.includes(method);

      if (exists && current.length === 1) {

        toast.error("Select at least one payment method");

        return current;

      }

      const next = exists ? current.filter(item => item !== method) : [...current, method];

      if (!exists) {

        const otherPaid = next.filter(item => item !== method)

          .reduce((sum, item) => sum + toPaise(tenderAmounts[item] || "0"), 0);

        setTenderAmounts(amounts => ({

          ...amounts,

          [method]: (Math.max(0, totalPaise - otherPaid) / 100).toFixed(2),

        }));

      }

      if (method === "Cash" || next.length > 1) setAutoCash(false);

      return next;

    });

  }

  function finishPayment() {

    if (!cart.length) return toast.error("Your cart is empty");

    if (billValue.trim() && (!/^\d+(\.\d{1,2})?$/.test(billValue.trim()) || (billMode === "percent" && Number(billValue) > 100))) {

      return toast.error("Enter a valid bill discount");

    }

    if (returnedDiscountValue.trim() && !/^\d+(\.\d{1,2})?$/.test(returnedDiscountValue.trim())) {

      return toast.error("Enter a valid returned discount amount in rupees");

    }

    if (rawReturnedDiscountPaise > afterBillDiscount) {

      return toast.error("Returned discount cannot exceed the amount after product and bill discounts");

    }

    if (billDiscountPaise > afterProductDiscount) {

      return toast.error("Bill discount cannot exceed the amount after product discounts");

    }



    if (customer.phone.trim() && !/^(?:\+91[\s-]?)?[6-9]\d{9}$/.test(customer.phone.trim())) {

      return toast.error("Enter a valid Indian phone number");

    }

    if (trialMode && (!customer.name.trim() || !customer.phone.trim())) {

      return toast.error("Customer name and phone are required for trial billing");

    }

    if (cart.some(line => line.quantity > line.product.availableStock)) {
      return toast.error("Cart exceeds current stock. Refresh products and retry.");
    }
    if (trialMode && cart.some(line => line.quantity !== 1)) {

      return toast.error("Trial mode currently requires one unit per product barcode");

    }

    if (trialMode && returnedDiscountPaise > 0) {

      return toast.error("Returned merchandise credit cannot be used on an open trial");

    }

    if (trialMode && paidPaise > totalPaise) {

      return toast.error("Trial advance cannot exceed the trial amount");

    }

    if (!trialMode && paidPaise < totalPaise) {

      return toast.error("Complete the payment amounts", {

        description: `Remaining: ${formatINR(remainingPaise)}`,

      });

    }

    setPaymentConfirmOpen(true);

  }

  async function completePayment() {

    if (checkoutPending) return;

    setCheckoutPending(true);

    try {

      // Requires a real backend checkout route. No local/mock checkout is used.

      // Adjust its request/response contract to your backend once implemented.

      const tenders = selectedMethods

        .map(method => ({ method, amountPaise: toPaise(tenderAmounts[method] || "0") }))

        .filter(entry => entry.amountPaise > 0);

      if (trialMode) {

        const result = await requestJson<{

          success: boolean;

          trial: { trialNumber: string; paidPaise: number; balancePaise: number };

        }>("/api/trials", {

          method: "POST",

          body: JSON.stringify({

            requestId: checkoutRequestId, customer,

            items: cart.map(line => ({

              productId: line.product.id,

              quantity: line.quantity,

              productDiscountPaise: line.discountPaise,

              discountMode: line.discountMode ?? "fixed",

              discountValue: line.discountMode === "percent" ? (line.discountValue ?? 0) : line.discountPaise / 100,

            })),

            billDiscountMode: billMode,

            billDiscountValue: Number(billValue || 0), // trial fixed discounts use rupees

            tenders,

          }),

        });

        setTrialSuccess(result.trial);

        setPaymentConfirmOpen(false);

        localStorage.removeItem(DRAFT_KEY);

        setCheckoutRequestId(createCheckoutRequestId());

        setCart([]); setCustomer(emptyCustomer);

        setBillMode("percent"); setBillValue(""); setReturnedDiscountValue("");

        setSelectedMethods(["Cash"]); setTenderAmounts({ Cash: "0" });

        setAutoCash(false); setTrialMode(false);

        toast.success(`Trial ${result.trial.trialNumber} saved`);

        await refreshProducts();

        return;

      }

      const response = await requestJson<CheckoutResponse>(CHECKOUT_ENDPOINT, {

        method: "POST",

        body: JSON.stringify({

          requestId: checkoutRequestId,

          customer,

          items: cart.map(line => ({

            productId: line.product.id,

            quantity: line.quantity,

            productDiscountPaise: line.discountPaise,

            discountMode: line.discountMode ?? "fixed",

            discountValue: line.discountMode === "percent"

              ? (line.discountValue ?? 0)

              : line.discountPaise / 100,

          })),

          billDiscountMode: billMode,

          billDiscountValue: billMode === "fixed" ? toPaise(billValue) : Number(billValue || 0),



          returnedDiscountPaise,



          tenders,

        }),

      });

      const saved = response.purchase ?? response.bill ?? response.transaction;

      if (!saved?.invoiceNumber || saved.id === undefined) {

        throw new Error("Checkout API did not return a saved bill ID and invoice number. Please verify the server contract.");

      }

      setPaymentConfirmOpen(false);

      setSuccessInfo({

        id: saved.id,

        invoiceNumber: saved.invoiceNumber,

        invoiceDate: saved.invoiceDate,

        subtotalPaise: saved.subtotalPaise,

        productDiscountPaise: saved.productDiscountPaise,

        billDiscountPaise: saved.billDiscountPaise,

        returnedDiscountPaise: saved.returnedDiscountPaise,

        totalDiscountPaise: saved.totalDiscountPaise,

        totalPaise: saved.totalPaise,

        paidPaise: saved.paidPaise,

        changePaise: saved.changePaise,

        customerName: customer.name || "Walk-in customer",

        tenders,

      });

      // Only clear the locally saved draft after the checkout server confirms success.

      localStorage.removeItem(DRAFT_KEY);

      setCheckoutRequestId(createCheckoutRequestId());

      setCart([]);

      setCustomer(emptyCustomer);

      setBillMode("percent");

      setSelectedMethods(["Cash"]);

      setTenderAmounts({ Cash: "0" });

      setAutoCash(true);

      setSelectedDiscount("");

      setBillValue("");

      setReturnedDiscountValue("");

      toast.success("Bill saved successfully");

      await refreshProducts();

    } catch (error) {

      toast.error(error instanceof Error ? error.message : "Checkout failed");

    } finally {

      setCheckoutPending(false);

    }

  }

  async function printSavedReceipt(invoiceId: string | number) {
    if (receiptPrinting) return;
    // Open before fetching: browsers otherwise often block the print viewer.
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Allow pop-ups to open the receipt print view");
      return;
    }
    printWindow.document.title = "Preparing A5 receipt...";
    printWindow.document.body.textContent = "Preparing receipt print view...";
    setReceiptPrinting(true);
    try {
      // The saved invoice is the source of truth for products and payment amounts.
      const response = await requestJson<{ success: boolean; invoice: ReceiptInvoice }>(
        `/api/checkout?invoiceId=${encodeURIComponent(String(invoiceId))}`
      );
      if (!response.invoice?.invoiceNumber || !Array.isArray(response.invoice.items)) {
        throw new Error("Saved receipt details were not returned by the backend");
      }
      const doc = await buildReceiptPdf(response.invoice, false);
      doc.autoPrint();
      const url = URL.createObjectURL(doc.output("blob"));
      printWindow.location.replace(url);
      toast.success("A5 receipt opened in print view");
      // Keep the object URL valid while the browser PDF viewer is open.
    } catch (error) {
      printWindow.close();
      toast.error(error instanceof Error ? error.message : "Could not open the receipt");
    } finally {
      setReceiptPrinting(false);
    }
  }

  return (

    <RetailLayout>

        <style>{`
          /* POS cart grid: consistent columns and no overlapping content */
          .cart-panel .cart-grid-refined {
            display: grid !important;
            grid-template-columns: minmax(180px, 2fr) minmax(100px, 1fr) minmax(96px, .65fr) minmax(150px, 1.15fr) 38px !important;
            column-gap: 14px !important;
            align-items: center !important;
            width: 100%;
            box-sizing: border-box;
          }
          .cart-panel .cart-table-head.cart-grid-refined { padding: 13px 20px; font-size: 11px; }
          .cart-panel .cart-row.cart-grid-refined { padding: 20px !important; min-height: 104px; }
          .cart-panel .cart-product-refined { display: flex; min-width: 0; gap: 12px; align-items: center; }
          .cart-panel .cart-product-refined .product-monogram { flex: 0 0 42px; width: 42px; height: 42px; }
          .cart-panel .cart-product-details { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; overflow-wrap: anywhere; }
          .cart-panel .cart-product-details strong { display: block; font-size: 15px; line-height: 1.4; white-space: normal; overflow-wrap: anywhere; }
          .cart-panel .cart-product-details small { display: block; font-size: 12.5px; line-height: 1.4; color: #64748b; white-space: normal; overflow-wrap: anywhere; }
          .cart-panel .cart-variant-refined { min-width: 0; display: flex; flex-direction: column; gap: 5px; font-size: 14px; overflow-wrap: anywhere; }
          .cart-panel .cart-variant-refined small { font-size: 12.5px; line-height: 1.4; overflow-wrap: anywhere; }
          .cart-panel .cart-quantity-refined { display: inline-flex; width: fit-content; align-items: center; justify-self: start; white-space: nowrap; }
          .cart-panel .cart-amount-refined { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 5px; overflow-wrap: anywhere; }
          .cart-panel .cart-amount-refined strong { font-size: 15px; line-height: 1.4; white-space: nowrap; }
          .cart-panel .cart-amount-refined small { font-size: 12.5px; line-height: 1.35; white-space: normal; }
          .cart-panel .cart-amount-refined .text-action { display: inline-flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 13px; white-space: nowrap; }
          .cart-panel .cart-remove-refined { justify-self: end; flex-shrink: 0; }
          .cart-panel .panel-title h2 { font-size: 16px; }
          .cart-panel .panel-title p, .cart-panel .cart-footer { font-size: 13px; }
          /* Medium widths: labels remain aligned by wrapping the cart region only */
          @media (max-width: 1050px) {
            .cart-panel .cart-grid-refined { grid-template-columns: minmax(155px, 1.8fr) minmax(82px, .8fr) 90px minmax(132px, 1fr) 30px !important; column-gap: 10px !important; }
            .cart-panel .cart-row.cart-grid-refined { padding: 16px !important; }
            .cart-panel .cart-table-head.cart-grid-refined { padding: 12px 16px; }
          }
          @media (max-width: 700px) {
            .cart-panel .cart-table-head.cart-grid-refined { display: none !important; }
            .cart-panel .cart-row.cart-grid-refined { grid-template-columns: minmax(0,1fr) auto !important; gap: 14px 12px !important; align-items: start !important; padding: 16px !important; }
            .cart-panel .cart-product-refined { grid-column: 1; grid-row: 1; }
            .cart-panel .cart-remove-refined { grid-column: 2; grid-row: 1; }
            .cart-panel .cart-variant-refined { grid-column: 1; grid-row: 2; }
            .cart-panel .cart-quantity-refined { grid-column: 2; grid-row: 2; justify-self: end; }
            .cart-panel .cart-amount-refined { grid-column: 1 / -1; grid-row: 3; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          }
        `}</style>
      <div className="page-heading pos-heading">

        <div>

          <div className="eyebrow">POINT OF SALE</div>

          <h1>Point of sale</h1>

          <p>Search the available product catalogue to build a normal or trial bill.</p>

        </div>

        <div className="heading-status">

          {refreshing ? <Loader2 size={15} className="animate-spin" /> : <span className="status-dot" />}

          {refreshing ? "Loading products" : "Barcode scanner ready"}

          <button type="button" className="icon-button" onClick={() => void refreshProducts(true)} title="Refresh products" disabled={refreshing}>

            <RefreshCw size={15} />

          </button>

        </div>

      </div>

      {catalogError && (

        <div role="alert" style={{ background: "#fff1f2", color: "#9f1239", border: "1px solid #fecdd3", borderRadius: 10, padding: 12, marginBottom: 15, display: "flex", gap: 8, alignItems: "center" }}>

          <AlertCircle size={17} />

          <span>Could not load the product API: {catalogError}</span>

          <button className="btn-outline" type="button" onClick={() => void refreshProducts(true)}>Retry</button>

        </div>

      )}

      <section className="panel" style={{ padding: 14, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>

        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>

          <input type="checkbox" checked={trialMode} onChange={event => {

            const enabled = event.target.checked;

            setTrialMode(enabled);

            if (enabled) {

              setAutoCash(false);

              setTenderAmounts({ Cash: "0" });

              setReturnedDiscountValue("");

            }

          }}/>

          Trial bill (allow zero / partial advance)

        </label>

        <button className="btn-outline" type="button" onClick={() => setLocation("/trials")}>View / settle trials</button>

      </section>

      <section className="pos-summary-grid" aria-label="Live catalogue summary">

        {summaryCards.map(({ label, value, note, Icon }) => (

          <article className="pos-summary-card" key={label}>

            <div className="pos-summary-icon"><Icon size={22} strokeWidth={2} /></div>

            <div className="pos-summary-copy">

              <span>{label}</span>

              <strong>{loading ? "…" : value}</strong>

              <small>{note}</small>

            </div>

          </article>

        ))}

      </section>

      <div className="pos-tools">

        <div className="product-search-wrap">

          <Search size={18} />

          <Input

            value={search}

            onChange={event => setSearch(event.target.value)}

            placeholder="Search name, barcode, supplier code or supplier name…"

            aria-label="Search products"

          />

          {search && <button type="button" className="search-clear" onClick={() => setSearch("")} aria-label="Clear search"><X size={16} /></button>}

          {search.trim() && (

            <div className="search-results" style={{ maxHeight: 360, overflowY: "auto" }}>

              {matchingProducts.length ? matchingProducts.map(product => (

                <button type="button" key={product.id} onClick={() => addProduct(product)}>

                  <span className="result-icon"><ShoppingBag size={16} /></span>

                  <span className="result-name">

                    <strong>{product.name}</strong>

                    <small>{product.barcode} · {product.availableStock} available · {product.supplierName || "No supplier"} / {product.supplierCode || "—"}</small>

                  </span>

                  <b>{formatINR(product.pricePaise)}</b><Plus size={16} />

                </button>

              )) : <div style={{ padding: 16, fontSize: 13 }}>No matching products found</div>}

            </div>

          )}

        </div>

      </div>

      <div className="pos-grid">

        <section className="cart-panel panel">

          <div className="panel-heading">

            <div className="panel-title">

              <div className="section-icon"><ShoppingBag size={18} /></div>

              <div><h2>Current bill</h2><p>{cart.length} {cart.length === 1 ? "product" : "products"} in cart</p></div>

            </div>

            <span className="invoice-draft">DRAFT BILL</span>

          </div>

          <div className="cart-table-head cart-grid-refined">
            <span>PRODUCT</span><span>SIZE / CODE</span><span>QUANTITY</span><span>AMOUNT</span><span />
          </div>
          <div className="cart-list cart-list-refined">
            {cart.length === 0 ? (
              <div className="empty-cart">
                <div className="empty-cart-mark"><ShoppingBag size={24} /></div>
                <strong>Your basket is ready</strong>
                <span>Use a hardware scanner or search by product name, barcode or supplier code.</span>
                <button type="button" className="text-action" onClick={() => setLocation("/products")}>
                  <PackagePlus size={15} /> Manage products
                </button>
              </div>
            ) : cart.map(line => (
              <article className="cart-row cart-grid-refined" key={line.product.id}>
                <div className="cart-product cart-product-refined">
                  <div className="product-monogram" aria-hidden="true">{line.product.name.slice(0, 1).toUpperCase()}</div>
                  <div className="cart-product-details">
                    <strong title={line.product.name}>{line.product.name}</strong>
                    <small title={[line.product.supplierName, line.product.supplierCode].filter(Boolean).join(" · ")}>
                      {[line.product.supplierName, line.product.supplierCode].filter(Boolean).join(" · ") || "No supplier"}
                    </small>
                  </div>
                </div>
                <div className="cart-variant cart-variant-refined">
                  <span>{line.product.availableStock} in stock</span>
                  <small>{line.product.barcode}</small>
                </div>
                <div className="quantity-stepper cart-quantity-refined">
                  <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(line.product.id, line.quantity - 1)}><Minus size={15} /></button>
                  <span>{line.quantity}</span>
                  <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(line.product.id, line.quantity + 1)}><Plus size={15} /></button>
                </div>
                <div className="cart-amount cart-amount-refined">
                  <strong>{formatINR(line.product.pricePaise * line.quantity - line.discountPaise)}</strong>
                  <small>Original: {formatINR(line.product.pricePaise * line.quantity)}</small>
                  {line.discountPaise > 0 && <small className="discount-value">− {formatINR(line.discountPaise)} product discount</small>}
                  <button type="button" className="text-action" onClick={() => editProductDiscount(line)}>
                    <Edit3 size={15} /> {line.discountPaise ? "Edit discount" : "Add discount"}
                  </button>
                </div>
                <button type="button" className="icon-button remove-item cart-remove-refined" aria-label={`Remove ${line.product.name}`} onClick={() => setCart(current => current.filter(item => item.product.id !== line.product.id))}><Trash2 size={17} /></button>
              </article>
            ))}
          </div>
          <div className="cart-footer"><span><span className="live-dot" /> Live product catalogue</span><button type="button" className="text-action" onClick={() => setCart([])} disabled={!cart.length}>Clear bill</button></div>

        </section>

        <aside className="checkout-column">

          <section className="panel customer-panel">

            <div className="panel-heading compact-heading">

              <div className="panel-title"><div className="section-icon pale-icon"><UserRound size={17} /></div><div><h2>Customer</h2><p>Optional for walk-in sales</p></div></div>

              <button type="button" className="icon-button" aria-label="Clear customer" onClick={() => setCustomer(emptyCustomer)}><X size={16} /></button>

            </div>

            <div className="customer-fields">

              <Field label="NAME" value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} placeholder="Customer name" />

              <Field label="PHONE" value={customer.phone} onChange={event => setCustomer({ ...customer, phone: event.target.value })} placeholder="+91 98765 43210" inputMode="tel" />

              <Field label="EMAIL" value={customer.email} onChange={event => setCustomer({ ...customer, email: event.target.value })} placeholder="Optional" type="email" />

              <Field label="ADDRESS" value={customer.address} onChange={event => setCustomer({ ...customer, address: event.target.value })} placeholder="Optional" />

            </div>

          </section>

          <section className="panel bill-panel">

            <div className="panel-heading compact-heading">

              <div className="panel-title"><div className="section-icon pale-icon"><Wallet size={17} /></div><div><h2>Bill summary</h2><p>Discount and final amount</p></div></div>

              <ChevronDown size={17} className="muted-icon" />

            </div>

            <div className="bill-summary-lines">

              <div><span>Original total</span><strong>{formatINR(grossPaise)}</strong></div>

              <div><span>Product discounts</span><strong className="discount-value">− {formatINR(productDiscountPaise)}</strong></div>

              <div className="bill-discount-row"><span>Bill discount</span><div className="bill-discount-control">

                <select value={billMode} onChange={event => setBillMode(event.target.value as DiscountMode)} aria-label="Bill discount type"><option value="percent">%</option><option value="fixed">₹</option></select>

                <input aria-label="Bill discount" type="number" min="0" step="0.01" value={billValue} onChange={event => setBillValue(event.target.value)} placeholder="0" />

              </div><strong className="discount-value">− {formatINR(billDiscountPaise)}</strong></div>

              {!trialMode && <div className="bill-discount-row"><span>Returned discount (₹)</span><div className="bill-discount-control">

                <input aria-label="Returned discount in rupees" type="number" min="0" step="0.01"

                  value={returnedDiscountValue} onChange={event => setReturnedDiscountValue(event.target.value)}

                  placeholder="0.00" />

              </div><strong className="discount-value">− {formatINR(returnedDiscountPaise)}</strong></div>}

            </div>

            <div className="bill-summary-lines">

                <div><span>Total discounts + return credit</span><strong className="discount-value">− {formatINR(totalDiscountPaise)}</strong></div>

              </div>

              <div className="bill-total"><span>Final payable</span><strong>{formatINR(totalPaise)}</strong></div>

            {trialMode && <div className="panel" style={{ padding: 12, marginTop: 10, display: "grid", gap: 6 }}>

              <div style={{ display: "flex", justifyContent: "space-between" }}>Trial total <strong>{formatINR(totalPaise)}</strong></div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>Advance received <strong>{formatINR(paidPaise)}</strong></div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>Outstanding balance <strong>{formatINR(remainingPaise)}</strong></div>

              <small>Leave amount zero if nothing is paid. Products are reserved, not sold.</small>

            </div>}

            <div className="payment-heading"><div><h3>Payment method</h3><span>Split across multiple methods</span></div><span className="secure-label"><CreditCard size={13} /> TENDER</span></div>

            <div className="payment-methods">

              {paymentMethods.map(method => {

                const checked = selectedMethods.includes(method);

                const symbol = method === "Cash" ? "₹" : method === "Card" ? "▰" : method === "UPI" ? "↗" : method === "Bank Transfer" ? "⇄" : "•••";

                return <button type="button" key={method} className={`method-chip ${checked ? "selected" : ""}`} onClick={() => toggleMethod(method)}><span className="method-check">{checked && <Check size={11} />}</span><span className="method-icon">{symbol}</span>{method}</button>;

              })}

            </div>

            {selectedMethods.length > 0 && (

              <div className="tender-list">{selectedMethods.map(method => (

                <label className="tender-row" key={method}><span>{method}</span><span className="tender-input"><span>₹</span>

                  <input type="number" min="0" step="0.01" value={tenderAmounts[method] ?? ""} onChange={event => { setAutoCash(false); setTenderAmounts(previous => ({ ...previous, [method]: event.target.value })); }} aria-label={`${method} payment amount`} />

                </span></label>

              ))}</div>

            )}

            <div className={`payment-balance ${remainingPaise > 0 ? "balance-due" : "balance-paid"}`}>

              <span>{remainingPaise > 0 ? "Payment remaining" : changePaise > 0 ? "Change due" : "Balance"}</span><strong>{formatINR(remainingPaise || changePaise)}</strong>

            </div>

            <div className="paid-line"><span>Total paid</span><strong>{formatINR(paidPaise)}</strong></div>

            <Button className="complete-payment" onClick={finishPayment} disabled={checkoutPending || !cart.length}>

              <span>{checkoutPending ? "Saving…" : trialMode ? "Save trial bill" : "Complete payment"}</span>

              <span className="complete-button-right">{checkoutPending ? <Loader2 size={15} className="animate-spin" /> : <><strong>{formatINR(totalPaise)}</strong><span className="payment-arrow">→</span></>}</span>

            </Button>

            <p className="payment-footnote"><CheckCircle2 size={13} /> Prices displayed from the live product API</p>

          </section>

        </aside>

      </div>

        {editingDiscountId && (

          <ActionDialog

            title="Edit product discount"

            description={cart.find(line => line.product.id === editingDiscountId)?.product.name ?? "Product"}

            onClose={() => setEditingDiscountId(null)}

          >

            <div className="modal-body">

              <label className="field"><span>DISCOUNT TYPE</span>

                <select value={editingDiscountMode} onChange={event => setEditingDiscountMode(event.target.value as DiscountMode)}>

                  <option value="fixed">Rupees (₹)</option>

                  <option value="percent">Percentage (%)</option>

                </select>

              </label>

              <label className="field"><span>DISCOUNT AMOUNT</span>

                <Input type="number" min="0" max={editingDiscountMode === "percent" ? "100" : undefined} step="0.01"

                  value={editingDiscountValue} onChange={event => setEditingDiscountValue(event.target.value)} />

              </label>

              <div className="modal-footer">

                <button type="button" className="btn-outline" onClick={() => setEditingDiscountId(null)}>Cancel</button>

                <button type="button" className="btn-primary" onClick={saveEditedDiscount}>Save discount</button>

              </div>

            </div>

          </ActionDialog>

        )}

      {paymentConfirmOpen && (

        <ActionDialog title={trialMode ? "Confirm trial bill" : "Confirm payment"} description={trialMode ? "Trial products will be reserved. Zero or partial advances are accepted." : "Review the bill before submitting it to the backend."} onClose={() => { if (!checkoutPending) setPaymentConfirmOpen(false); }}>

          <div className="modal-body">

            <div className="payment-confirm-items">{cart.map(line => (

              <div key={line.product.id}><span>{line.product.name} × {line.quantity}</span><strong>{formatINR(line.product.pricePaise * line.quantity - line.discountPaise)}</strong></div>

            ))}</div>

            <div className="payment-confirm-totals">

              <div><span>Original total</span><strong>{formatINR(grossPaise)}</strong></div>

              <div><span>Product discounts</span><strong>−{formatINR(productDiscountPaise)}</strong></div>

              <div><span>Bill discount</span><strong>−{formatINR(billDiscountPaise)}</strong></div>

                {!trialMode && <div><span>Returned discount (return credit)</span><strong>−{formatINR(returnedDiscountPaise)}</strong></div>}

                <div><span>{trialMode ? "Total discounts" : "Total discounts + return credit"}</span><strong>−{formatINR(trialMode ? productDiscountPaise + billDiscountPaise : totalDiscountPaise)}</strong></div>

              <div className="grand"><span>Final payable</span><strong>{formatINR(totalPaise)}</strong></div>

              {selectedMethods.map(method => <div key={method}><span>{method}</span><strong>{formatINR(toPaise(tenderAmounts[method] || "0"))}</strong></div>)}

              <div><span>Total paid</span><strong>{formatINR(paidPaise)}</strong></div>

              <div><span>Remaining balance</span><strong>{formatINR(remainingPaise)}</strong></div>

            </div>

            <div className="modal-footer">

              <button type="button" className="btn-outline" onClick={() => setPaymentConfirmOpen(false)} disabled={checkoutPending}>Back to bill</button>

              <button type="button" className="btn-primary" onClick={() => void completePayment()} disabled={checkoutPending}>

                {checkoutPending ? "Saving…" : trialMode ? "Confirm and save trial" : "Confirm and complete payment"}

              </button>

            </div>

          </div>

        </ActionDialog>

      )}

      {trialSuccess && (

        <ActionDialog title="Trial bill saved" description={trialSuccess.trialNumber} onClose={() => setTrialSuccess(null)}>

          <div className="modal-body success-body">

            <div className="success-mark"><Check size={25}/></div>

            <p>Advance received: <strong>{formatINR(trialSuccess.paidPaise)}</strong></p>

            <p>Balance due: <strong>{formatINR(trialSuccess.balancePaise)}</strong></p>

            <div className="modal-footer">

              <button className="btn-outline" onClick={() => setTrialSuccess(null)}>New bill</button>

              <button className="btn-primary" onClick={() => setLocation("/trials")}>View / print trial</button>

            </div>

          </div>

        </ActionDialog>

      )}

      {successInfo && (

        <ActionDialog title="Payment successful" description={successInfo.invoiceNumber} onClose={() => setSuccessInfo(null)}>

          <div className="modal-body success-body">

            <div className="success-mark"><Check size={25} /></div>

            <p style={{ textAlign: "center", color: "#64748b", marginBottom: 8 }}>

              {new Date(successInfo.invoiceDate).toLocaleString("en-IN", {

                timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",

                hour: "2-digit", minute: "2-digit", second: "2-digit",

              })} IST

            </p>

            <div className="payment-success-total">{formatINR(successInfo.totalPaise)}</div>

            <div className="payment-confirm-totals">

              <div><span>Original amount</span><strong>{formatINR(successInfo.subtotalPaise)}</strong></div>

              <div><span>Product discounts</span><strong>− {formatINR(successInfo.productDiscountPaise)}</strong></div>

                <div><span>Bill discount</span><strong>− {formatINR(successInfo.billDiscountPaise)}</strong></div>

                <div><span>Returned discount (return credit)</span><strong>− {formatINR(successInfo.returnedDiscountPaise)}</strong></div>

              <div><span>Total discount</span><strong>− {formatINR(successInfo.totalDiscountPaise)}</strong></div>

              <div className="grand"><span>Final payable</span><strong>{formatINR(successInfo.totalPaise)}</strong></div>

              <div><span>Amount received</span><strong>{formatINR(successInfo.paidPaise)}</strong></div>

              <div><span>Change returned</span><strong>{formatINR(successInfo.changePaise)}</strong></div>

            </div>

            <p>Customer · <strong>{successInfo.customerName}</strong></p>

            <div className="success-payment-list">{successInfo.tenders.map(tender => <div key={tender.method}><span>{tender.method}</span><strong>{formatINR(tender.amountPaise)}</strong></div>)}</div>

            <div className="modal-footer" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="button" className="btn-outline" onClick={() => setSuccessInfo(null)}>New bill</button>
              <button type="button" className="btn-primary" disabled={receiptPrinting}
                onClick={() => void printSavedReceipt(successInfo.id)}>
                {receiptPrinting ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                {receiptPrinting ? "Preparing print..." : "Print receipt"}
              </button>
            </div>

          </div>

        </ActionDialog>

      )}

    </RetailLayout>

  );

}

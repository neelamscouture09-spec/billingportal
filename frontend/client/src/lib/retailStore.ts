import { useSyncExternalStore } from "react";
import { barcode13, discountAmount, invoiceLabel, proportionalReturnAmount, spreadDiscount } from "@/lib/retail";
import type { RefundMethod, ReturnReason, RetailCustomer, RetailInvoice, RetailInvoiceDetail, RetailInvoiceItem, RetailPayment, RetailProduct, RetailReturn, RetailReturnedLine, RetailSettings, RetailSupplier, RetailSupplierCode, TenderMethod } from "@/lib/retailTypes";

const STORAGE_KEY = "stylepos.browser-store.v1";

type IdCounters = { product: number; supplier: number; code: number; customer: number; invoice: number; item: number; payment: number; return: number; returnItem: number };
export type RetailState = {
  products: RetailProduct[];
  suppliers: RetailSupplier[];
  customers: RetailCustomer[];
  invoices: RetailInvoiceDetail[];
  settings: RetailSettings;
  nextIds: IdCounters;
};

type StorageAdapter = Pick<Storage, "getItem" | "setItem">;
export type RetailPersistenceStatus = { persistent: boolean; message: string | null };
type ProductInput = Omit<RetailProduct, "id" | "createdAt" | "barcode"> & { barcode?: string };
type SupplierInput = { name: string };
type CustomerInput = Omit<RetailCustomer, "id">;
type CheckoutInput = {
  customer: Omit<RetailCustomer, "id">;
  items: { productId: number; quantity: number; productDiscountPaise: number }[];
  billDiscountMode: "percent" | "fixed";
  billDiscountValue: number;
  tenders: { method: TenderMethod; amountPaise: number }[];
};
type ReturnInput = {
  invoiceId: number;
  reason: ReturnReason;
  refundMethod: RefundMethod;
  items: { invoiceItemId: number; quantity: number; reason: ReturnReason }[];
};
type ReportRange = { from?: string; to?: string };

const emptyState = (): RetailState => ({
  products: [],
  suppliers: [],
  customers: [],
  invoices: [],
  settings: { storeName: "StylePOS Boutique", address: "", phone: "", email: "" },
  nextIds: { product: 1, supplier: 1, code: 1, customer: 1, invoice: 1, item: 1, payment: 1, return: 1, returnItem: 1 },
});

function readState(storage: StorageAdapter | null, onFailure: (message: string) => void): RetailState {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const saved = JSON.parse(raw) as Partial<RetailState>;
    if (!saved || !Array.isArray(saved.products) || !Array.isArray(saved.suppliers) || !Array.isArray(saved.customers) || !Array.isArray(saved.invoices)) {
      onFailure("Saved browser data could not be read. New changes may not survive a page reload.");
      return emptyState();
    }
    const initial = emptyState();
    return {
      ...initial,
      ...saved,
      settings: { ...initial.settings, ...(saved.settings ?? {}) },
      nextIds: { ...initial.nextIds, ...(saved.nextIds ?? {}) },
    };
  } catch {
    onFailure("Browser storage could not be read. Changes may not survive a page reload.");
    return emptyState();
  }
}
const localStorageAdapter = (): StorageAdapter | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function createRetailStore(storage: StorageAdapter | null = null) {
  let persistenceMessage: string | null = storage ? null : "Browser storage is unavailable. Changes may not survive a page reload.";
  let readFailed = false;
  let state = readState(storage, (message) => { persistenceMessage = message; readFailed = true; });
  const listeners = new Set<() => void>();
  const getState = () => state;
  const getPersistenceStatus = (): RetailPersistenceStatus => ({ persistent: Boolean(storage) && persistenceMessage === null, message: persistenceMessage });
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const commit = <T,>(update: (current: RetailState) => { next: RetailState; value: T }): T => {
    const result = update(state);
    state = result.next;
    if (!storage) {
      persistenceMessage = "Browser storage is unavailable. Changes may not survive a page reload.";
    } else {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
        if (!readFailed) persistenceMessage = null;
      } catch {
        persistenceMessage = "Browser storage is blocked or full. Changes in this tab may be lost when the page reloads.";
      }
    }
    listeners.forEach((listener) => listener());
    return result.value;
  };
  const allocate = (current: RetailState, key: keyof IdCounters) => ({ id: current.nextIds[key], nextIds: { ...current.nextIds, [key]: current.nextIds[key] + 1 } });

  function uniqueBarcode(existing: Iterable<string> = state.products.map((product) => product.barcode), reserved = new Set<string>()) {
    const used = new Set(existing);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = barcode13();
      if (!used.has(value) && !reserved.has(value)) { reserved.add(value); return value; }
    }
    throw new Error("Could not generate a unique barcode. Please try again.");
  }

  function searchCustomers(query: string): RetailCustomer[] {
    const term = query.trim().toLocaleLowerCase();
    if (term.length < 2) return [];
    return state.customers.filter((customer) => customer.name.toLocaleLowerCase().includes(term) || customer.phone.toLocaleLowerCase().includes(term)).slice(0, 8);
  }

  function searchInvoices(query: string): RetailInvoice[] {
    const term = query.trim().toLocaleLowerCase();
    if (term.length < 2) return [];
    return [...state.invoices]
      .filter((invoice) => [invoice.invoiceNumber, invoice.customerName, invoice.customerPhone].some((value) => value.toLocaleLowerCase().includes(term)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12);
  }

  function overview() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaysSales = state.invoices.filter((invoice) => new Date(invoice.createdAt) >= today && invoice.status !== "voided");
    const todaysReturns = state.invoices.flatMap((invoice) => invoice.returns).filter((row) => new Date(row.createdAt) >= today);
    const salesPaise = todaysSales.reduce((sum, invoice) => sum + invoice.totalPaise, 0);
    return { salesPaise, revenuePaise: salesPaise - todaysReturns.reduce((sum, row) => sum + row.amountPaise, 0), transactions: todaysSales.length, productsCount: state.products.length };
  }

  function report(range: ReportRange = {}) {
    const from = range.from ? localDate(range.from) : null;
    const to = range.to ? new Date(`${range.to}T23:59:59.999`) : null;
    const invoices = state.invoices
      .filter((invoice) => invoice.status !== "voided")
      .filter((invoice) => { const date = new Date(invoice.createdAt); return (!from || date >= from) && (!to || date <= to); })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
    const totalSalesPaise = invoices.reduce((sum, invoice) => sum + invoice.totalPaise, 0);
    const refunds = state.invoices.flatMap((invoice) => invoice.returns).filter((row) => invoiceIds.has(row.invoiceId)).reduce((sum, row) => sum + row.amountPaise, 0);
    const totalDiscountsPaise = invoices.reduce((sum, invoice) => sum + invoice.productDiscountPaise + invoice.billDiscountPaise, 0);
    return {
      invoices: invoices.map((invoice) => ({ ...invoice, itemsCount: invoice.items.reduce((sum, item) => sum + item.quantity, 0), paymentMethods: [...new Set(invoice.payments.map((payment) => payment.method))].join(", ") })),
      totalSalesPaise,
      revenuePaise: totalSalesPaise - refunds,
      totalDiscountsPaise,
      transactions: invoices.length,
      averageOrderPaise: invoices.length ? Math.round(totalSalesPaise / invoices.length) : 0,
    };
  }

  function createProduct(input: ProductInput) {
    return commit((current) => {
      const barcode = input.barcode?.trim() || uniqueBarcode(current.products.map((row) => row.barcode));
      if (current.products.some((row) => row.barcode === barcode)) throw new Error("Barcode already exists. Generate a new barcode.");
      const { id, nextIds } = allocate(current, "product");
      const product: RetailProduct = { ...input, id, barcode, createdAt: new Date().toISOString() };
      return { next: { ...current, nextIds, products: [product, ...current.products] }, value: { id, barcode } };
    });
  }

  function updateProduct(input: ProductInput & { id: number }) {
    return commit((current) => {
      const original = current.products.find((product) => product.id === input.id);
      if (!original) throw new Error("Product could not be found.");
      const barcode = input.barcode?.trim() || uniqueBarcode(current.products.filter((row) => row.id !== input.id).map((row) => row.barcode));
      if (current.products.some((row) => row.id !== input.id && row.barcode === barcode)) throw new Error("Barcode already exists. Generate a new barcode.");
      const products = current.products.map((product) => product.id === input.id ? { ...product, ...input, barcode } : product);
      return { next: { ...current, products }, value: { success: true } };
    });
  }

  function removeProduct(id: number) {
    return commit((current) => ({ next: { ...current, products: current.products.filter((product) => product.id !== id) }, value: { success: true } }));
  }

  function importProducts(rows: Omit<ProductInput, "barcode">[]) {
    return commit((current) => {
      const reserved = new Set<string>();
      let nextIds = current.nextIds;
      const products = rows.map((row) => {
        const { id, nextIds: afterId } = allocate({ ...current, nextIds }, "product"); nextIds = afterId;
        return { ...row, id, barcode: uniqueBarcode(current.products.map((product) => product.barcode), reserved), createdAt: new Date().toISOString() } satisfies RetailProduct;
      });
      return { next: { ...current, nextIds, products: [...products, ...current.products] }, value: { count: products.length } };
    });
  }

  function createSupplier(input: SupplierInput) {
    return commit((current) => {
      const { id, nextIds } = allocate(current, "supplier");
      const supplier: RetailSupplier = { id, name: input.name.trim(), createdAt: new Date().toISOString(), codes: [] };
      return { next: { ...current, nextIds, suppliers: [supplier, ...current.suppliers] }, value: { id } };
    });
  }

  function updateSupplier(input: SupplierInput & { id: number }) {
    return commit((current) => ({ next: { ...current, suppliers: current.suppliers.map((supplier) => supplier.id === input.id ? { ...supplier, name: input.name.trim() } : supplier) }, value: { success: true } }));
  }

  function removeSupplier(id: number) {
    return commit((current) => ({ next: { ...current, suppliers: current.suppliers.filter((supplier) => supplier.id !== id) }, value: { success: true } }));
  }

  function addSupplierCode(input: { supplierId: number; code: string }) {
    return commit((current) => {
      if (!current.suppliers.some((supplier) => supplier.id === input.supplierId)) throw new Error("Supplier could not be found.");
      const { id, nextIds } = allocate(current, "code");
      const code: RetailSupplierCode = { id, supplierId: input.supplierId, code: input.code.trim(), createdAt: new Date().toISOString() };
      return { next: { ...current, nextIds, suppliers: current.suppliers.map((supplier) => supplier.id === input.supplierId ? { ...supplier, codes: [...supplier.codes, code] } : supplier) }, value: { success: true } };
    });
  }

  function updateSupplierCode(input: { id: number; code: string }) {
    return commit((current) => ({ next: { ...current, suppliers: current.suppliers.map((supplier) => ({ ...supplier, codes: supplier.codes.map((code) => code.id === input.id ? { ...code, code: input.code.trim() } : code) })) }, value: { success: true } }));
  }

  function removeSupplierCode(id: number) {
    return commit((current) => ({ next: { ...current, suppliers: current.suppliers.map((supplier) => ({ ...supplier, codes: supplier.codes.filter((code) => code.id !== id) })) }, value: { success: true } }));
  }

  function checkout(input: CheckoutInput) {
    return commit((current) => {
      if (!input.items.length) throw new Error("Add at least one product to the bill.");
      if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) throw new Error("Each product can appear only once in the bill.");
      const productsById = new Map(current.products.map((product) => [product.id, product]));
      const selected = input.items.map((item) => {
        const product = productsById.get(item.productId);
        if (!product) throw new Error("One or more products are no longer available.");
        const gross = product.pricePaise * item.quantity;
        if (item.productDiscountPaise > gross) throw new Error(`Discount exceeds the price for ${product.name}.`);
        return { item, product, base: gross - item.productDiscountPaise };
      });
      const subtotalPaise = selected.reduce((sum, row) => sum + row.product.pricePaise * row.item.quantity, 0);
      const productDiscountPaise = selected.reduce((sum, row) => sum + row.item.productDiscountPaise, 0);
      const afterProductDiscount = selected.reduce((sum, row) => sum + row.base, 0);
      const billDiscountPaise = discountAmount(afterProductDiscount, input.billDiscountMode, input.billDiscountValue);
      const billShares = spreadDiscount(billDiscountPaise, selected.map((row) => row.base));
      const totalPaise = afterProductDiscount - billDiscountPaise;
      const paidPaise = input.tenders.reduce((sum, tender) => sum + tender.amountPaise, 0);
      if (paidPaise < totalPaise) throw new Error("Please enter the complete payment amount.");
      if (!input.tenders.some((tender) => tender.amountPaise > 0)) throw new Error("Select a payment method and enter the complete amount.");

      let customers = current.customers;
      let nextIds = current.nextIds;
      let customerId: number | null = null;
      const customerInput = input.customer;
      const phone = customerInput.phone.trim();
      if (phone) {
        const existing = customers.find((customer) => customer.phone.trim() === phone);
        if (existing) {
          customerId = existing.id;
          customers = customers.map((customer) => customer.id === customerId ? { ...customer, ...customerInput, phone } : customer);
        }
      }
      const hasCustomerDetails = [customerInput.name, phone, customerInput.email, customerInput.address].some((value) => value.trim());
      if (customerId === null && hasCustomerDetails) {
        const allocated = allocate({ ...current, nextIds }, "customer"); nextIds = allocated.nextIds;
        customerId = allocated.id;
        customers = [{ ...customerInput, id: customerId, phone }, ...customers];
      }

      const invoiceAllocation = allocate({ ...current, nextIds }, "invoice"); nextIds = invoiceAllocation.nextIds;
      const invoiceId = invoiceAllocation.id;
      const createdAt = new Date().toISOString();
      const invoiceNumber = invoiceLabel(invoiceId, new Date(createdAt));
      const items: RetailInvoiceItem[] = selected.map(({ item, product, base }, index) => {
        const allocated = allocate({ ...current, nextIds }, "item"); nextIds = allocated.nextIds;
        return { id: allocated.id, invoiceId, productId: product.id, productName: product.name, size: product.size, supplierCode: product.supplierCode, barcode: product.barcode, quantity: item.quantity, unitPricePaise: product.pricePaise, productDiscountPaise: item.productDiscountPaise, billDiscountPaise: billShares[index], finalAmountPaise: base - billShares[index], stockTracked: product.onHand === null ? 0 : 1 };
      });
      const payments: RetailPayment[] = input.tenders.filter((tender) => tender.amountPaise > 0).map((tender) => {
        const allocated = allocate({ ...current, nextIds }, "payment"); nextIds = allocated.nextIds;
        return { id: allocated.id, invoiceId, method: tender.method, amountPaise: tender.amountPaise };
      });
      const invoice: RetailInvoiceDetail = {
        id: invoiceId, invoiceNumber, customerId, customerName: customerInput.name.trim() || "Walk-in customer", customerPhone: phone,
        customerEmail: customerInput.email.trim(), customerAddress: customerInput.address.trim(), subtotalPaise, productDiscountPaise, billDiscountPaise,
        totalPaise, paidPaise, changePaise: Math.max(0, paidPaise - totalPaise), status: "completed", createdAt, items, payments, returns: [], returnedLines: [],
      };
      const quantities = new Map<number, number>();
      input.items.forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity));
      const products = current.products.map((product) => product.onHand !== null && quantities.has(product.id) ? { ...product, onHand: product.onHand - (quantities.get(product.id) ?? 0) } : product);
      return { next: { ...current, nextIds, customers, products, invoices: [invoice, ...current.invoices] }, value: { id: invoiceId, invoiceNumber, totalPaise, paidPaise, changePaise: invoice.changePaise } };
    });
  }

  function voidInvoice(id: number) {
    return commit((current) => {
      const invoice = current.invoices.find((row) => row.id === id);
      if (!invoice) throw new Error("Purchase could not be found.");
      if (invoice.status !== "completed" || invoice.returns.length) throw new Error("Only a completed, non-returned purchase can be voided.");
      const quantities = new Map<number, number>();
      invoice.items.forEach((item) => { if (item.productId && item.stockTracked) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity); });
      const products = current.products.map((product) => product.onHand !== null && quantities.has(product.id) ? { ...product, onHand: product.onHand + (quantities.get(product.id) ?? 0) } : product);
      const invoices = current.invoices.map((row) => row.id === id ? { ...row, status: "voided" as const } : row);
      return { next: { ...current, products, invoices }, value: { success: true } };
    });
  }

  function createReturn(input: ReturnInput) {
    return commit((current) => {
      if (new Set(input.items.map((item) => item.invoiceItemId)).size !== input.items.length) throw new Error("Select each invoice product only once.");
      const invoice = current.invoices.find((row) => row.id === input.invoiceId);
      if (!invoice || invoice.status === "voided") throw new Error("Invoice could not be found.");
      const selections = input.items.map((selection) => {
        const sale = invoice.items.find((item) => item.id === selection.invoiceItemId);
        if (!sale) throw new Error("A selected product does not belong to this invoice.");
        const alreadyReturned = invoice.returnedLines.filter((line) => line.invoiceItemId === sale.id).reduce((sum, line) => sum + line.quantity, 0);
        if (selection.quantity + alreadyReturned > sale.quantity) throw new Error(`Return quantity exceeds the sold quantity for ${sale.productName}.`);
        return { sale, quantity: selection.quantity, reason: selection.reason, amountPaise: proportionalReturnAmount(sale.finalAmountPaise, sale.quantity, alreadyReturned, selection.quantity) };
      });
      const refund = selections.reduce((sum, row) => sum + row.amountPaise, 0);
      let nextIds = current.nextIds;
      const allocatedReturn = allocate({ ...current, nextIds }, "return"); nextIds = allocatedReturn.nextIds;
      const returnId = allocatedReturn.id;
      const createdAt = new Date().toISOString();
      const returnRecord: RetailReturn = { id: returnId, invoiceId: input.invoiceId, refundMethod: input.refundMethod, reason: input.reason, amountPaise: refund, createdAt };
      const returnedLines: RetailReturnedLine[] = selections.map((selection) => {
        const allocated = allocate({ ...current, nextIds }, "returnItem"); nextIds = allocated.nextIds;
        return { id: allocated.id, returnId, invoiceItemId: selection.sale.id, productId: selection.sale.productId, quantity: selection.quantity, amountPaise: selection.amountPaise, reason: selection.reason };
      });
      const allRefunds = [...invoice.returns, returnRecord].reduce((sum, row) => sum + row.amountPaise, 0);
      const updatedInvoice = { ...invoice, returns: [...invoice.returns, returnRecord], returnedLines: [...invoice.returnedLines, ...returnedLines], status: (allRefunds >= invoice.totalPaise ? "returned" : "partially_returned") as RetailInvoice["status"] };
      const quantityByProduct = new Map<number, number>();
      selections.forEach(({ sale, quantity }) => { if (sale.productId && sale.stockTracked) quantityByProduct.set(sale.productId, (quantityByProduct.get(sale.productId) ?? 0) + quantity); });
      const products = current.products.map((product) => product.onHand !== null && quantityByProduct.has(product.id) ? { ...product, onHand: product.onHand + (quantityByProduct.get(product.id) ?? 0) } : product);
      return { next: { ...current, nextIds, products, invoices: current.invoices.map((row) => row.id === input.invoiceId ? updatedInvoice : row) }, value: { id: returnId, amountPaise: refund } };
    });
  }

  function updateSettings(input: RetailSettings) {
    const settings = { ...input, storeName: input.storeName.trim() };
    if (!settings.storeName) throw new Error("Store name is required.");
    return commit((current) => ({ next: { ...current, settings }, value: { success: true } }));
  }

  return { getState, getPersistenceStatus, subscribe, searchCustomers, searchInvoices, overview, report, createProduct, updateProduct, removeProduct, importProducts, createSupplier, updateSupplier, removeSupplier, addSupplierCode, updateSupplierCode, removeSupplierCode, checkout, voidInvoice, createReturn, updateSettings };
}

export const retailStore = createRetailStore(localStorageAdapter());
export function useRetailState(): RetailState {
  return useSyncExternalStore(retailStore.subscribe, retailStore.getState, retailStore.getState);
}

import { describe, expect, it } from "vitest";
import { createRetailStore } from "@/lib/retailStore";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class FailingStorage extends MemoryStorage {
  setItem(_key: string, _value: string) { throw new Error("quota exceeded"); }
}

function setup() {
  const storage = new MemoryStorage();
  const store = createRetailStore(storage);
  const product = store.createProduct({ name: "Linen shirt", size: "M", supplierCode: "SUP-01", category: "Shirts", pricePaise: 10_000, onHand: 5 });
  return { storage, store, product };
}

describe("browser-only retail store", () => {
  it("keeps the current tab usable but flags blocked or full storage", () => {
    const store = createRetailStore(new FailingStorage());
    store.createProduct({ name: "Linen shirt", size: "M", supplierCode: "SUP-01", category: "Shirts", pricePaise: 10_000, onHand: null });
    expect(store.getState().products).toHaveLength(1);
    expect(store.getPersistenceStatus().persistent).toBe(false);
    expect(store.getPersistenceStatus().message).toMatch(/blocked or full/i);
  });

  it("persists product and split-tender sale in local storage without a server", () => {
    const { storage, store, product } = setup();
    const sale = store.checkout({
      customer: { name: "Asha Rao", phone: "9876543210", email: "asha@example.test", address: "Pune" },
      items: [{ productId: product.id, quantity: 2, productDiscountPaise: 200 }],
      billDiscountMode: "percent",
      billDiscountValue: 10,
      tenders: [{ method: "Cash", amountPaise: 9_000 }, { method: "UPI", amountPaise: 9_000 }],
    });
    expect(sale.totalPaise).toBe(17_820);
    expect(sale.changePaise).toBe(180);
    expect(store.getState().products[0].onHand).toBe(3);
    expect(store.getState().invoices[0].payments.map((payment) => payment.method)).toEqual(["Cash", "UPI"]);

    const reopened = createRetailStore(storage);
    expect(reopened.getState().products[0].onHand).toBe(3);
    expect(reopened.getState().invoices[0].invoiceNumber).toBe(sale.invoiceNumber);
    expect(reopened.getState().customers[0].name).toBe("Asha Rao");
  });

  it("allocates partial refunds exactly and restores tracked stock", () => {
    const { store, product } = setup();
    const sale = store.checkout({
      customer: { name: "", phone: "", email: "", address: "" },
      items: [{ productId: product.id, quantity: 2, productDiscountPaise: 0 }],
      billDiscountMode: "fixed",
      billDiscountValue: 0,
      tenders: [{ method: "Card", amountPaise: 20_000 }],
    });
    const invoice = store.getState().invoices.find((row) => row.id === sale.id)!;
    const item = invoice.items[0];

    const first = store.createReturn({ invoiceId: sale.id, reason: "Size issue", refundMethod: "Cash", items: [{ invoiceItemId: item.id, quantity: 1, reason: "Size issue" }] });
    expect(first.amountPaise).toBe(10_000);
    expect(store.getState().products[0].onHand).toBe(4);
    expect(store.getState().invoices[0].status).toBe("partially_returned");

    const second = store.createReturn({ invoiceId: sale.id, reason: "Customer changed mind", refundMethod: "UPI", items: [{ invoiceItemId: item.id, quantity: 1, reason: "Customer changed mind" }] });
    expect(second.amountPaise).toBe(10_000);
    expect(store.getState().products[0].onHand).toBe(5);
    expect(store.getState().invoices[0].status).toBe("returned");
    expect(() => store.createReturn({ invoiceId: sale.id, reason: "Other", refundMethod: "Cash", items: [{ invoiceItemId: item.id, quantity: 1, reason: "Other" }] })).toThrow(/exceeds/i);
  });

  it("filters reports by local date and rejects underpaid checkout", () => {
    const { store, product } = setup();
    expect(() => store.checkout({
      customer: { name: "", phone: "", email: "", address: "" },
      items: [{ productId: product.id, quantity: 1, productDiscountPaise: 0 }],
      billDiscountMode: "fixed", billDiscountValue: 0,
      tenders: [{ method: "Cash", amountPaise: 100 }],
    })).toThrow(/complete payment/i);
    const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const sale = store.checkout({
      customer: { name: "", phone: "", email: "", address: "" },
      items: [{ productId: product.id, quantity: 1, productDiscountPaise: 0 }],
      billDiscountMode: "fixed", billDiscountValue: 0,
      tenders: [{ method: "Card", amountPaise: 10_000 }],
    });
    const report = store.report({ from: date, to: date });
    expect(report.transactions).toBe(1);
    expect(report.revenuePaise).toBe(10_000);
    expect(report.invoices[0].id).toBe(sale.id);
  });
});

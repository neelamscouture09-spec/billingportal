export type RetailProduct = {
  id: number;
  name: string;
  size: string;
  supplierCode: string;
  category: string;
  pricePaise: number;
  barcode: string;
  onHand: number | null;
  createdAt: string;
};

export type RetailSupplierCode = {
  id: number;
  supplierId: number;
  code: string;
  createdAt: string;
};

export type RetailSupplier = {
  id: number;
  name: string;
  createdAt: string;
  codes: RetailSupplierCode[];
};

export type RetailCustomer = {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
};

export type RetailInvoiceStatus = "completed" | "partially_returned" | "returned" | "voided";
export type TenderMethod = "Cash" | "Card" | "UPI" | "Bank Transfer" | "Other";
export type RefundMethod = "Cash" | "Card" | "UPI" | "Store Credit";
export type ReturnReason = "Size issue" | "Damaged" | "Wrong product" | "Customer changed mind" | "Other";

export type RetailInvoiceItem = {
  id: number;
  invoiceId: number;
  productId: number | null;
  productName: string;
  size: string;
  supplierCode: string;
  barcode: string;
  quantity: number;
  unitPricePaise: number;
  productDiscountPaise: number;
  billDiscountPaise: number;
  finalAmountPaise: number;
  stockTracked: 0 | 1;
};

export type RetailPayment = {
  id: number;
  invoiceId: number;
  method: TenderMethod;
  amountPaise: number;
};

export type RetailReturn = {
  id: number;
  invoiceId: number;
  refundMethod: RefundMethod;
  reason: ReturnReason;
  amountPaise: number;
  createdAt: string;
};

export type RetailReturnedLine = {
  id: number;
  returnId: number;
  invoiceItemId: number;
  productId: number | null;
  quantity: number;
  amountPaise: number;
  reason: ReturnReason;
};

export type RetailInvoice = {
  id: number;
  invoiceNumber: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  subtotalPaise: number;
  productDiscountPaise: number;
  billDiscountPaise: number;
  totalPaise: number;
  paidPaise: number;
  changePaise: number;
  status: RetailInvoiceStatus;
  createdAt: string;
  items: RetailInvoiceItem[];
  payments: RetailPayment[];
  returns: RetailReturn[];
  returnedLines: RetailReturnedLine[];
  itemsCount?: number;
  paymentMethods?: string;
};

export type RetailInvoiceDetail = RetailInvoice;

export type RetailSettings = {
  storeName: string;
  address: string;
  phone: string;
  email: string;
};

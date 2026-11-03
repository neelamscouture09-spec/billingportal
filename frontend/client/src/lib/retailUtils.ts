import { formatINR } from "@/lib/retail";

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const content = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export function saleExportRows(rows: { invoiceNumber: string; createdAt: Date | string; customerName: string; itemsCount: number; totalPaise: number; productDiscountPaise: number; billDiscountPaise: number; paymentMethods: string; status: string }[]) {
  return [["Invoice Number", "Date", "Customer", "Items", "Total Amount", "Discount", "Payment Methods", "Status"], ...rows.map((row) => [row.invoiceNumber, new Date(row.createdAt).toLocaleString("en-IN"), row.customerName, row.itemsCount, formatINR(row.totalPaise), formatINR(row.productDiscountPaise + row.billDiscountPaise), row.paymentMethods, row.status])];
}

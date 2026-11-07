
 // Return receipts share the A5 table alignment used by Sales Reports.
 // Intended for preprinted A5 paper:
 // - No branded header is drawn.
 // - Maximum 5 returned product lines per page.
 // - Settlement summary appears once, immediately after the last item.
 // - No text is placed in the preprinted footer area.

 export type ReturnReceipt = {
   id: string;
   returnNumber: string;
   createdAt: string;
   invoiceNumber: string;
   invoiceDate: string;
   customerName: string;
   customerPhone: string;

   originalInvoiceTotalPaise: number;
   originalInvoiceGrossPaise: number;

   originalReturnedGrossPaise: number;
   returnedProductDiscountPaise: number;
   allocatedDeductionsPaise: number;
   settlementPaise: number;
   returnedBillDiscountPaise: number;
   returnedPreviouslyAppliedCreditPaise: number;

   billDiscountMode: string;
   billDiscountValue: string;

   status: "PENDING" | "CLAIMED" | "LEGACY_NO_CREDIT";
   claimedAt?: string | null;

   items: Array<{
     id: string;
     name: string;
     barcode: string;
     quantity: number;
     unitPricePaise: number;
     grossPaise: number;
     productDiscountPaise: number;
     discountMode: string;
     discountValue: string;
     netAfterProductDiscountPaise: number;
     allocatedDeductionsPaise: number;
     settlementPaise: number;
     billDiscountSharePaise: number;
     previousCreditSharePaise: number;
   }>;
 };

 const A5_WIDTH = 148;
 const ITEMS_PER_PAGE = 5;
 const ROW_HEIGHT = 9.2;

 const BLUE: [number, number, number] = [12, 58, 140];
 const RULE: [number, number, number] = [170, 187, 215];

 const cash = (paise: number): string =>
   `Rs. ${(paise / 100).toFixed(2)}`;

 const dateLabel = (date: string): string =>
   new Intl.DateTimeFormat("en-IN", {
     timeZone: "Asia/Kolkata",
     day: "2-digit",
     month: "short",
     year: "numeric",
     hour: "2-digit",
     minute: "2-digit",
     hour12: true,
   }).format(new Date(date));

 export async function buildReturnReceiptPdf(info: ReturnReceipt) {
   const { default: jsPDF } = await import("jspdf");

   const doc = new jsPDF({
     orientation: "portrait",
     unit: "mm",
     format: "a5",
     compress: true,
   });

   // Same paper margins used by the Sales Reports receipt.
   const left = 8;
   const right = A5_WIDTH - 8;

   // Fixed table columns:
   // AMOUNT ends at 136 mm, leaving 12 mm on the right.
   const column = {
     productStart: 14,
     productEnd: 71,

     qty: {
       start: 74,
       end: 80,
     },

     rate: {
       start: 83,
       end: 101,
     },

     discount: {
       start: 104,
       end: 119,
     },

     amount: {
       start: 122,
       end: 136,
     },
   } as const;

   const pageCount = Math.max(
     1,
     Math.ceil(info.items.length / ITEMS_PER_PAGE)
   );

   const draw = (
     value: string,
     x: number,
     y: number,
     align?: "right"
   ) => {
     doc.text(
       value,
       x,
       y,
       align ? { align } : undefined
     );
   };

   const font = (size: number, bold = false) => {
     doc.setFont("helvetica", bold ? "bold" : "normal");
     doc.setFontSize(size);
   };

   const rule = (y: number) => {
     doc.setDrawColor(...RULE);
     doc.setLineWidth(0.16);
     doc.line(left, y, right, y);
   };

   // Automatically shrink larger prices to their column width.
   const fitRight = (
     value: string,
     start: number,
     end: number,
     y: number,
     size = 6.9
   ) => {
     font(size);

     const availableWidth = end - start;
     const textWidth = doc.getTextWidth(value);

     if (textWidth > availableWidth) {
       const adjustedSize =
         (size * availableWidth * 0.98) / textWidth;

       doc.setFontSize(adjustedSize);
     }

     draw(value, end, y, "right");
   };

   // Summary values are aligned to the same right margin.
   const summary = (
     label: string,
     value: string,
     y: number,
     bold = false,
     size = 7.6
   ) => {
     font(size, bold);

     const labelX = left + 1;
     const valueX = right - 5;
     const gap = 3;
     const maximumLabelWidth =
       valueX - labelX - doc.getTextWidth(value) - gap;

     const fittedLabel =
       doc.getTextWidth(label) > maximumLabelWidth
         ? doc.splitTextToSize(
             label,
             Math.max(20, maximumLabelWidth)
           )[0] ?? label
         : label;

     draw(fittedLabel, labelX, y);
     draw(value, valueX, y, "right");
   };

   let serial = 0;

   for (let page = 0; page < pageCount; page++) {
     if (page > 0) {
       doc.addPage("a5", "portrait");
     }

     doc.setTextColor(...BLUE);
     doc.setDrawColor(...RULE);

     // Keep the preprinted header area untouched.
     // Existing receipt content begins below the header.
     rule(43);

     // Return details.
     font(8.5, true);

     draw(
       `RETURN: ${info.returnNumber}`,
       left,
       50
     );

     font(7.6);

     draw(
       dateLabel(info.createdAt),
       right,
       50,
       "right"
     );

     if (page === 0) {
       font(8.2, true);
       draw("RETURNED BY", left, 57);

       font(7.7);

       draw(
         doc.splitTextToSize(
           `Name: ${info.customerName || "Walk-in customer"}`,
           125
         )[0] || "",
         left,
         62
       );

       draw(
         `Phone: ${info.customerPhone || "-"}`.slice(0, 70),
         left,
         67
       );

       draw(
         `Original invoice: ${info.invoiceNumber}`.slice(0, 70),
         left,
         72
       );

       font(7.3);

       draw(
         `Purchase date: ${dateLabel(info.invoiceDate)}`,
         left,
         76.5
       );
     } else {
       font(7.8);

       draw(
         `Original invoice: ${info.invoiceNumber}`,
         left,
         60
       );
     }

     // First page starts below customer details.
     // Following pages have a shorter top section.
     const headerY = page === 0 ? 85 : 70;

     rule(headerY - 4);

     font(7.1, true);

     draw("#", left + 1, headerY);

     draw(
       "PRODUCT / SIZE / BARCODE",
       column.productStart,
       headerY
     );

     draw("QTY", column.qty.end, headerY, "right");

     draw("RATE", column.rate.end, headerY, "right");

     draw(
       "DISC.",
       column.discount.end,
       headerY,
       "right"
     );

     draw(
       "AMOUNT",
       column.amount.end,
       headerY,
       "right"
     );

     rule(headerY + 2.5);

     const startY = headerY + 2.5;

     // Exactly 5 return product lines at most per page.
     const pageItems = info.items.slice(
       page * ITEMS_PER_PAGE,
       (page + 1) * ITEMS_PER_PAGE
     );

     pageItems.forEach((item, index) => {
       serial++;

       const rowTop = startY + index * ROW_HEIGHT;

       font(7.3);

       const productLines = doc
         .splitTextToSize(
           item.name || "-",
           column.productEnd - column.productStart
         )
         .slice(0, 2);

       if (productLines.length === 2) {
         font(6.5);
       }

       // Serial number.
       draw(
         String(serial),
         left + 1,
         rowTop + 5.4
       );

       // Product name.
       doc.text(
         productLines,
         column.productStart,
         rowTop + (productLines.length === 2 ? 3 : 3.5)
       );

       font(6.4);

       // Individual discount type.
       const discountType =
         item.productDiscountPaise > 0
           ? item.discountMode === "percent"
             ? ` | ${Number(item.discountValue)}% off`
             : " | fixed off"
           : "";

       const barcodeDetail =
         `${item.barcode || "-"}${discountType}`;

       // Barcode and discount remain within the product column.
       if (productLines.length === 1) {
         draw(
           doc.splitTextToSize(
             barcodeDetail,
             column.productEnd - column.productStart
           )[0],
           column.productStart,
           rowTop + 7
         );
       } else {
         draw(
           doc.splitTextToSize(barcodeDetail, 30)[0],
           column.productStart + 26,
           rowTop + 7.8
         );
       }

       // Numeric values: same aligned columns as Sales Reports.
       fitRight(
         String(item.quantity),
         column.qty.start,
         column.qty.end,
         rowTop + 5.4
       );

       fitRight(
         cash(item.unitPricePaise),
         column.rate.start,
         column.rate.end,
         rowTop + 5.4
       );

       fitRight(
         cash(item.productDiscountPaise),
         column.discount.start,
         column.discount.end,
         rowTop + 5.4
       );

       fitRight(
         cash(item.netAfterProductDiscountPaise),
         column.amount.start,
         column.amount.end,
         rowTop + 5.4
       );

       rule(rowTop + ROW_HEIGHT);
     });

     // Continuation pages never show the settlement summary.
     const isLastPage = page === pageCount - 1;

     if (!isLastPage) {
       font(7.4);

       draw(
         "Continued on next page...",
         left,
         startY + pageItems.length * ROW_HEIGHT + 7
       );

       continue;
     }

     // The summary immediately follows the last returned product.
     // No unnecessary fixed 141 mm starting point.
     const rowsBottom =
       startY + pageItems.length * ROW_HEIGHT;

     const summaryY = rowsBottom + 4;

     rule(summaryY - 3);

     // Removed:
     // 1. Original invoice amount
     // 2. Original purchase payable

     summary(
       "Returned items original value",
       cash(info.originalReturnedGrossPaise),
       summaryY + 1
     );

     summary(
       "Returned product discounts",
       `- ${cash(info.returnedProductDiscountPaise)}`,
       summaryY + 6
     );

     const billLabel =
       info.billDiscountMode === "percent"
         ? `Bill discount (${Number(info.billDiscountValue)}% share)`
         : "Bill discount (allocated)";

     summary(
       billLabel,
       `- ${cash(info.returnedBillDiscountPaise)}`,
       summaryY + 11
     );

     const hasPreviousCredit =
       info.returnedPreviouslyAppliedCreditPaise > 0;

     if (hasPreviousCredit) {
       summary(
         "Previous credit allocated",
         `- ${cash(info.returnedPreviouslyAppliedCreditPaise)}`,
         summaryY + 16
       );
     }

     const offset = hasPreviousCredit ? 5 : 0;

     // Final settlement after all applicable deductions.
     rule(summaryY + 14 + offset);

     summary(
       "OVERALL SETTLEMENT",
       cash(info.settlementPaise),
       summaryY + 20 + offset,
       true,
       9
     );

     rule(summaryY + 23 + offset);

     // Return claim status.
     font(7.4, true);

     const statusText =
       info.status === "CLAIMED"
         ? "STATUS: CLAIMED"
         : info.status === "PENDING"
           ? "STATUS: PENDING CLAIM"
           : "STATUS: OLD STOCK-ONLY RETURN";

     draw(
       statusText,
       left,
       summaryY + 29 + offset
     );

     if (info.claimedAt) {
       font(6.5);

       draw(
         `Claimed: ${dateLabel(info.claimedAt)}`,
         right - 4,
         summaryY + 34 + offset,
         "right"
       );
     }

     // No footer is drawn at y=203.
     // This avoids overriding the preprinted stationery footer.
   }

   return doc;
 }

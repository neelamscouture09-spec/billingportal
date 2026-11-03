# StylePOS delivery TODO

## [x] 1. App shell, navigation, and design
- There is no login screen; opening the app displays POS/Billing directly as the main/home screen.
- Use a compact left sidebar with POS/Billing, Products, Suppliers, Returns, Reports, and Settings at the bottom; POS is highlighted by default.
- The header contains Store Name, Current Date, Search, Notifications, and Quick New Bill. Above the scanner, show four live compact cards: Today's Sales, Today's Bills, Today's Revenue, and Total Products.
- Use the specified Blue + White theme: Primary Blue `#2563EB`; Dark Blue `#1E3A8A`; Light Blue `#EFF6FF`; Background `#F8FAFC`; White `#FFFFFF`; Text `#0F172A`; Secondary Text `#64748B`; Success `#16A34A`; Danger `#DC2626`; Border `#E2E8F0`. Use blue for primary actions and predominantly white surfaces.
- Keep the visual experience minimal, premium, professional, fast, clean, and cashier-friendly. Use subtle page/sidebar/modal/cart/quantity/payment-success animations, toast notifications, hover/button/table-row states and skeleton loading without excessive motion. Selectively use glassmorphism in header, floating summary, payment/success modal, and filter panel while keeping forms/tables readable.
- Support desktop, laptop, tablet and mobile; on smaller screens stack POS barcode/search, cart, customer details, discount, payment, then Complete Payment.
- Empty states: Products “No products added yet.”; Suppliers “No suppliers added yet.”; Reports “No transactions found for the selected period.”; Returns “No matching invoice found.”
- Toasts include Product added successfully; Products imported successfully; Supplier created successfully; Barcode generated; Payment completed; Receipt generated; Return completed; Please enter the complete payment amount; Product not found.
- Confirm delete product, delete supplier, delete supplier code, delete/void transaction, confirm return, and confirm payment. Deletion confirmation says “Are you sure you want to delete this product?” where applicable and offers Cancel/Delete.

## [x] 2. POS billing, customer, discounts, and split payment
- POS is split into a majority-width product-cart area and bill-summary/customer/discount/payment area; place a large Complete Payment action at the bottom-right.
- Provide a large barcode input with placeholder “Scan barcode using scanner” compatible with a normal USB keyboard-wedge scanner. Scanning looks up the product, adds it to cart, increases quantity if already present, and automatically recalculates totals.
- Provide product search by product name, barcode, supplier code, and category.
- Cart shows product name, size, supplier code, selling price, quantity, product discount, final item amount and Remove action. Quantity controls use −/+, update totals automatically, and show a clear product-selection checkbox for discounts.
- “Apply Discount to Selected Products” supports percentage and fixed amount, and affects only the selected products. Overall Bill Discount separately supports percentage and fixed amount over the whole purchase. Show Subtotal, Product Discounts, Overall Discount and Final Total. No GST or other tax calculation; product selling prices are final prices.
- Customer fields are Name, Phone, Email and Address. Validate phone numbers. Existing Customer search accepts phone or name and auto-populates found details.
- Payment methods are Cash, Card, UPI, Bank Transfer and Other. Selecting a method displays an amount input. A purchase supports multiple selected methods and shows each method/amount, Total Purchase, Total Paid, Remaining Balance and Excess/change.
- Do not allow checkout when paid amounts are insufficient; show “Payment Remaining: ₹2,000” with the actual amount due until fully paid. Before payment, show products, product discount, bill discount, total, paid and balance. Complete Payment records the sale only when fully funded.
- After successful billing show a short success animation, invoice number (e.g. INV-000123), amount, customer and payment breakdown; then navigate to Reports/Purchase Details for that transaction.

## [x] 3. Products, barcodes, and spreadsheet import
- Products page has + New Product and Import Excel. Create/edit fields are Product Name; Size with S/M/L/XL/XXL plus custom values; Supplier Code; Category options Shirts, T-Shirts, Jeans, Trousers, Dresses, Sarees, Kids Wear, Accessories, Other; Selling Price; and automatically generated unique Barcode with Generate Again.
- Create Product and Cancel actions; on success show “Product created successfully” and add the product to the list.
- Import `.xlsx` and `.xls`; provide Download Sample Excel with columns Product Name, Size, Supplier Code, Category, Selling Price (barcode is not required). After upload show row preview and validation status, count ready/error rows, and allow Import Products. Automatically generate a unique barcode for every imported product.
- Products table columns: Product Name, Size, Supplier Code, Category, Selling Price, Barcode, Created Date, Actions. Support edit and delete with confirmation.
- Search products by product name, barcode, supplier code; filter by category, size and price range.

## [x] 4. Suppliers and supplier codes
- Suppliers page has + New Supplier; supplier creation requires Supplier Name.
- List Supplier Name, Number of Codes, Created Date and actions View/Edit/Delete.
- Each supplier supports multiple supplier codes, with Create Code, Edit Code and Delete Code actions. Confirm before code deletion. Supplier codes are selectable while creating/editing products.

## [x] 5. Returns and refunds
- Returns page searches invoices by invoice number, customer phone or customer name and displays invoice/customer/date/purchased products. Show “No matching invoice found.” when none match.
- Allow selecting returned products. For each selected product show Product, Original Quantity, Return Quantity, Original Price, Return Amount and Return Reason (Size issue, Damaged, Wrong product, Customer changed mind, Other).
- Prevent return quantity from exceeding the original unreturned quantity. Refund methods: Cash, Card, UPI, Store Credit. Display Return Amount and Refund Method before Confirm Return.
- Successful return updates tracked inventory and sales records, creates a return transaction, records the refund, and displays “Return processed successfully.”

## [x] 6. Reports, purchase details, receipts, and exports
- Reports includes Sales Analytics and Individual Purchase/Receipt Details. KPI cards show Total Sales, Number of Purchases, Average Purchase Value and Revenue.
- Date filters are Today, Yesterday, Last 7 Days, This Month, Last Month, and Custom Date Range with From/To DD/MM/YYYY. All reports update for the chosen period.
- Sales table columns are Invoice Number, Date, Customer, Items, Total Amount, Discount, Payment Methods, Status and Actions View/Receipt.
- Purchase details show customer name, phone, email and address; products with size, supplier code, quantity, selling price, discount and final amount; payment amounts by method and total.
- Provide Print Receipt and Download Receipt. Receipt content includes Store Name, Store Address, Invoice Number, Date, Customer Details, Product Details, Quantity, Selling Price, Product Discounts, Overall Discount, Final Total, Payment Method, Payment Amount and Total Paid.
- Printed receipt supports clean A4 and thermal modes and hides all dashboard UI. Download PDF receipt is professional and includes store, invoice, customer, products, discounts, final amount, payment breakdown and date/time.
- Export the currently filtered date range as PDF, Excel or CSV. PDF sales report includes Store Name, Report Period, Total Sales, Total Revenue, Total Discounts, Number of Transactions, Average Order Value and detailed sales table.

## [x] 7. Local persistence, integrity, and settings
- Persist catalog, suppliers/codes, customers, completed invoices and lines, split tender amounts, returns/refunds, relevant inventory movements and store receipt settings in this browser's localStorage. Do not calculate GST or other taxes. Data is not shared or synchronized across browsers/devices; clearing site data removes it. Do not modify or delete existing managed-database data.
- Payment entries in this app record cashier-entered tender allocations; they do not initiate a card or UPI charge.
- Keep store name/address editable in Settings and use those values in the header and receipts.
- Optional on-hand inventory counts are tracked only when provided; blank means untracked and must not block checkout. Tracked inventory decreases on sale and increases on return.
- If browser storage is blocked, unreadable, or full, keep the current tab usable but show a persistent warning that changes may not survive reload; do not claim the changes are durably saved.

## [x] 8. Frontend-only architecture and static setup
- Remove all frontend connections to application APIs, authentication/OAuth/session endpoints, managed service APIs, server-backed queries/mutations, and server-only browser configuration. POS/catalog/report/settings operations use local browser state/storage only.
- Remove app server, tRPC, Express, database/ORM/migration and container code, dependencies, scripts, and deployment setup from the repository. The app runs via Vite and builds to a static `dist/public` artifact.
- Remove unused frontend integrations that make network requests; do not send browser logs to a development API. Keep the existing managed Server/Database records and their data untouched because the platform does not support disabling those already-enabled capabilities.

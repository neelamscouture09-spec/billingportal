# StylePOS implementation plan — frontend-only revision

## Product scope and implementation approach

Preserve the approved StylePOS interface and cashier workflows, but deliver them as a browser-only React 19 + TypeScript + Vite single-page application. Do not call an application API, authentication endpoint, external service, or server-side database. Run all catalog, checkout, supplier, return, reporting, and store-settings actions in the browser. Persist demo/business data in this browser's `localStorage` so a refresh keeps changes; data will not sync to other browsers or devices. Do not modify or delete any existing managed-database contents.

Replace tRPC query/mutation hooks with a frontend retail store module that owns typed browser-local records and notifies React subscribers after each local operation. Keep monetary arithmetic in integer paise. Preserve unique barcode generation, discounts, split-tender validation, invoice details, receipt and report exports, returns, and tracked-stock updates. Keep data empty by default rather than inventing sales or customer records.

### Main workflows

- **POS:** keyboard-wedge barcode entry, product search, duplicate-scan quantity increment, cart editing, selected-product and whole-bill discounts, customer lookup/details, multiple payment tenders, due/change display, local checkout, and invoice/receipt details.
- **Products/import:** create/edit/delete and filter/search; generate unique numeric barcodes; select supplier codes; download a template; parse `.xlsx`/`.xls` in the browser; preview/validate rows; locally add valid products.
- **Suppliers:** create/edit/delete suppliers and their multiple supplier codes, stored only in browser data.
- **Returns:** locate a local invoice; enforce unreturned-quantity limits; capture reason/refund method; record refunds locally; adjust tracked stock and local reports.
- **Reports/receipts:** date filters, sales KPIs/table, purchase details, A4/thermal print styling, receipt PDF, and date-filtered PDF/Excel/CSV export, all derived from local records.
- **Settings:** store name/address/phone/email stored in browser and shown in the shell/receipts.

### Local-data boundary

`localStorage` is device/browser/profile scoped; it is not an authenticated or shared source of truth. Clearing site data removes the local records. If storage is blocked, unreadable, or full, keep the current tab usable but show a persistent warning that changes may not survive reload; do not claim the changes are durably saved. Existing data in the project's already provisioned managed database is outside the frontend-only app and remains untouched; it will not appear in localStorage automatically. The project platform enabled the managed Server and Database capabilities at creation and declares capability enablement one-way, so those platform capability flags cannot be switched off even though the application source and static deployment no longer use them.

## Visual and interaction direction

- **Design movement:** premium retail operations console—quiet editorial polish around a dense, practical point-of-sale workspace.
- **Core principles:** cashier-first speed; readable information hierarchy; restrained fashion-brand character; accessible controls and responsive behavior.
- **Color philosophy:** blue-and-white surfaces signal dependable, quick financial actions; cool slate neutrals keep product and report tables calm. Use the supplied values `#2563EB`, `#1E3A8A`, `#EFF6FF`, `#F8FAFC`, `#0F172A`, `#64748B`, `#16A34A`, `#DC2626`, and `#E2E8F0`, with the reference-inspired navy sidebar and pale-blue workspace.
- **Layout paradigm:** compact navy left navigation rail and broad work canvas. The POS shows four live local-data cards—Today's Sales, Today's Bills, Today's Revenue, and Total Products—above the scanner, then a cart and bill-summary workspace; stack controls on small screens.
- **Signature elements:** garment-tag mark; blue scan/focus affordance; crisp numeric totals aligned in the payment summary.
- **Interaction philosophy:** keep the scanner ready, surface local save feedback, validate next to fields, preserve active cart while navigating, and confirm consequential local actions.
- **Animation:** short 140–180 ms hover/focus/row/modal transitions; restrained success feedback; honor reduced motion and never delay payment.
- **Typography:** system sans-serif fallbacks and tabular numerals for prices/quantities; no remote font requests.
- **Brand essence:** “A faster, clearer checkout and stock desk for independent fashion retailers”; precise, composed, helpful.
- **Brand voice:** concise and reassuring. Examples: “Ready for the next scan.” and “Payment complete — receipt is ready.”
- **Wordmark/logo:** compact garment-tag mark with barcode detail beside StylePOS.
- **Signature brand color:** primary blue `#2563EB`.

## Frontend project structure

- `client/src/pages/` — POS, Products, Suppliers, Returns, Reports, Purchase Details, Settings.
- `client/src/components/` — shared shell/navigation, dialogs, tables, feedback, checkout and receipt UI.
- `client/src/lib/retail.ts` — currency, discount, barcode, invoice, and return arithmetic.
- `client/src/lib/retailStore.ts` — typed localStorage-backed entities and local CRUD, checkout, returns, reports, and settings operations.
- `client/src/lib/retailTypes.ts` — frontend-only record contracts.
- `client/public/manus-routes.json` — synchronized page-route manifest.
- `vite.config.ts` — frontend-only Vite development and static build configuration.

There is no application `server/`, `drizzle/`, backend `shared/`, authentication SDK, API client, database migration, container entrypoint, or server deployment requirement in the intended source tree.

## Dependencies and delivery boundaries

Keep only the React/Vite/UI and browser-side spreadsheet/PDF dependencies required by the frontend. Remove tRPC, Express, Drizzle/MySQL, OAuth/session code, server helpers, database scripts, private API/DB configuration injection, and development API logging middleware. Remove third-party network requests from app runtime (including the unused map integration and remote font import); fonts use local system fallbacks. Do not include private credentials in client assets.

Run local development with Vite (`pnpm dev:static`) and create static output with `pnpm build:static`. Configure the WebDev project for `build` from a self-contained install/build command with output directory `dist/public`, and remove the `deploy` declaration/Dockerfile. Do not request publication; auto-publish stays disabled.

## Build workflow

Update this plan and the project TODO before implementation, then replace all page API hooks with local-store actions, remove unused backend/auth/service integrations and backend packages/files, update static scripts and project configuration, and preserve the page-route manifest. Verify no frontend API/network calls remain, test local persistence and retail arithmetic, run TypeScript/tests/static build, and verify Preview plus `/manus-routes.json`. Save the change on canonical `main`; do not delete existing managed database records or claim its one-way platform capabilities have been disabled.
- **Typography:** system sans-serif fallbacks and tabular numerals for prices/quantities; no remote font requests.

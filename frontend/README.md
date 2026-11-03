# StylePOS — frontend-only POS

StylePOS is a static React/Vite point-of-sale interface. It has no application server, API, login, external service integration, or database connection. Catalog, customers, suppliers, invoices, returns, inventory counts, and receipt settings are stored in the current browser profile using `localStorage`.

## Development

- `pnpm dev` — run Vite on port 3000 (or `PORT` when supplied).
- `pnpm check` — TypeScript diagnostics.
- `pnpm test` — local store and retail arithmetic tests.
- `pnpm build` — produce the static site in `dist/public/`.
- `pnpm preview` — serve the production build locally.

## Data boundary

Browser data is local to this browser/profile and does not synchronize between users or devices. Clearing browser/site data removes it. Existing records in the project's previously provisioned managed database are not read, imported, or deleted by this frontend-only app.

## Static deployment

The application is built as static files from `client/` by Vite. No Dockerfile, server entrypoint, API route, authentication configuration, or database migration is required by the app.

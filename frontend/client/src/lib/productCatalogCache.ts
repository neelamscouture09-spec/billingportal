// frontend/client/src/lib/productCatalogCache.ts
// Shared across page navigations in this browser tab; hard reload starts fresh.
// Explicit refresh is the only normal catalog-network reload during navigation.
let cached: unknown[] | null = null;
let inFlight: Promise<unknown[]> | null = null;
let generation = 0;
export function invalidateProductCache() { generation++; cached = null; inFlight = null; }
export async function loadProductCatalog<T>(url: string, force = false): Promise<T[]> {
  if (force) invalidateProductCache();
  if (cached) return cached as T[];
  if (inFlight) return inFlight as Promise<T[]>;
  const current = generation;
  inFlight = (async () => {
    const response = await fetch(url, { cache: "no-store", credentials: "omit" });
    const body = await response.json();
    if (!response.ok || body.success === false || !Array.isArray(body.products))
      throw new Error(body.error || "Product catalogue unavailable");
    const rows: unknown[] = body.products;
    if (current === generation) cached = rows;
    return rows;
  })();
  try { return await inFlight as T[]; }
  finally { if (current === generation) inFlight = null; }
}

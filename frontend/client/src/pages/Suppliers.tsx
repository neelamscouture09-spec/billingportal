
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";

import type { FormEvent, CSSProperties } from "react";

import {
  Building2,
  Code2,
  Edit3,
  Hash,
  Plus,
  Trash2,
  Truck,
  Search,
  RefreshCw,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";

import { toast } from "sonner";

import RetailLayout from "@/components/RetailLayout";

import {
  ActionDialog,
  ConfirmAction,
} from "@/components/ActionDialog";

// ============================================================
// API CONFIGURATION
// All frontend API methods are defined in this file.
// ============================================================

// Set VITE_API_BASE_URL in .env when backend is separate.
// Example:
// VITE_API_BASE_URL=http://localhost:3000

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001"
).replace(/\/$/, "");

// ============================================================
// TYPES
// ============================================================

interface SupplierCode {
  id: string;
  code: string;
  supplierId: string;
  createdAt: string;
  updatedAt: string;
}

interface Supplier {
  id: string;
  name: string;
  codes: SupplierCode[];
  createdAt: string;
  updatedAt: string;
}

interface SuppliersResponse {
  success: boolean;
  suppliers: Supplier[];
  count: number;
  totalCodes: number;
}

interface SupplierResponse {
  success: boolean;
  supplier: Supplier;
  message?: string;
}

interface CodeResponse {
  success: boolean;
  supplierCode: SupplierCode;
  message?: string;
}

interface DeleteResponse {
  success: boolean;
  message: string;
}

type ModalType = "supplier" | "code" | null;

interface DeleteTarget {
  kind: "supplier" | "code";
  id: string;
  supplierId?: string;
  label: string;
}

// ============================================================
// COMMON API REQUEST FUNCTION
// ============================================================

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    `${API_BASE_URL}${endpoint}`,
    {
      ...options,
      method: options.method || "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    }
  );

  let result: {
    success?: boolean;
    error?: string;
    message?: string;
    [key: string]: unknown;
  };

  try {
    result = await response.json();
  } catch {
    throw new Error(
      `Invalid server response (${response.status}).`
    );
  }

  if (!response.ok || result.success === false) {
    throw new Error(
      result.error ||
        result.message ||
        `Request failed (${response.status}).`
    );
  }

  return result as T;
}

// ============================================================
// SUPPLIER API FUNCTIONS
// ============================================================

// GET - ALL SUPPLIERS AND CODES

async function fetchAllSuppliers(): Promise<Supplier[]> {
  const response = await apiRequest<SuppliersResponse>(
    "/api/suppliers"
  );

  if (!Array.isArray(response.suppliers)) {
    throw new Error("Invalid suppliers response.");
  }

  return response.suppliers;
}

// GET - SINGLE SUPPLIER

async function fetchSupplier(
  supplierId: string
): Promise<Supplier> {
  const response = await apiRequest<SupplierResponse>(
    `/api/suppliers/${encodeURIComponent(supplierId)}`
  );

  return response.supplier;
}

// POST - CREATE SUPPLIER

async function createSupplier(
  name: string
): Promise<Supplier> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Supplier name is required.");
  }

  if (trimmedName.length > 180) {
    throw new Error(
      "Supplier name must be 180 characters or less."
    );
  }

  const response = await apiRequest<SupplierResponse>(
    "/api/suppliers",
    {
      method: "POST",
      body: JSON.stringify({
        name: trimmedName,
      }),
    }
  );

  return response.supplier;
}

// PATCH - UPDATE SUPPLIER

async function updateSupplier(
  supplierId: string,
  name: string
): Promise<Supplier> {
  if (!supplierId) {
    throw new Error("Supplier ID is required.");
  }

  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Supplier name is required.");
  }

  const response = await apiRequest<SupplierResponse>(
    `/api/suppliers/${encodeURIComponent(supplierId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: trimmedName,
      }),
    }
  );

  return response.supplier;
}

// DELETE - SUPPLIER

async function deleteSupplier(
  supplierId: string
): Promise<DeleteResponse> {
  return apiRequest<DeleteResponse>(
    `/api/suppliers/${encodeURIComponent(supplierId)}`,
    {
      method: "DELETE",
    }
  );
}

// ============================================================
// SUPPLIER CODE API FUNCTIONS
// ============================================================

// POST - CREATE CODE

async function createSupplierCode(
  supplierId: string,
  code: string
): Promise<SupplierCode> {
  const trimmedCode = code.trim().toUpperCase();

  if (!supplierId) {
    throw new Error("Supplier ID is required.");
  }

  if (!trimmedCode) {
    throw new Error("Supplier code is required.");
  }

  if (trimmedCode.length > 80) {
    throw new Error(
      "Supplier code must be 80 characters or less."
    );
  }

  const response = await apiRequest<CodeResponse>(
    `/api/suppliers/${encodeURIComponent(supplierId)}/codes`,
    {
      method: "POST",
      body: JSON.stringify({
        code: trimmedCode,
      }),
    }
  );

  return response.supplierCode;
}

// PATCH - UPDATE CODE

async function updateSupplierCode(
  supplierId: string,
  codeId: string,
  code: string
): Promise<SupplierCode> {
  const trimmedCode = code.trim().toUpperCase();

  if (!supplierId || !codeId) {
    throw new Error(
      "Supplier ID and code ID are required."
    );
  }

  if (!trimmedCode) {
    throw new Error("Supplier code is required.");
  }

  if (trimmedCode.length > 80) {
    throw new Error(
      "Supplier code must be 80 characters or less."
    );
  }

  const response = await apiRequest<CodeResponse>(
    `/api/suppliers/${encodeURIComponent(supplierId)}/codes/${encodeURIComponent(codeId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        code: trimmedCode,
      }),
    }
  );

  return response.supplierCode;
}

// DELETE - CODE

async function deleteSupplierCode(
  supplierId: string,
  codeId: string
): Promise<DeleteResponse> {
  if (!supplierId || !codeId) {
    throw new Error(
      "Supplier ID and code ID are required."
    );
  }

  return apiRequest<DeleteResponse>(
    `/api/suppliers/${encodeURIComponent(supplierId)}/codes/${encodeURIComponent(codeId)}`,
    {
      method: "DELETE",
    }
  );
}

// ============================================================
// HELPERS
// ============================================================

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ============================================================
// SKELETON COMPONENT
// ============================================================

function Skeleton({
  width = "100%",
  height = 14,
}: {
  width?: string | number;
  height?: number;
}) {
  return (
    <div
      className="animate-pulse"
      style={{
        height,
        width,
        borderRadius: 7,
        backgroundColor: "#e5edf8",
      }}
    />
  );
}

// ============================================================
// SUPPLIER STATS SKELETON
// ============================================================

function SupplierStatsSkeleton() {
  return (
    <div className="supplier-stat-row">
      {[0, 1].map(index => (
        <div className="supplier-stat" key={index}>
          <div className="section-icon">
            <Skeleton width={18} height={18} />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
          >
            <Skeleton width={90} height={10} />
            <Skeleton width={40} height={22} />
          </div>
        </div>
      ))}

      <div className="supplier-stat supplier-stat-note">
        <Skeleton width={18} height={18} />
        <Skeleton width="65%" height={12} />
      </div>
    </div>
  );
}

// ============================================================
// SUPPLIER TABLE SKELETON
// ============================================================

function SupplierTableSkeleton() {
  return (
    <section className="panel data-panel">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>SUPPLIER</th>
              <th>NUMBER OF CODES</th>
              <th>CREATED DATE</th>
              <th>CODE MANAGEMENT</th>
              <th>ACTIONS</th>
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: 5 }).map(
              (_, index) => (
                <tr key={index}>
                  <td>
                    <Skeleton width={155} height={17} />
                  </td>

                  <td>
                    <Skeleton width={75} height={24} />
                  </td>

                  <td>
                    <Skeleton width={95} height={14} />
                  </td>

                  <td>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      <Skeleton width={85} height={25} />
                      <Skeleton width={95} height={25} />
                    </div>
                  </td>

                  <td>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      <Skeleton width={30} height={30} />
                      <Skeleton width={30} height={30} />
                      <Skeleton width={30} height={30} />
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================================================
// MAIN SUPPLIERS COMPONENT
// ============================================================

export default function Suppliers() {
  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [pending, setPending] = useState(false);

  const [loadError, setLoadError] = useState<
    string | null
  >(null);

  const [query, setQuery] = useState("");

  const [modal, setModal] = useState<ModalType>(null);

  const [activeSupplierId, setActiveSupplierId] =
    useState<string | null>(null);

  const [name, setName] = useState("");

  const [code, setCode] = useState("");

  const [editingCodeId, setEditingCodeId] =
    useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<DeleteTarget | null>(null);

  // ----------------------------------------------------------
  // FETCH SUPPLIERS
  // ----------------------------------------------------------

  const loadSuppliers = useCallback(
    async (showSkeleton = false) => {
      if (showSkeleton) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setLoadError(null);

      try {
        const data = await fetchAllSuppliers();

        setSuppliers(data);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load suppliers.";

        setLoadError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadSuppliers(true);
  }, [loadSuppliers]);

  // ----------------------------------------------------------
  // MEMOIZED STATISTICS
  // ----------------------------------------------------------

  const totalSuppliers = useMemo(
    () => suppliers.length,
    [suppliers]
  );

  const totalCodes = useMemo(
    () =>
      suppliers.reduce(
        (sum, supplier) =>
          sum + supplier.codes.length,
        0
      ),
    [suppliers]
  );

  // ----------------------------------------------------------
  // MEMOIZED SEARCH
  // ----------------------------------------------------------

  const filteredSuppliers = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return suppliers;
    }

    return suppliers.filter(supplier => {
      const matchesName = supplier.name
        .toLowerCase()
        .includes(search);

      const matchesCode = supplier.codes.some(item =>
        item.code.toLowerCase().includes(search)
      );

      return matchesName || matchesCode;
    });
  }, [suppliers, query]);

  // ----------------------------------------------------------
  // MEMOIZED ACTIVE SUPPLIER
  // ----------------------------------------------------------

  const activeSupplier = useMemo(
    () =>
      suppliers.find(
        supplier => supplier.id === activeSupplierId
      ) ?? null,
    [suppliers, activeSupplierId]
  );

  // ----------------------------------------------------------
  // MODAL HELPERS
  // ----------------------------------------------------------

  function closeModal() {
    if (pending) return;

    setModal(null);
    setActiveSupplierId(null);
    setName("");
    setCode("");
    setEditingCodeId(null);
  }

  function openSupplier(supplier?: Supplier) {
    setActiveSupplierId(supplier?.id ?? null);
    setName(supplier?.name ?? "");
    setCode("");
    setEditingCodeId(null);
    setModal("supplier");
  }

  function openCode(
    supplier: Supplier,
    existing?: SupplierCode
  ) {
    setActiveSupplierId(supplier.id);
    setEditingCodeId(existing?.id ?? null);
    setCode(existing?.code ?? "");
    setModal("code");
  }

  // ----------------------------------------------------------
  // SAVE SUPPLIER
  // ----------------------------------------------------------

  async function saveSupplier(event: FormEvent) {
    event.preventDefault();

    if (pending) return;

    const trimmedName = name.trim();

    if (!trimmedName) {
      toast.error("Supplier name is required.");
      return;
    }

    setPending(true);

    try {
      if (activeSupplierId) {
        await updateSupplier(
          activeSupplierId,
          trimmedName
        );

        toast.success("Supplier updated successfully.");
      } else {
        await createSupplier(trimmedName);

        toast.success("Supplier created successfully.");
      }

      setModal(null);
      setName("");
      setActiveSupplierId(null);

      await loadSuppliers();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save supplier."
      );
    } finally {
      setPending(false);
    }
  }

  // ----------------------------------------------------------
  // SAVE SUPPLIER CODE
  // ----------------------------------------------------------

  async function saveCode(event: FormEvent) {
    event.preventDefault();

    if (!activeSupplierId || pending) return;

    const trimmedCode = code.trim().toUpperCase();

    if (!trimmedCode) {
      toast.error("Supplier code is required.");
      return;
    }

    setPending(true);

    try {
      if (editingCodeId) {
        await updateSupplierCode(
          activeSupplierId,
          editingCodeId,
          trimmedCode
        );

        toast.success("Supplier code updated.");
      } else {
        await createSupplierCode(
          activeSupplierId,
          trimmedCode
        );

        toast.success("Supplier code created.");
      }

      setEditingCodeId(null);
      setCode("");

      await loadSuppliers();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save supplier code."
      );
    } finally {
      setPending(false);
    }
  }

  // ----------------------------------------------------------
  // DELETE SUPPLIER / SUPPLIER CODE
  // ----------------------------------------------------------

  async function confirmDelete() {
    if (!deleteTarget || pending) return;

    setPending(true);

    try {
      if (deleteTarget.kind === "supplier") {
        await deleteSupplier(deleteTarget.id);

        toast.success("Supplier deleted successfully.");
      } else {
        if (!deleteTarget.supplierId) {
          throw new Error("Supplier ID missing.");
        }

        await deleteSupplierCode(
          deleteTarget.supplierId,
          deleteTarget.id
        );

        toast.success(
          "Supplier code deleted successfully."
        );

        if (editingCodeId === deleteTarget.id) {
          setEditingCodeId(null);
          setCode("");
        }
      }

      setDeleteTarget(null);

      await loadSuppliers();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete item."
      );
    } finally {
      setPending(false);
    }
  }

  // ----------------------------------------------------------
  // COMPONENT UI
  // ----------------------------------------------------------

  return (
    <RetailLayout>
      {/* ==================================================== */}
      {/* PAGE HEADER */}
      {/* ==================================================== */}

      <div className="page-heading">
        <div>
          <div className="eyebrow">PARTNERS</div>

          <h1>Suppliers</h1>

          <p>
            Organize suppliers and the codes attached
            to their products.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn-outline"
            onClick={() => void loadSuppliers()}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={15}
              className={
                refreshing ? "animate-spin" : ""
              }
            />

            Refresh
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={() => openSupplier()}
          >
            <Plus size={15} />
            New supplier
          </button>
        </div>
      </div>

      {/* ==================================================== */}
      {/* SUPPLIER STATISTICS */}
      {/* ==================================================== */}

      {loading ? (
        <SupplierStatsSkeleton />
      ) : (
        <div className="supplier-stat-row">
          <div className="supplier-stat">
            <div className="section-icon">
              <Building2 size={17} />
            </div>

            <div>
              <span>SUPPLIERS</span>
              <strong>{totalSuppliers}</strong>
            </div>
          </div>

          <div className="supplier-stat">
            <div className="section-icon pale-icon">
              <Hash size={17} />
            </div>

            <div>
              <span>SUPPLIER CODES</span>
              <strong>{totalCodes}</strong>
            </div>
          </div>

          <div className="supplier-stat supplier-stat-note">
            <Truck size={15} />

            <span>
              Supplier codes appear while adding products.
            </span>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* SEARCH */}
      {/* ==================================================== */}

      {!loading && !loadError && totalSuppliers > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            padding: "12px 16px",
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 13,
          }}
        >
          <Search size={17} color="#94a3b8" />

          <input
            type="text"
            placeholder="Search supplier name or supplier code..."
            value={query}
            onChange={event =>
              setQuery(event.target.value)
            }
            style={{
              flex: 1,
              minWidth: 0,
              outline: "none",
              border: "none",
              background: "transparent",
              fontSize: 13,
            }}
          />

          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
              title="Clear search"
            >
              <X size={15} color="#64748b" />
            </button>
          )}

          <span
            style={{
              color: "#64748b",
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
          >
            {filteredSuppliers.length} results
          </span>
        </div>
      )}

      {/* ==================================================== */}
      {/* LOADING SKELETON */}
      {/* ==================================================== */}

      {loading && <SupplierTableSkeleton />}

      {/* ==================================================== */}
      {/* ERROR STATE */}
      {/* ==================================================== */}

      {!loading && loadError && (
        <section
          className="panel"
          style={{
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <AlertCircle
            size={28}
            color="#dc2626"
            style={{
              margin: "0 auto 12px",
            }}
          />

          <h3>Unable to load suppliers</h3>

          <p
            style={{
              color: "#64748b",
              margin: "8px 0 16px",
            }}
          >
            {loadError}
          </p>

          <button
            type="button"
            className="btn-primary"
            onClick={() => void loadSuppliers(true)}
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </section>
      )}

      {/* ==================================================== */}
      {/* SUPPLIER TABLE */}
      {/* ==================================================== */}

      {!loading && !loadError && (
        <section className="panel data-panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SUPPLIER</th>

                  <th>NUMBER OF CODES</th>

                  <th>CREATED DATE</th>

                  <th>CODE MANAGEMENT</th>

                  <th>ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {filteredSuppliers.map(supplier => (
                  <tr key={supplier.id}>
                    {/* SUPPLIER NAME */}

                    <td>
                      <span className="table-primary">
                        <span className="supplier-avatar">
                          <Building2 size={15} />
                        </span>

                        {supplier.name}
                      </span>
                    </td>

                    {/* CODE COUNT */}

                    <td>
                      <span className="badge badge-blue">
                        {supplier.codes.length}{" "}
                        {supplier.codes.length === 1
                          ? "code"
                          : "codes"}
                      </span>
                    </td>

                    {/* CREATED DATE */}

                    <td>
                      {formatDate(supplier.createdAt)}
                    </td>

                    {/* SUPPLIER CODES */}

                    <td>
                      <div className="supplier-codes">
                        {supplier.codes
                          .slice(0, 3)
                          .map(item => (
                            <button
                              type="button"
                              className="code-pill"
                              key={item.id}
                              title="Edit supplier code"
                              onClick={() =>
                                openCode(supplier, item)
                              }
                            >
                              <Code2 size={11} />

                              {item.code}
                            </button>
                          ))}

                        {supplier.codes.length > 3 && (
                          <button
                            type="button"
                            className="code-more"
                            onClick={() =>
                              openCode(supplier)
                            }
                          >
                            +
                            {supplier.codes.length - 3}
                          </button>
                        )}

                        <button
                          type="button"
                          className="add-code-mini"
                          onClick={() =>
                            openCode(supplier)
                          }
                        >
                          <Plus size={12} />

                          Create code
                        </button>
                      </div>
                    </td>

                    {/* ACTIONS */}

                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="row-action"
                          title="Manage supplier codes"
                          aria-label={`Manage ${supplier.name} codes`}
                          onClick={() =>
                            openCode(supplier)
                          }
                        >
                          <Code2 size={14} />
                        </button>

                        <button
                          type="button"
                          className="row-action"
                          title="Edit supplier"
                          aria-label={`Edit ${supplier.name}`}
                          onClick={() =>
                            openSupplier(supplier)
                          }
                        >
                          <Edit3 size={14} />
                        </button>

                        <button
                          type="button"
                          className="row-action danger"
                          title="Delete supplier"
                          aria-label={`Delete ${supplier.name}`}
                          onClick={() =>
                            setDeleteTarget({
                              kind: "supplier",
                              id: supplier.id,
                              label: supplier.name,
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* EMPTY STATE */}

          {suppliers.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Truck size={21} />
              </div>

              <h3>No suppliers added yet.</h3>

              <p>
                Add a supplier to organize product codes.
              </p>

              <button
                type="button"
                className="btn-primary"
                onClick={() => openSupplier()}
              >
                <Plus size={14} />
                Create supplier
              </button>
            </div>
          )}

          {/* NO SEARCH MATCHES */}

          {suppliers.length > 0 &&
            filteredSuppliers.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Search size={21} />
                </div>

                <h3>No matching suppliers</h3>

                <p>
                  Try a different supplier name or code.
                </p>

                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setQuery("")}
                >
                  Clear search
                </button>
              </div>
            )}
        </section>
      )}

      {/* ==================================================== */}
      {/* SUPPLIER CREATE / EDIT MODAL */}
      {/* ==================================================== */}

      {modal === "supplier" && (
        <ActionDialog
          title={
            activeSupplierId
              ? "Edit supplier"
              : "New supplier"
          }
          description="Supplier names help group their product codes."
          onClose={closeModal}
        >
          <form
            className="modal-body"
            onSubmit={saveSupplier}
          >
            <label className="field">
              <span>SUPPLIER NAME</span>

              <input
                required
                maxLength={180}
                value={name}
                disabled={pending}
                onChange={event =>
                  setName(event.target.value)
                }
                placeholder="e.g. ABC Textiles"
                autoFocus
              />
            </label>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                disabled={pending}
                onClick={closeModal}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="btn-primary"
                disabled={
                  pending || !name.trim()
                }
              >
                {pending && (
                  <Loader2
                    size={14}
                    className="animate-spin"
                  />
                )}

                {pending
                  ? "Saving..."
                  : activeSupplierId
                    ? "Save changes"
                    : "Create supplier"}
              </button>
            </div>
          </form>
        </ActionDialog>
      )}

      {/* ==================================================== */}
      {/* SUPPLIER CODE CREATE / EDIT MODAL */}
      {/* ==================================================== */}

      {modal === "code" && activeSupplier && (
        <ActionDialog
          title={
            editingCodeId
              ? "Edit supplier code"
              : "Manage supplier codes"
          }
          description={activeSupplier.name}
          onClose={closeModal}
        >
          <form
            className="modal-body"
            onSubmit={saveCode}
          >
            <label className="field">
              <span>SUPPLIER CODE</span>

              <input
                required
                maxLength={80}
                value={code}
                disabled={pending}
                onChange={event =>
                  setCode(
                    event.target.value.toUpperCase()
                  )
                }
                placeholder="e.g. ABC005"
                autoFocus
              />
            </label>

            {/* EXISTING CODES */}

            {activeSupplier.codes.length > 0 && (
              <div className="code-manager">
                <span>
                  EXISTING CODES (
                  {activeSupplier.codes.length})
                </span>

                <div>
                  {activeSupplier.codes.map(item => (
                    <div
                      className="code-manager-row"
                      key={item.id}
                    >
                      <span>
                        <Code2 size={13} />

                        {item.code}
                      </span>

                      <div>
                        <button
                          type="button"
                          className="row-action"
                          aria-label={`Edit ${item.code}`}
                          disabled={pending}
                          onClick={() => {
                            setEditingCodeId(item.id);
                            setCode(item.code);
                          }}
                        >
                          <Edit3 size={13} />
                        </button>

                        <button
                          type="button"
                          className="row-action danger"
                          aria-label={`Delete ${item.code}`}
                          disabled={pending}
                          onClick={() =>
                            setDeleteTarget({
                              kind: "code",
                              id: item.id,
                              supplierId: activeSupplier.id,
                              label: item.code,
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FOOTER */}

            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                disabled={pending}
                onClick={closeModal}
              >
                Close
              </button>

              {editingCodeId && (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={pending}
                  onClick={() => {
                    setEditingCodeId(null);
                    setCode("");
                  }}
                >
                  New code
                </button>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={
                  pending || !code.trim()
                }
              >
                {pending && (
                  <Loader2
                    size={14}
                    className="animate-spin"
                  />
                )}

                {pending
                  ? "Saving..."
                  : editingCodeId
                    ? "Save code"
                    : "Create code"}
              </button>
            </div>
          </form>
        </ActionDialog>
      )}

      {/* ==================================================== */}
      {/* DELETE CONFIRMATION */}
      {/* ==================================================== */}

      {deleteTarget && (
        <ActionDialog
          title={
            deleteTarget.kind === "supplier"
              ? "Delete supplier?"
              : "Delete supplier code?"
          }
          onClose={() => {
            if (!pending) {
              setDeleteTarget(null);
            }
          }}
        >
          <ConfirmAction
            description={`Are you sure you want to delete “${deleteTarget.label}”? Supplier codes linked to existing products cannot be deleted until those products are reassigned.`}
            confirmLabel="Delete"
            danger
            pending={pending}
            onCancel={() => {
              if (!pending) {
                setDeleteTarget(null);
              }
            }}
            onConfirm={confirmDelete}
          />
        </ActionDialog>
      )}
    </RetailLayout>
  );
}

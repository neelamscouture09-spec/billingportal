import {

  useCallback,

  useEffect,

  useMemo,

  useRef,

  useState,

  type FormEvent,

} from "react";

import {

  Barcode,

  Check,

  Download,

  Edit3,

  FileSpreadsheet,

  Filter,

  Loader2,

  Minus,

  Package,

  Plus,

  Printer,

  RefreshCw,

  Search,

  Trash2,

  Upload,

  X,

} from "lucide-react";

import { toast } from "sonner";

import RetailLayout from "@/components/RetailLayout";

import {

  ActionDialog,

  ConfirmAction,

} from "@/components/ActionDialog";

import qz from "qz-tray";



import { formatINR, toPaise } from "@/lib/retail";

const API_BASE_URL = (

  import.meta.env.VITE_API_BASE_URL || "http\://localhost:3001"

).replace(/\/+$/, "");

const PRODUCT_API = `${API_BASE_URL}/api/products`;

const CACHE_KEY = "neelam-products-cache-v3-suppliers";

const MAX_IMPORT_ROWS = 1000;

const MAX_IMPORT_SIZE = 5 * 1024 * 1024;

const sizes = ["S", "M", "L", "XL", "XXL"];

const EXCEL_HEADERS = [

  "name", "size", "supplierName", "supplierCode", "sellingPrice", "openingStock",

] as const;

type SupplierCode = { id: string; code: string; supplierId: string };

type Supplier = { id: string; name: string; codes: SupplierCode[] };

type SupplierResponse = ApiResponse<{ suppliers: Supplier[] }>;

type Product = {

  id: string;

  name: string;

  size: string;

  supplierCodeId?: string | null;

  supplierCode?: { id: string; code: string; supplier?: { id: string; name: string } } | string | null;

  supplierName?: string | null;

  sellingPrice: string;

  barcode: string;

  openingStock: number | null;

  sold: boolean;

  createdAt: string;

  updatedAt: string;

};

type ProductForm = {

  name: string;

  size: string;

  supplierCodeId: string;

  price: string;

  onHand: string;

};

type ImportRow = {

  sourceRow: number;

  name: string;

  size: string;

  supplierName: string;

  supplierCode: string;

  sellingPrice: string;

  openingStock: string;

  pricePaise: number;

  error?: string;

};

type PrintQueueItem = {

  id: string;

  product: Product;

  copies: number;

};

type ApiResponse<T = unknown> = {

  success: boolean;

  message?: string;

  error?: string;

  details?: unknown;

} & T;

type ProductsResponse = ApiResponse<{

  products: Product[];

  count: number;

}>;

type ImportResponse = ApiResponse<{

  totalRows?: number;

  importedCount?: number;

  failedCount?: number;

  firstBarcode?: string;

  lastBarcode?: string;

  suppliers?: { created: number; reused: number };

  supplierCodes?: { created: number; reused: number };

  linkedProducts?: number;

  errors?: Array<{

    row: number;

    field: string;

    message: string;

  }>;

}>;

function getSupplierDetails(product: Product, suppliers: Supplier[] = []) {

  if (product.supplierCode && typeof product.supplierCode === "object") {

    return {

      code: product.supplierCode.code,

      name: product.supplierCode.supplier?.name ?? product.supplierName ?? "",

      id: product.supplierCode.id,

    };

  }

  const linked = suppliers.flatMap(supplier =>

    supplier.codes.map(code => ({ ...code, supplierName: supplier.name }))

  ).find(code => code.id === product.supplierCodeId);

  return {

    code: linked?.code ?? (typeof product.supplierCode === "string" ? product.supplierCode : ""),

    name: linked?.supplierName ?? product.supplierName ?? "",

    id: product.supplierCodeId ?? linked?.id ?? "",

  };

}

async function fetchSuppliers(): Promise<Supplier[]> {

  const response = await fetch(`${API_BASE_URL}/api/suppliers`, { cache: "no-store" });

  const data: SupplierResponse = await response.json();

  if (!response.ok || data.success === false || !Array.isArray(data.suppliers)) {

    throw new Error(data.error || "Could not load suppliers");

  }

  return data.suppliers;

}

function blankForm(): ProductForm {

  return {

    name: "",

    size: "M",

    supplierCodeId: "",


    price: "",

    onHand: "",

  };

}

function readProductCache(): Product[] | null {

  try {

    const raw = localStorage.getItem(CACHE_KEY);

    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) return null;

    return parsed as Product[];

  } catch {

    return null;

  }

}

function saveProductCache(products: Product[]) {

  try {

    localStorage.setItem(CACHE_KEY, JSON.stringify(products));

  } catch {

    //

  }

}

async function apiRequest<T>(

  path: string,

  options: RequestInit = {}

): Promise<T> {

  let response: Response;

  try {

    response = await fetch(`${PRODUCT_API}${path}`, {

      ...options,

      headers: {

        ...(options.body instanceof FormData

          ? {}

          : { "Content-Type": "application/json" }),

        ...options.headers,

      },

      cache: "no-store",

    });

  } catch {

    throw new Error(

      "Unable to connect to backend. Check if backend is running."

    );

  }

  let result: ApiResponse<T>;

  try {

    result = await response.json();

  } catch {

    throw new Error(`Invalid backend response (${response.status})`);

  }

  if (!response.ok || result.success === false) {

    const details = result as ApiResponse & {

      errors?: Array<{

        row: number;

        field: string;

        message: string;

      }>;

    };

    const firstError = details.errors?.[0];

    throw new Error(

      firstError

        ? `Excel row ${firstError.row}: ${firstError.message}`

        : result.error || result.message || `Request failed (${response.status})`

    );

  }

  return result as T;

}

function TableSkeleton() {

  return (

    <tbody aria-busy="true">

      {Array.from({ length: 7 }).map((_, index) => (

        <tr key={index}>

          {Array.from({ length: 9 }).map((__, cell) => (

            <td key={cell}>

              <div

                className="animate-pulse rounded-md bg-slate-200/70"

                style={{

                  height: 16,

                  width:

                    cell === 0

                      ? "20px"

                      : cell === 1

                        ? "140px"

                        : cell === 8

                          ? "80px"

                          : `${55 + ((index + cell) % 4) * 16}px`,

                  maxWidth: "100%",

                }}

              />

            </td>

          ))}

        </tr>

      ))}

    </tbody>

  );

}

function escapeHtml(value: string) {

  return value

    .replaceAll("&", "&amp;")

    .replaceAll("<", "&lt;")

    .replaceAll(">", "&gt;")

    .replaceAll('"', "&quot;")

    .replaceAll("'", "&#039;");

}

async function generateBarcodeSvg(barcode: string) {

  const mod = await import("jsbarcode");

  const JsBarcode = mod.default ?? mod;

  const svg = document.createElementNS("http\://www.w3.org/2000/svg", "svg");

  JsBarcode(svg, barcode, {

    format: "CODE128",

    displayValue: false,

    margin: 0,

    width: 1.2,

    height: 38,

    background: "#ffffff",

  });

  return new XMLSerializer().serializeToString(svg);

}

export default function Products() {

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [suppliersLoading, setSuppliersLoading] = useState(true);

  const [supplierLoadError, setSupplierLoadError] = useState<string | null>(null);

  const refreshSuppliers = useCallback(async () => {

    setSuppliersLoading(true);

    setSupplierLoadError(null);

    try {

      setSuppliers(await fetchSuppliers());

    } catch (error) {

      setSupplierLoadError(error instanceof Error ? error.message : "Failed to load suppliers");

    } finally {

      setSuppliersLoading(false);

    }

  }, []);

  useEffect(() => { void refreshSuppliers(); }, [refreshSuppliers]);

  const supplierOptions = useMemo(() => suppliers.flatMap(supplier =>

    supplier.codes.map(item => ({

      id: item.id, code: item.code, supplierId: supplier.id, supplierName: supplier.name,

    }))

  ), [suppliers]);

  const initialCache = useRef<Product[] | null>(readProductCache());

  const [products, setProducts] = useState<Product[]>(

    initialCache.current ?? []

  );

  const [loading, setLoading] = useState(initialCache.current === null);

  const [refreshing, setRefreshing] = useState(false);

  const [inFlight, setInFlight] = useState(false);

  const [importing, setImporting] = useState(false);

  const [printing, setPrinting] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const [search, setSearch] = useState("");


  const [size, setSize] = useState("All sizes");

  const [priceMin, setPriceMin] = useState("");

  const [priceMax, setPriceMax] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);

  const [editing, setEditing] = useState<Product | null>(null);

  const [form, setForm] = useState<ProductForm>(blankForm());

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);

  const [importRows, setImportRows] = useState<ImportRow[]>([]);

  const [importFileName, setImportFileName] = useState("");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [previewLoading, setPreviewLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [printQueue, setPrintQueue] = useState<PrintQueueItem[]>([]);

  const [printQueueOpen, setPrintQueueOpen] = useState(false);

  const refreshProducts = useCallback(async (showToast = false) => {

    setRefreshing(true);

    setLoadError(null);

    try {

      const result = await apiRequest<ProductsResponse>("/all?sold=false");

      const fetched = result.products ?? [];

      setProducts(fetched);

      saveProductCache(fetched);

      setLastSynced(new Date());

      if (showToast) {

        toast.success("Products refreshed successfully");

      }

    } catch (error) {

      const message =

        error instanceof Error ? error.message : "Failed to load products";

      setLoadError(message);

      if (showToast || initialCache.current === null) {

        toast.error(message);

      }

    } finally {

      setLoading(false);

      setRefreshing(false);

    }

  }, []);

  useEffect(() => {

    void refreshProducts();

  }, [refreshProducts]);

  const shown = useMemo(() => {

    const term = search.trim().toLowerCase();

    return products.filter((product) => {

      if (product.sold) return false;

      const searchable = [

        product.name,

        product.barcode,

        getSupplierDetails(product, suppliers).code,

        getSupplierDetails(product, suppliers).name,

      ].some((value) => value.toLowerCase().includes(term));

      if (!searchable) return false;


      if (size !== "All sizes" && product.size !== size) return false;

      const pricePaise = Math.round(Number(product.sellingPrice) * 100);

      if (priceMin !== "" && pricePaise < toPaise(priceMin)) return false;

      if (priceMax !== "" && pricePaise > toPaise(priceMax)) return false;

      return true;

    });

  }, [products, search, size, priceMin, priceMax]);

  const availableSizes = useMemo(

    () => [...new Set([...sizes, ...products.map((p) => p.size)])],

    [products]

  );

  const selectedDeleteProduct = useMemo(

    () => products.find((p) => p.id === deleteId),

    [products, deleteId]

  );

  const allShownSelected =

    shown.length > 0 && shown.every((product) => selectedIds.includes(product.id));

  function openCreate() {

    setEditing(null);

    setForm(blankForm());

    setDialogOpen(true);

  }

  function openEdit(product: Product) {

    setEditing(product);

    setForm({

      name: product.name,

      size: product.size,

      supplierCodeId: getSupplierDetails(product, suppliers).id,


      price: product.sellingPrice,

      onHand:

        product.openingStock === null ? "" : String(product.openingStock),

    });

    setDialogOpen(true);

  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {

    event.preventDefault();

    if (inFlight) return;

    const price = Number(form.price);

    if (!Number.isFinite(price) || price <= 0) {

      toast.error("Enter a valid selling price");

      return;

    }

    if (!/^\d+(\.\d{1,2})?$/.test(form.price.trim())) {

      toast.error("Price can have at most two decimal places");

      return;

    }

    const openingStock =

      form.onHand.trim() === "" ? null : Number(form.onHand);

    if (

      openingStock !== null &&

      (!Number.isSafeInteger(openingStock) || openingStock < 0)

    ) {

      toast.error("Opening stock must be a non-negative whole number");

      return;

    }

    const payload = {

      name: form.name.trim(),

      size: form.size.trim(),


      supplierCodeId: form.supplierCodeId || null,

      sellingPrice: form.price.trim(),

      openingStock,

    };

    if (!payload.name || !payload.size) {

      toast.error("Please fill all required fields");

      return;

    }

    setInFlight(true);

    try {

      if (editing) {

        await apiRequest<ApiResponse>(`/update/${encodeURIComponent(editing.id)}`, {

          method: "PATCH",

          body: JSON.stringify(payload),

        });

        toast.success("Product updated successfully");

      } else {

        const result = await apiRequest<ApiResponse<{ product: Product }>>(

          "/create",

          {

            method: "POST",

            body: JSON.stringify(payload),

          }

        );

        toast.success("Product created successfully", {

          description: `Barcode: ${result.product.barcode}`,

        });

      }

      setDialogOpen(false);

      setEditing(null);

      await refreshProducts();

    } catch (error) {

      toast.error(

        error instanceof Error ? error.message : "Unable to save product"

      );

    } finally {

      setInFlight(false);

    }

  }

  async function deleteProduct() {

    if (!deleteId || inFlight) return;

    setInFlight(true);

    try {

      await apiRequest<ApiResponse>(`/delete/${encodeURIComponent(deleteId)}`, {

        method: "DELETE",

      });

      toast.success("Product deleted successfully");

      setDeleteId(null);

      await refreshProducts();

    } catch (error) {

      toast.error(

        error instanceof Error ? error.message : "Unable to delete product"

      );

    } finally {

      setInFlight(false);

    }

  }

  async function downloadSample() {

    try {

      const XLSX = await import("xlsx");

      const worksheet = XLSX.utils.aoa_to_sheet([

        [...EXCEL_HEADERS],

        ["Classic Shirt", "M", "ABC Textiles", "ABC001", 1499, 1],

        ["Straight Jeans", "32", "ABC Textiles", "ABC002", 1999, 5],

        ["Casual Kurti", "L", "New Fashion", "NF001", 899, 10],

        ["Printed Dress", "S", "New Fashion", "NF001", 1099, 8],

        ["Kids T-Shirt", "S", "New Fashion", "NF002", 499, 12],

      ]);

      worksheet["!cols"] = [

        { wch: 30 }, { wch: 12 }, { wch: 26 },

        { wch: 22 }, { wch: 18 }, { wch: 18 },

      ];

      // Preserve leading zeros in supplier codes when editing the workbook.

      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

      XLSX.writeFile(workbook, "neelam-products-supplier-import-template.xlsx");

      toast.success("Updated Excel template downloaded");

    } catch {

      toast.error("Unable to generate Excel template");

    }

  }

  async function previewFile(file: File) {

    setImportRows([]);

    setSelectedFile(null);

    setImportFileName(file.name);

    setPreviewLoading(true);

    try {

      if (!file.name.toLowerCase().endsWith(".xlsx")) {

        throw new Error("Please select an .xlsx file");

      }

      if (file.size > MAX_IMPORT_SIZE) {

        throw new Error("Maximum file size is 5 MB");

      }

      const XLSX = await import("xlsx");

      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });

      const sheetName = workbook.SheetNames.find(name => name.trim().toLowerCase() === "products");

      const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

      if (!sheet) {

        throw new Error('Excel file must contain a worksheet named "Products"');

      }

      const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {

        header: 1,

        defval: "",

        blankrows: true,

        raw: true,

      });

      const headerRow = (data[0] ?? []).map((value) => String(value ?? "").trim());

      const validHeaders =

        headerRow.length === EXCEL_HEADERS.length &&

        EXCEL_HEADERS.every((header, index) => headerRow[index] === header);

      if (!validHeaders) {

        throw new Error(`Invalid Excel headers. Expected: ${EXCEL_HEADERS.join(", ")}`);

      }

      const rows: ImportRow[] = [];

      data.slice(1).forEach((record, index) => {

        const cells = Array.isArray(record) ? record : [];

        if (cells.every((value) => String(value ?? "").trim() === "")) {

          return;

        }

        const [name, rowSize, supplierName, supplierCode, rawPrice, rawStock] =

          cells.map((value) => String(value ?? "").trim());

        const price = Number(rawPrice);

        const pricePaise = Number.isFinite(price) ? Math.round(price * 100) : 0;

        const errors: string[] = [];

        if (!name) errors.push("Product name required");

        if (!rowSize) errors.push("Size required");


        if (name.length > 200) errors.push("Product name too long (max 200)");

        if (rowSize.length > 50) errors.push("Size too long (max 50)");


        if (Boolean(supplierName) !== Boolean(supplierCode)) errors.push("Supplier name and code must be entered together");

        if (supplierName.length > 180) errors.push("Supplier name too long (max 180)");

        if (supplierCode.length > 80) errors.push("Supplier code too long (max 80)");

        if (!/^\d+(\.\d{1,2})?$/.test(rawPrice) || !Number.isFinite(price) || price <= 0 || price > 9999999999.99) {

          errors.push("Invalid selling price");

        }

        if (

          rawStock !== "" &&

          (!/^\d+$/.test(rawStock) || !Number.isSafeInteger(Number(rawStock)) || Number(rawStock) > 2147483647)

        ) {

          errors.push("Invalid opening stock");

        }

        rows.push({

          sourceRow: index + 2,

          name,

          size: rowSize,


          supplierName,

          supplierCode,

          sellingPrice: rawPrice,

          openingStock: rawStock,

          pricePaise,

          error: errors.join(" · ") || undefined,

        });

      });

      if (!rows.length) {

        throw new Error("No product rows found in Excel");

      }

      if (rows.length > MAX_IMPORT_ROWS) {

        throw new Error(`Maximum ${MAX_IMPORT_ROWS} products per upload`);

      }

      setImportRows(rows);

      setSelectedFile(file);

      toast.success("Excel file loaded", {

        description: `${rows.length} product rows found`,

      });

    } catch (error) {

      toast.error(

        error instanceof Error ? error.message : "Unable to read Excel file"

      );

      setImportRows([]);

      setSelectedFile(null);

    } finally {

      setPreviewLoading(false);

    }

  }

  async function importValidRows() {

    if (!selectedFile || importing) return;

    const invalidRows = importRows.filter((row) => row.error);

    if (invalidRows.length > 0) {

      toast.error("Fix all invalid Excel rows before importing");

      return;

    }

    setImporting(true);

    try {

      const formData = new FormData();

      formData.append("file", selectedFile);

      const result = await apiRequest<ImportResponse>("/bulk", {

        method: "POST",

        body: formData,

      });

      toast.success("Products imported successfully", {

        description:

          `${result.importedCount ?? importRows.length} products added. ` +

          `${result.firstBarcode} to ${result.lastBarcode}. ` +

            `${result.suppliers?.created ?? 0} suppliers and ${result.supplierCodes?.created ?? 0} codes created.`,

      });

      setImportOpen(false);

      setImportRows([]);

      setImportFileName("");

      setSelectedFile(null);

      await Promise.all([refreshProducts(), refreshSuppliers()]);

    } catch (error) {

      toast.error(error instanceof Error ? error.message : "Excel upload failed");

    } finally {

      setImporting(false);

    }

  }

  function toggleProductSelection(id: string) {

    setSelectedIds((current) =>

      current.includes(id)

        ? current.filter((item) => item !== id)

        : [...current, id]

    );

  }

  function toggleSelectAllShown() {

    if (allShownSelected) {

      setSelectedIds((current) =>

        current.filter((id) => !shown.some((product) => product.id === id))

      );

    } else {

      setSelectedIds((current) => [

        ...new Set([...current, ...shown.map((product) => product.id)]),

      ]);

    }

  }

  function addProductsToQueue(items: Product[]) {

    setPrintQueue((current) => {

      const next = [...current];

      for (const product of items) {

        const existing = next.find((item) => item.id === product.id);

        if (existing) {

          existing.copies += 1;

        } else {

          next.push({

            id: product.id,

            product,

            copies: 1,

          });

        }

      }

      return next;

    });

  }

  function addSelectedToPrintQueue() {

    const selectedProducts = shown.filter((product) =>

      selectedIds.includes(product.id)

    );

    if (!selectedProducts.length) {

      toast.error("Select at least one product");

      return;

    }

    addProductsToQueue(selectedProducts);

    setPrintQueueOpen(true);

    toast.success(`${selectedProducts.length} products added to print queue`);

  }

  function addSingleToPrintQueue(product: Product) {

    addProductsToQueue([product]);

    setPrintQueueOpen(true);

    toast.success(`${product.name} added to print queue`);

  }

  function updateQueueCopies(id: string, change: number) {

    setPrintQueue((current) =>

      current

        .map((item) =>

          item.id === id

            ? { ...item, copies: Math.max(1, item.copies + change) }

            : item

        )

        .filter(Boolean)

    );

  }

  function removeFromQueue(id: string) {

    setPrintQueue((current) => current.filter((item) => item.id !== id));

  }

  function clearQueue() {

    setPrintQueue([]);

  }

  async function printQueueNow(items = printQueue) {

  if (!items.length) {

    toast.error("Print queue is empty");

    return;

  }



  if (printing) return;



  setPrinting(true);



  try {

    if (!qz.websocket.isActive()) {

      await qz.websocket.connect({

        retries: 3,

        delay: 1,

      });

    }



    const printer = await qz.printers.find("TSC TE244");



    if (!printer) {

      throw new Error("TSC TE244 printer not found");

    }



    const config = qz.configs.create(printer, {

      encoding: "UTF-8",

      jobName: "Neelams Couture Barcode Labels",

    });



    const safeText = (value: string) =>

      String(value)

        .replace(/[\r\n"\x00-\x1f]/g, " ")

        .replace(/[^\x20-\x7E]/g, "")

        .trim();



    // 50mm x 25mm @ 203 dpi ≈ 400 x 200 dots

    const LABEL_WIDTH = 400;



    const commands: string[] = [];

    let totalLabels = 0;



    for (const item of items) {

      const copies = Math.max(1, Number(item.copies) || 1);



      const barcode = safeText(item.product.barcode);

      const supplierCode = safeText(

        getSupplierDetails(item.product, suppliers).code || "-"

      ).slice(0, 18);



      const pricePaise = Math.round(Number(item.product.sellingPrice) * 100);

      const price = `Rs. ${(pricePaise / 100).toFixed(0)}`;



      // ------------------------------------------------------------

      // BARCODE IMAGE POSITIONING

      // ------------------------------------------------------------

      // Move barcode slightly down so top is not cut

      const barcodeY = 22;



      // Barcode height reduced a little so it fits better

      const barcodeHeight = 68;



      // Estimated barcode width for Code128 with narrow=2, wide=2

      // This helps us center the barcode image itself

      const estimatedBarcodeWidth = Math.max(

        250,

        Math.min(300, 120 + barcode.length * 22)

      );



      const barcodeX = Math.max(

      100,

        Math.floor((LABEL_WIDTH - estimatedBarcodeWidth) / 2)

      );



      // ------------------------------------------------------------

      // BARCODE TEXT CENTER

      // ------------------------------------------------------------

      const barcodeTextCharWidth = 16;

      const barcodeTextWidth = barcode.length * barcodeTextCharWidth;

      const barcodeTextX = Math.max(

        20,

        Math.floor((LABEL_WIDTH - barcodeTextWidth) / 2)

      );



      // ------------------------------------------------------------

      // PRICE POSITION WITH EXTRA RIGHT SPACE

      // ------------------------------------------------------------

      const rightPadding = 26;

      const priceCharWidth = 12;

      const priceWidth = price.length * priceCharWidth;

      const priceX = Math.max(

        210,

        LABEL_WIDTH - rightPadding - priceWidth

      );



      commands.push(

        "SIZE 50 mm,25 mm",

        "GAP 2 mm,0 mm",

        "DIRECTION 1",

        "REFERENCE 0,0",

        "CLS",



        // Barcode image: centered and moved down

        `BARCODE ${barcodeX},${barcodeY},"128",${barcodeHeight},0,0,2,2,"${barcode}"`,



        // Barcode text centered below image

        `TEXT ${barcodeTextX},108,"3",0,1,1,"${barcode}"`,



        // Supplier code bottom left

        `TEXT 18,160,"2",0,1,1,"${supplierCode}"`,



        // Price bottom right with right gap

        `TEXT ${priceX},160,"2",0,1,1,"${price}"`,



        `PRINT 1,${copies}`

      );



      totalLabels += copies;

    }



    const rawData = commands.join("\r\n") + "\r\n";



    await qz.print(config, [

      {

        type: "raw",

        format: "command",

        flavor: "plain",

        data: rawData,

      },

    ]);



    toast.success(`${totalLabels} barcode label(s) printed successfully`);



    setPrintQueue([]);

    setPrintQueueOpen(false);

    setSelectedIds([]);

  } catch (error) {

    console.error("[QZ TRAY PRINT ERROR]", error);

    toast.error(

      error instanceof Error ? error.message : "Failed to print barcode labels"

    );

  } finally {

    setPrinting(false);

  }

}

  const validImportCount = importRows.filter((row) => !row.error).length;

  const invalidImportCount = importRows.length - validImportCount;

  return (

    <RetailLayout>
      <style>{`
        .neelam-products-page .data-table { font-size: 15px; }
        .neelam-products-page .data-table th { font-size: 12px; }
        .neelam-products-page .data-table td { font-size: 15px; }
        .neelam-products-page .field, .neelam-products-page .search-field,
        .neelam-products-page .select-control { font-size: 15px; }
        .neelam-products-page .toolbar-start input, .neelam-products-page .field input,
        .neelam-products-page .field select { font-size: 15px; }
      `}</style>
      <div className="neelam-products-page">

      <div className="page-heading">

        <div>

          <div className="eyebrow">CATALOGUE</div>

          <h1>Products</h1>

          <p>Keep styles, sizes, barcodes, prices, and label printing in one place.</p>

        </div>

        <button className="btn-primary" onClick={openCreate}>

          <Plus size={15} />

          New product

        </button>

      </div>

      <div className="page-toolbar">

        <div className="toolbar-start">

          <label className="search-field">

            <Search size={15} className="toolbar-search-icon" />

            <input

              value={search}

              onChange={(event) => setSearch(event.target.value)}

              placeholder="Search name, barcode, supplier code…"

            />

          </label>

          <select

            className="select-control"

            value={size}

            onChange={(event) => setSize(event.target.value)}

          >

            <option>All sizes</option>

            {availableSizes.map((option) => (

              <option key={option}>{option}</option>

            ))}

          </select>

          <label className="search-field price-filter">

            <Filter size={14} className="toolbar-search-icon" />

            <input

              type="number"

              min="0"

              value={priceMin}

              onChange={(event) => setPriceMin(event.target.value)}

              placeholder="Min price ₹"

            />

          </label>

          <label className="search-field price-filter">

            <input

              type="number"

              min="0"

              value={priceMax}

              onChange={(event) => setPriceMax(event.target.value)}

              placeholder="Max price ₹"

            />

          </label>

        </div>

        <div className="toolbar-end">

          <button

            className="btn-outline"

            onClick={() => void refreshProducts(true)}

            disabled={refreshing}

          >

            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />

            Refresh

          </button>

          <button className="btn-outline" onClick={downloadSample}>

            <Download size={14} />

            Sample Excel

          </button>

          <button

            className="btn-outline"

            onClick={() => {

              setImportRows([]);

              setSelectedFile(null);

              setImportFileName("");

              setImportOpen(true);

            }}

          >

            <Upload size={14} />

            Import Excel

          </button>

          <button className="btn-outline" onClick={addSelectedToPrintQueue}>

            <Printer size={14} />

            Add selected to queue

          </button>

          <button

            className="btn-primary"

            onClick={() => setPrintQueueOpen(true)}

          >

            <Barcode size={14} />

            Print queue ({printQueue.length})

          </button>

        </div>

      </div>

      <div

        style={{

          display: "flex",

          alignItems: "center",

          justifyContent: "space-between",

          gap: 12,

          marginBottom: 12,

          flexWrap: "wrap",

        }}

      >

        <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>

          {loading

            ? "Loading products..."

            : `${shown.length} of ${products.length} available products`}

        </span>

        <span

          style={{

            display: "flex",

            alignItems: "center",

            gap: 6,

            fontSize: 12,

            color: "var(--text-muted, #64748b)",

          }}

        >

          {refreshing && <Loader2 size={13} className="animate-spin" />}

          {lastSynced

            ? `Last synced ${lastSynced.toLocaleTimeString("en-IN")}`

            : initialCache.current

              ? "Showing cached products"

              : "Waiting for backend"}

        </span>

      </div>

      {loadError && (

        <div

          role="alert"

          style={{

            border: "1px solid #fecaca",

            background: "#fef2f2",

            color: "#991b1b",

            borderRadius: 10,

            padding: 12,

            marginBottom: 16,

            fontSize: 13,

            display: "flex",

            alignItems: "center",

            justifyContent: "space-between",

            gap: 12,

          }}

        >

          <span>Could not refresh products: {loadError}</span>

          <button

            type="button"

            onClick={() => void refreshProducts()}

            disabled={refreshing}

            style={{ fontWeight: 600, whiteSpace: "nowrap" }}

          >

            Retry

          </button>

        </div>

      )}

      <section className="panel data-panel">

        <div className="table-scroll">

          <table className="data-table">

            <thead>

              <tr>

                <th style={{ width: 42 }}>

                  <input

                    type="checkbox"

                    checked={allShownSelected}

                    onChange={toggleSelectAllShown}

                  />

                </th>

                <th>PRODUCT</th>

                <th>SIZE</th>

                <th>SUPPLIER CODE</th>


                <th>SELLING PRICE</th>

                <th>BARCODE</th>

                <th>STOCK</th>

                <th>CREATED</th>

                <th>ACTIONS</th>

              </tr>

            </thead>

            {loading ? (

              <TableSkeleton />

            ) : (

              <tbody>

                {shown.map((product) => (

                  <tr key={product.id}>

                    <td>

                      <input

                        type="checkbox"

                        checked={selectedIds.includes(product.id)}

                        onChange={() => toggleProductSelection(product.id)}

                      />

                    </td>

                    <td>

                      <span className="table-primary">

                        <span className="table-product-mark">

                          <Package size={15} />

                        </span>

                        {product.name}

                      </span>

                    </td>

                    <td>

                      <span className="badge">{product.size}</span>

                    </td>

                    <td>

                      <div>{getSupplierDetails(product, suppliers).code || "—"}</div>

                      <small style={{ color: "#64748b" }}>{getSupplierDetails(product, suppliers).name}</small>

                    </td>

  
                    <td>

                      <strong className="amount-strong">

                        {formatINR(Math.round(Number(product.sellingPrice) * 100))}

                      </strong>

                    </td>

                    <td>

                      <span className="barcode-value">

                        <Barcode size={13} /> {product.barcode}

                      </span>

                    </td>

                    <td>

                      {product.openingStock === null ? (

                        <span className="stock-untracked">Not tracked</span>

                      ) : (

                        <span

                          className={

                            product.openingStock < 5 ? "stock-low" : "stock-good"

                          }

                        >

                          {product.openingStock} units

                        </span>

                      )}

                    </td>

                    <td>

                      {new Date(product.createdAt).toLocaleDateString("en-IN", {

                        day: "2-digit",

                        month: "short",

                        year: "numeric",

                      })}

                    </td>

                    <td>

                      <div className="row-actions" style={{ display: "flex", gap: 6 }}>

                        <button

                          className="row-action"

                          aria-label={`Add ${product.name} to print queue`}

                          title="Add to print queue"

                          onClick={() => addSingleToPrintQueue(product)}

                        >

                          <Printer size={14} />

                        </button>

                        <button

                          className="row-action"

                          aria-label={`Edit ${product.name}`}

                          title="Edit product"

                          onClick={() => openEdit(product)}

                        >

                          <Edit3 size={14} />

                        </button>

                        <button

                          className="row-action danger"

                          aria-label={`Delete ${product.name}`}

                          title="Delete product"

                          onClick={() => setDeleteId(product.id)}

                        >

                          <Trash2 size={14} />

                        </button>

                      </div>

                    </td>

                  </tr>

                ))}

              </tbody>

            )}

          </table>

        </div>

        {!loading && shown.length === 0 && (

          <div className="empty-state">

            <div className="empty-state-icon">

              <Package size={21} />

            </div>

            <h3>

              {products.length === 0

                ? "No products added yet."

                : "No matching products"}

            </h3>

            <p>

              {products.length === 0

                ? "Add your first product to start billing."

                : "Try changing the search or filters."}

            </p>

            {products.length === 0 && (

              <button className="btn-primary" onClick={openCreate}>

                <Plus size={14} />

                Create product

              </button>

            )}

          </div>

        )}

      </section>

      {dialogOpen && (

        <ActionDialog

          title={editing ? "Edit product" : "New product"}

          description="Add the details used at checkout and on receipts."

          onClose={() => {

            if (!inFlight) setDialogOpen(false);

          }}

        >

          <form className="modal-body" onSubmit={(event) => void submitProduct(event)}>

            <div className="form-grid">

              <label className="field span-all">

                <span>PRODUCT NAME</span>

                <input

                  required

                  maxLength={200}

                  value={form.name}

                  onChange={(event) =>

                    setForm({ ...form, name: event.target.value })

                  }

                  placeholder="e.g. Classic linen shirt"

                />

              </label>

              <label className="field">

                <span>SIZE</span>

                <input

                  required

                  maxLength={50}

                  list="common-sizes"

                  value={form.size}

                  onChange={(event) =>

                    setForm({ ...form, size: event.target.value })

                  }

                  placeholder="Choose or enter a size"

                />

                <datalist id="common-sizes">

                  {sizes.map((item) => (

                    <option key={item} value={item} />

                  ))}

                </datalist>

              </label>

              <label className="field">

                <span>SUPPLIER &amp; CODE</span>

                <select

                  value={form.supplierCodeId}

                  disabled={suppliersLoading || Boolean(supplierLoadError)}

                  onChange={(event) => setForm({ ...form, supplierCodeId: event.target.value })}

                >

                  <option value="">No supplier code</option>

                  {supplierOptions.map(item => (

                    <option key={item.id} value={item.id}>

                      {item.supplierName} · {item.code}

                    </option>

                  ))}

                </select>

                {suppliersLoading && <small>Loading registered supplier codes...</small>}

                {supplierLoadError && <small style={{ color: "#b91c1c" }}>{supplierLoadError}</small>}

                {!suppliersLoading && !supplierLoadError && supplierOptions.length === 0 &&

                  <small>Create suppliers/codes in the Suppliers page, or bulk import from Excel.</small>}

              </label>

              <label className="field">

                <span>SELLING PRICE (₹)</span>

                <input

                  required

                  type="number"

                  min="0.01"

                  step="0.01"

                  value={form.price}

                  onChange={(event) =>

                    setForm({ ...form, price: event.target.value })

                  }

                  placeholder="0.00"

                />

              </label>

              <label className="field span-all">

                <span>BARCODE · AUTOMATICALLY GENERATED</span>

                <div className="barcode-edit">

                  <Barcode size={16} />

                  <input

                    readOnly

                    value={

                      editing

                        ? editing.barcode

                        : "Generated after saving (NEL0001...)"

                    }

                    style={{ cursor: "not-allowed" }}

                  />

                </div>

              </label>

              <label className="field span-all">

                <span>

                  OPENING STOCK <em>OPTIONAL</em>

                </span>

                <input

                  type="number"

                  min="0"

                  step="1"

                  value={form.onHand}

                  onChange={(event) =>

                    setForm({ ...form, onHand: event.target.value })

                  }

                  placeholder="Leave blank if you do not track stock"

                />

              </label>

            </div>

            <div className="modal-footer">

              <button

                type="button"

                className="btn-outline"

                disabled={inFlight}

                onClick={() => setDialogOpen(false)}

              >

                Cancel

              </button>

              <button type="submit" className="btn-primary" disabled={inFlight}>

                {inFlight && <Loader2 size={15} className="animate-spin" />}

                {inFlight ? "Saving..." : editing ? "Save changes" : "Create product"}

              </button>

            </div>

          </form>

        </ActionDialog>

      )}

      {importOpen && (

        <ActionDialog

          title="Import products from Excel"

          description="Preview and validate your Excel file before uploading products."

          wide

          onClose={() => {

            if (!importing) setImportOpen(false);

          }}

        >

          <div className="modal-body">

            <label className="upload-zone import-picker">

              {previewLoading ? (

                <Loader2 size={23} className="animate-spin" />

              ) : (

                <FileSpreadsheet size={23} />

              )}

              <strong>{importFileName || "Choose an Excel file"}</strong>

              <span>

                Upload .xlsx · name + code pair creates missing suppliers/codes · max 1,000 products · NEL barcodes generated

              </span>

              <input

                type="file"

                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

                disabled={importing || previewLoading}

                onChange={(event) => {

                  const file = event.target.files?.[0];

                  if (file) void previewFile(file);

                  event.target.value = "";

                }}

              />

            </label>

            {importRows.length > 0 && (

              <>

                <div className="import-summary">

                  <span>

                    <Check size={14} /> {validImportCount} products ready

                  </span>

                  {invalidImportCount > 0 && (

                    <span className="import-errors">

                      {invalidImportCount} products have errors

                    </span>

                  )}

                </div>

                <div className="table-scroll import-preview">

                  <table className="data-table">

                    <thead>

                      <tr>

                        <th>ROW</th>

                        <th>PRODUCT</th>

                        <th>SIZE</th>

                        <th>SUPPLIER NAME</th>

                        <th>SUPPLIER CODE</th>

        
                        <th>PRICE</th>

                        <th>STOCK</th>

                        <th>STATUS</th>

                      </tr>

                    </thead>

                    <tbody>

                      {importRows.map((row) => (

                        <tr key={row.sourceRow}>

                          <td>{row.sourceRow}</td>

                          <td>{row.name || "—"}</td>

                          <td>{row.size || "—"}</td>

                          <td>{row.supplierName || "—"}</td>

                          <td>{row.supplierCode || "—"}</td>


                          <td>{formatINR(row.pricePaise)}</td>

                          <td>{row.openingStock || "—"}</td>

                          <td>

                            {row.error ? (

                              <span className="import-row-error" title={row.error}>

                                {row.error}

                              </span>

                            ) : (

                              <span className="badge badge-green">Ready</span>

                            )}

                          </td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

              </>

            )}

            <div className="import-guide">

              <span>Expected columns: {EXCEL_HEADERS.join(" · ")}</span>

              <button type="button" className="text-action" onClick={downloadSample}>

                <Download size={13} />

                Download sample

              </button>

            </div>

          </div>

          <div className="modal-footer">

            <button

              className="btn-outline"

              disabled={importing}

              onClick={() => setImportOpen(false)}

            >

              Cancel

            </button>

            <button

              className="btn-primary"

              disabled={

                importing ||

                previewLoading ||

                !selectedFile ||

                validImportCount === 0 ||

                invalidImportCount > 0

              }

              onClick={() => void importValidRows()}

            >

              {importing && <Loader2 size={15} className="animate-spin" />}

              {importing ? "Importing..." : `Import ${validImportCount} products`}

            </button>

          </div>

        </ActionDialog>

      )}

      {printQueueOpen && (

        <ActionDialog

          title="Barcode print queue"

          description="50mm × 25mm label layout · barcode image, code, supplier code, and price"

          wide

          onClose={() => {

            if (!printing) setPrintQueueOpen(false);

          }}

        >

          <div className="modal-body">

            {printQueue.length === 0 ? (

              <div className="empty-state" style={{ padding: "24px 0" }}>

                <div className="empty-state-icon">

                  <Barcode size={20} />

                </div>

                <h3>Print queue is empty</h3>

                <p>Select products and add them to the print queue.</p>

              </div>

            ) : (

              <div className="table-scroll">

                <table className="data-table">

                  <thead>

                    <tr>

                      <th>PRODUCT</th>

                      <th>BARCODE</th>

                      <th>SUPPLIER CODE</th>

                      <th>PRICE</th>

                      <th>COPIES</th>

                      <th>ACTIONS</th>

                    </tr>

                  </thead>

                  <tbody>

                    {printQueue.map((item) => (

                      <tr key={item.id}>

                        <td>{item.product.name}</td>

                        <td>{item.product.barcode}</td>

                        <td>{getSupplierDetails(item.product, suppliers).code || "—"}</td>

                        <td>

                          {formatINR(

                            Math.round(Number(item.product.sellingPrice) * 100)

                          )}

                        </td>

                        <td>

                          <div

                            style={{

                              display: "inline-flex",

                              alignItems: "center",

                              gap: 8,

                            }}

                          >

                            <button

                              type="button"

                              className="row-action"

                              onClick={() => updateQueueCopies(item.id, -1)}

                            >

                              <Minus size={14} />

                            </button>

                            <strong style={{ minWidth: 18, textAlign: "center" }}>

                              {item.copies}

                            </strong>

                            <button

                              type="button"

                              className="row-action"

                              onClick={() => updateQueueCopies(item.id, 1)}

                            >

                              <Plus size={14} />

                            </button>

                          </div>

                        </td>

                        <td>

                          <button

                            type="button"

                            className="row-action danger"

                            onClick={() => removeFromQueue(item.id)}

                          >

                            <X size={14} />

                          </button>

                        </td>

                      </tr>

                    ))}

                  </tbody>

                </table>

              </div>

            )}

          </div>

          <div className="modal-footer">

            <button

              className="btn-outline"

              disabled={printing || printQueue.length === 0}

              onClick={clearQueue}

            >

              Clear queue

            </button>

            <button

              className="btn-primary"

              disabled={printing || printQueue.length === 0}

              onClick={() => void printQueueNow()}

            >

              {printing && <Loader2 size={15} className="animate-spin" />}

              {printing

                ? "Preparing labels..."

                : `Print ${

                    printQueue.reduce((sum, item) => sum + item.copies, 0)

                  } labels`}

            </button>

          </div>

        </ActionDialog>

      )}

      {deleteId !== null && (

        <ActionDialog

          title="Delete product?"

          onClose={() => {

            if (!inFlight) setDeleteId(null);

          }}

        >

          <ConfirmAction

            title=""

            description={`Are you sure you want to delete "${

              selectedDeleteProduct?.name ?? "this product"

            }"? This action cannot be undone.`}

            confirmLabel="Delete"

            danger

            pending={inFlight}

            onCancel={() => setDeleteId(null)}

            onConfirm={() => void deleteProduct()}

          />

        </ActionDialog>

      )}

      </div>
    </RetailLayout>

  );

}
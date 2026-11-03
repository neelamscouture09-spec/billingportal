
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../../lib/prisma";
import { createProductSchema } from "../../../../lib/product";
import { reserveProductBarcodes } from "../../../../lib/barcode";
import {
  corsHeaders,
  corsOptions,
} from "../../../../lib/cors";


const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_PRODUCTS = 1000;

const HEADERS = [
  "name",
  "size",
  "supplierName",
  "supplierCode",
  "sellingPrice",
  "openingStock",
] as const;

type Field = (typeof HEADERS)[number];

type ValidProduct = {
  row: number;
  name: string;
  size: string;
  supplierName: string | null;
  supplierCode: string | null;
  sellingPrice: string;
  openingStock: number | null;
};

type ImportError = {
  row: number;
  field: string;
  message: string;
};

type SupplierEntry = {
  id: string;
  name: string;
  codes: {
    id: string;
    code: string;
  }[];
};

// ------------------------------------------------------------
// RESPONSES
// ------------------------------------------------------------

function respond(
  request: NextRequest,
  data: unknown,
  status = 200
) {
  return NextResponse.json(data, {
    status,
    headers: corsHeaders(request),
  });
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

// ------------------------------------------------------------
// EXCEL HELPERS
// ------------------------------------------------------------

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()₹]/g, "");
}

function resolveHeader(value: string): Field | null {
  const aliases: Record<string, Field> = {
    name: "name",
    productname: "name",
    size: "size",
    suppliername: "supplierName",
    supplier: "supplierName",
    suppliercode: "supplierCode",
    code: "supplierCode",
    sellingprice: "sellingPrice",
    price: "sellingPrice",
    openingstock: "openingStock",
    stock: "openingStock",
  };

  return aliases[normalizeHeader(value)] ?? null;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function parseStock(
  value: string
): number | null | "INVALID" {
  if (value === "") return null;

  if (!/^\d+$/.test(value)) return "INVALID";

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < 0 ||
    number > 2147483647
  ) {
    return "INVALID";
  }

  return number;
}

function sheetHasFormulas(sheet: XLSX.WorkSheet) {
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;

    if (
      cell &&
      typeof cell === "object" &&
      "f" in cell &&
      cell.f !== undefined
    ) {
      return true;
    }
  }

  return false;
}

// ------------------------------------------------------------
// SUPPLIER MATCHING
// ------------------------------------------------------------

// Supplier names are matched case-insensitively.
// Codes are stored in uppercase, matching the supplier API.

function normalizeSupplierName(value: string) {
  return value.trim().toLowerCase();
}

function normalizeSupplierCode(value: string) {
  return value.trim().toUpperCase();
}

// ------------------------------------------------------------
// POST /api/products/bulk
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // --------------------------------------------------------
    // 1. READ FILE
    // --------------------------------------------------------

    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      return respond(
        request,
        {
          success: false,
          error: "Invalid multipart form-data",
        },
        400
      );
    }

    const file = formData.get("file");

    if (!(file instanceof File)) {
      return respond(
        request,
        {
          success: false,
          error: "Excel file is missing",
          hint: 'Use form-data field "file"',
        },
        400
      );
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return respond(
        request,
        {
          success: false,
          error: "Only .xlsx files are supported",
        },
        400
      );
    }

    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return respond(
        request,
        {
          success: false,
          error: "File must be between 1 byte and 5 MB",
        },
        400
      );
    }

    // --------------------------------------------------------
    // 2. PARSE WORKBOOK
    // --------------------------------------------------------

    let workbook: XLSX.WorkBook;

    try {
      const buffer = Buffer.from(
        await file.arrayBuffer()
      );

      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: false,
        cellFormula: true,
        cellStyles: false,
        WTF: true,
      });
    } catch (error) {
      console.error("[XLSX PARSE ERROR]", error);

      return respond(
        request,
        {
          success: false,
          error: "Unable to parse Excel workbook",
        },
        400
      );
    }

    // --------------------------------------------------------
    // 3. FIND PRODUCTS WORKSHEET
    // --------------------------------------------------------

    const sheetName = workbook.SheetNames.find(
      name =>
        name.trim().toLowerCase() === "products"
    );

    if (!sheetName) {
      return respond(
        request,
        {
          success: false,
          error: 'Worksheet "Products" not found',
          availableSheets: workbook.SheetNames,
        },
        400
      );
    }

    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return respond(
        request,
        {
          success: false,
          error: "Products worksheet is empty",
        },
        400
      );
    }

    // --------------------------------------------------------
    // 4. REJECT FORMULAS
    // --------------------------------------------------------

    if (sheetHasFormulas(sheet)) {
      return respond(
        request,
        {
          success: false,
          error: "Excel formulas are not allowed",
          hint: "Replace formulas with their values",
        },
        400
      );
    }

    // --------------------------------------------------------
    // 5. EXTRACT ROWS
    // --------------------------------------------------------

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(
      sheet,
      {
        header: 1,
        defval: "",
        blankrows: true,
        raw: true,
      }
    );

    if (matrix.length < 2) {
      return respond(
        request,
        {
          success: false,
          error: "Excel sheet contains no product rows",
        },
        400
      );
    }

    const range = XLSX.utils.decode_range(
      sheet["!ref"] || "A1"
    );

    if (range.s.r !== 0) {
      return respond(
        request,
        {
          success: false,
          error: "Headers must be on Excel row 1",
        },
        400
      );
    }

    // --------------------------------------------------------
    // 6. MAP HEADERS
    // --------------------------------------------------------

    const headerRow = matrix[0] ?? [];

    const columnMap = new Map<Field, number>();
    const unknownHeaders: string[] = [];

    headerRow.forEach((value, index) => {
      const header = asText(value);

      if (!header) return;

      const field = resolveHeader(header);

      if (!field) {
        unknownHeaders.push(header);
        return;
      }

      if (columnMap.has(field)) {
        unknownHeaders.push(
          `Duplicate column: ${header}`
        );
        return;
      }

      columnMap.set(field, index);
    });

    const required: Field[] = [
      "name",
      "size",
          "supplierName",
      "supplierCode",
      "sellingPrice",
    ];

    const missingFields = required.filter(
      field => !columnMap.has(field)
    );

    if (
      missingFields.length > 0 ||
      unknownHeaders.length > 0
    ) {
      return respond(
        request,
        {
          success: false,
          error: "Invalid Excel column headers",
          expectedHeaders: HEADERS,
          receivedHeaders: headerRow.map(asText),
          missingFields,
          unknownHeaders,
        },
        400
      );
    }

    // --------------------------------------------------------
    // 7. VALIDATE ALL EXCEL PRODUCTS FIRST
    // --------------------------------------------------------

    const products: ValidProduct[] = [];
    const errors: ImportError[] = [];

    let totalRows = 0;

    for (
      let index = 1;
      index < matrix.length;
      index++
    ) {
      const record = matrix[index] ?? [];
      const excelRow = index + 1;

      if (
        record.every(
          value => asText(value) === ""
        )
      ) {
        continue;
      }

      totalRows++;

      if (totalRows > MAX_PRODUCTS) {
        errors.push({
          row: excelRow,
          field: "row",
          message:
            `Maximum ${MAX_PRODUCTS} products allowed`,
        });

        break;
      }

      function getValue(field: Field): string {
        const column = columnMap.get(field);

        if (column === undefined) return "";

        return asText(record[column]);
      }

      const name = getValue("name");
      const size = getValue("size");

      const supplierName = getValue(
        "supplierName"
      );

      const supplierCode = getValue(
        "supplierCode"
      );

      const sellingPrice = getValue(
        "sellingPrice"
      );

      const openingStock = parseStock(
        getValue("openingStock")
      );

      // ------------------------------------------------------
      // STOCK VALIDATION
      // ------------------------------------------------------

      if (openingStock === "INVALID") {
        errors.push({
          row: excelRow,
          field: "openingStock",
          message:
            "Opening stock must be a non-negative whole number",
        });

        continue;
      }

      // ------------------------------------------------------
      // SUPPLIER NAME + CODE VALIDATION
      // ------------------------------------------------------

      if (
        (supplierName && !supplierCode) ||
        (!supplierName && supplierCode)
      ) {
        errors.push({
          row: excelRow,
          field: "supplierName / supplierCode",
          message:
            "Supplier name and supplier code must be entered together.",
        });

        continue;
      }

      if (supplierName.length > 180) {
        errors.push({
          row: excelRow,
          field: "supplierName",
          message:
            "Supplier name cannot exceed 180 characters.",
        });

        continue;
      }

      if (supplierCode.length > 80) {
        errors.push({
          row: excelRow,
          field: "supplierCode",
          message:
            "Supplier code cannot exceed 80 characters.",
        });

        continue;
      }

      // ------------------------------------------------------
      // VALIDATE PRODUCT FIELDS
      // ------------------------------------------------------


      const parsed = createProductSchema.safeParse({
        name,
        size,
        category: "Uncategorized", // Internal compatibility; not an Excel column

        // Both fields are required together when supplied.
        supplierName: supplierName.trim() || null,
        supplierCode:
        supplierCode.trim().toUpperCase() || null,

        sellingPrice,
        openingStock,
      });


      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({
            row: excelRow,
            field:
              issue.path.join(".") || "product",
            message: issue.message,
          });
        }

        continue;
      }

      const data = parsed.data;

      products.push({
        row: excelRow,
        name: data.name,
        size: data.size,
        supplierName: data.supplierName || null,
        supplierCode: data.supplierCode
          ? normalizeSupplierCode(data.supplierCode)
          : null,
        sellingPrice: data.sellingPrice,
        openingStock: data.openingStock ?? null,
      });
    }

    // --------------------------------------------------------
    // 8. CHECK EMPTY FILE
    // --------------------------------------------------------

    if (totalRows === 0) {
      return respond(
        request,
        {
          success: false,
          error: "No product data found",
        },
        400
      );
    }

    // --------------------------------------------------------
    // 9. RETURN VALIDATION ERRORS
    // --------------------------------------------------------

    if (errors.length > 0) {
      return respond(
        request,
        {
          success: false,
          message:
            "Excel validation failed. No products, suppliers or codes were created.",
          totalRows,
          validRows: products.length,
          errorCount: errors.length,
          errors: errors.slice(0, 100),
        },
        422
      );
    }

    // --------------------------------------------------------
    // 10. DATABASE TRANSACTION
    // --------------------------------------------------------

    // The following operations happen atomically:
    //
    // 1. Find existing suppliers
    // 2. Create missing suppliers
    // 3. Find existing codes under each supplier
    // 4. Create missing codes
    // 5. Link product rows to supplierCodeId
    // 6. Allocate barcodes
    // 7. Insert all products
    //
    // Any failure rolls back everything.

    const importTransaction = async () =>
      prisma.$transaction(
        async tx => {
          // --------------------------------------------------
          // 11. LOAD REGISTERED SUPPLIERS WITH CODES
          // --------------------------------------------------

          const existingSuppliers =
            await tx.supplier.findMany({
              include: {
                codes: {
                  select: {
                    id: true,
                    code: true,
                  },
                },
              },
            });

          const supplierMap = new Map<
            string,
            SupplierEntry
          >();

          for (const supplier of existingSuppliers) {
            const key = normalizeSupplierName(
              supplier.name
            );

            // Prevent case-insensitive ambiguity.
            if (supplierMap.has(key)) {
              throw new Error(
                `DUPLICATE_SUPPLIER_NAME:${supplier.name}`
              );
            }

            supplierMap.set(key, {
              id: supplier.id,
              name: supplier.name,
              codes: supplier.codes,
            });
          }

          // Cache code IDs by supplier ID and code.
          const codeMap = new Map<string, string>();

          for (const supplier of existingSuppliers) {
            for (const item of supplier.codes) {
              const key = JSON.stringify([
                supplier.id,
                normalizeSupplierCode(item.code),
              ]);

              if (codeMap.has(key)) {
                throw new Error(
                  `DUPLICATE_SUPPLIER_CODE:${supplier.name}:${item.code}`
                );
              }

              codeMap.set(key, item.id);
            }
          }

          // Track counts for the response.
          let createdSuppliers = 0;
          let existingSuppliersUsed = 0;

          let createdCodes = 0;
          let existingCodesUsed = 0;

          const usedSupplierIds = new Set<string>();
          const usedCodeIds = new Set<string>();

          // Each validated product receives its resolved
          // supplierCodeId.

          const resolvedProducts: Array<
            ValidProduct & {
              supplierCodeId: string | null;
            }
          > = [];

          // --------------------------------------------------
          // 12. PROCESS EACH PRODUCT RELATIONSHIP
          // --------------------------------------------------

          for (const product of products) {
            let supplierCodeId: string | null = null;

            if (
              product.supplierName &&
              product.supplierCode
            ) {
              const supplierName =
                product.supplierName.trim();

              const supplierNameKey =
                normalizeSupplierName(supplierName);

              const supplierCode =
                normalizeSupplierCode(
                  product.supplierCode
                );

              // ----------------------------------------------
              // FIND OR CREATE SUPPLIER
              // ----------------------------------------------

              let supplier = supplierMap.get(
                supplierNameKey
              );

              if (!supplier) {
                // Supplier does not exist.
                // Create it inside the transaction.

                const created =
                  await tx.supplier.create({
                    data: {
                      name: supplierName,
                    },
                    select: {
                      id: true,
                      name: true,
                    },
                  });

                supplier = {
                  id: created.id,
                  name: created.name,
                  codes: [],
                };

                supplierMap.set(
                  supplierNameKey,
                  supplier
                );

                createdSuppliers++;
              } else if (
                !usedSupplierIds.has(supplier.id)
              ) {
                // Count reused suppliers once.
                if (
                  existingSuppliers.some(
                    item => item.id === supplier.id
                  )
                ) {
                  existingSuppliersUsed++;
                }
              }

              usedSupplierIds.add(supplier.id);

              // ----------------------------------------------
              // FIND OR CREATE CODE FOR THIS SUPPLIER
              // ----------------------------------------------

              const codeKey = JSON.stringify([
                supplier.id,
                supplierCode,
              ]);

              const existingCodeId =
                codeMap.get(codeKey);

              if (existingCodeId) {
                supplierCodeId = existingCodeId;

                if (
                  !usedCodeIds.has(existingCodeId)
                ) {
                  existingCodesUsed++;
                }
              } else {
                // The code might exist under another supplier.
                // That's valid: create this supplier's own code.

                const createdCode =
                  await tx.supplierCode.create({
                    data: {
                      supplierId: supplier.id,
                      code: supplierCode,
                    },
                    select: {
                      id: true,
                      code: true,
                    },
                  });

                supplierCodeId = createdCode.id;

                codeMap.set(
                  codeKey,
                  createdCode.id
                );

                createdCodes++;
              }

              usedCodeIds.add(supplierCodeId);
            }

            resolvedProducts.push({
              ...product,
              supplierCodeId,
            });
          }

          // --------------------------------------------------
          // 13. ALLOCATE BARCODES
          // --------------------------------------------------

          const barcodes =
            await reserveProductBarcodes(
              tx,
              resolvedProducts.length
            );

          // --------------------------------------------------
          // 14. PREPARE PRODUCT INSERT RECORDS
          // --------------------------------------------------

          const data = resolvedProducts.map(
            (product, index) => ({
              name: product.name,
              size: product.size,
              category: "Uncategorized", // Legacy required database field

              // Store foreign key, not plain text.
              supplierCodeId: product.supplierCodeId,

              sellingPrice: new Prisma.Decimal(
                product.sellingPrice
              ),

              openingStock: product.openingStock,
              barcode: barcodes[index],
              sold: false,
            })
          );

          // --------------------------------------------------
          // 15. INSERT PRODUCTS
          // --------------------------------------------------

          const created =
            await tx.product.createMany({
              data,
            });

          return {
            importedCount: created.count,
            firstBarcode: barcodes[0],
            lastBarcode:
              barcodes[barcodes.length - 1],

            createdSuppliers,
            existingSuppliersUsed,

            createdCodes,
            existingCodesUsed,

            linkedProducts: resolvedProducts.filter(
              p => p.supplierCodeId !== null
            ).length,

            unlinkedProducts: resolvedProducts.filter(
              p => p.supplierCodeId === null
            ).length,
          };
        },
        {
          maxWait: 20000,
          timeout: 60000,
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        }
      );

    // Retry serialization conflicts that can happen when
    // two imports modify supplier records concurrently.
    // A failed transaction is rolled back before retrying.

    let result:
      Awaited<ReturnType<typeof importTransaction>> |
      undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await importTransaction();
        break;
      } catch (error) {
        const retryable =
          error instanceof
          Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";

        if (!retryable || attempt === 2) {
          throw error;
        }
      }
    }

    if (!result) {
      throw new Error("IMPORT_TRANSACTION_FAILED");
    }

    // --------------------------------------------------------
    // 16. SUCCESS RESPONSE
    // --------------------------------------------------------

    return respond(
      request,
      {
        success: true,
        message:
          "Products, suppliers and supplier codes imported successfully.",

        totalRows: products.length,
        importedCount: result.importedCount,
        failedCount: 0,

        suppliers: {
          created: result.createdSuppliers,
          reused: result.existingSuppliersUsed,
        },

        supplierCodes: {
          created: result.createdCodes,
          reused: result.existingCodesUsed,
        },

        linkedProducts: result.linkedProducts,
        unlinkedProducts: result.unlinkedProducts,

        firstBarcode: result.firstBarcode,
        lastBarcode: result.lastBarcode,
      },
      201
    );
  } catch (error) {
    console.error("[BULK IMPORT ERROR]", error);

    // --------------------------------------------------------
    // CONSTRAINT ERRORS
    // --------------------------------------------------------

    if (
      error instanceof
      Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === "P2002") {
        return respond(
          request,
          {
            success: false,
            error:
              "A supplier, supplier code or barcode uniqueness conflict occurred. Please check for concurrent imports and retry. No records from this import were saved.",
          },
          409
        );
      }

      if (error.code === "P2003") {
        return respond(
          request,
          {
            success: false,
            error:
              "Supplier relationship constraint failed. No records from this import were saved.",
          },
          409
        );
      }

      if (error.code === "P2034") {
        return respond(
          request,
          {
            success: false,
            error:
              "Concurrent database update detected. Please retry the import.",
          },
          409
        );
      }
    }

    // --------------------------------------------------------
    // CASE-INSENSITIVE DUPLICATES
    // --------------------------------------------------------

    if (
      error instanceof Error &&
      error.message.startsWith(
        "DUPLICATE_SUPPLIER_NAME:"
      )
    ) {
      return respond(
        request,
        {
          success: false,
          error:
            "Multiple existing suppliers have the same name with different capitalization. Resolve the duplicate suppliers before importing.",
        },
        409
      );
    }

    if (
      error instanceof Error &&
      error.message.startsWith(
        "DUPLICATE_SUPPLIER_CODE:"
      )
    ) {
      return respond(
        request,
        {
          success: false,
          error:
            "Duplicate supplier codes differing only by capitalization exist under one supplier. Resolve them before importing.",
        },
        409
      );
    }

    // --------------------------------------------------------
    // UNEXPECTED ERRORS
    // --------------------------------------------------------

    return respond(
      request,
      {
        success: false,
        error:
          "Internal error during Excel import. The transaction was rolled back.",
      },
      500
    );
  }
}

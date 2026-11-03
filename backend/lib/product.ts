
import { randomInt } from "node:crypto";
import { z } from "zod";

// ============================================================
// SELLING PRICE VALIDATION
// ============================================================

const sellingPriceSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(
    z
      .string()
      .regex(
        /^\d+(\.\d{1,2})?$/,
        "Price must be a valid positive number with at most two decimal places"
      )
      .refine(
        (value) => {
          const price = Number(value);

          return (
            Number.isFinite(price) &&
            price > 0 &&
            price <= 9999999999.99
          );
        },
        {
          message:
            "Price must be greater than zero and within limits",
        }
      )
  );

// ============================================================
// SUPPLIER VALIDATION
// ============================================================

// Supplier name entered in the Excel sheet or product form.
// This is used to find or create a Supplier record.

const supplierNameSchema = z
  .string()
  .trim()
  .max(
    180,
    "Supplier name cannot exceed 180 characters"
  )
  .nullish();

// Supplier code entered in the Excel sheet or product form.
// This is used to find or create a SupplierCode record.

const supplierCodeSchema = z
  .string()
  .trim()
  .max(
    80,
    "Supplier code cannot exceed 80 characters"
  )
  .transform((value) =>
    typeof value === "string"
      ? value.toUpperCase()
      : value
  )
  .nullish();

// Existing supplier-code ID used by Prisma.
// It is a UUID because SupplierCode.id uses @default(uuid()).

const supplierCodeIdSchema = z
  .uuid("Invalid supplier code ID")
  .nullish();

// ============================================================
// BASE PRODUCT SCHEMA
// ============================================================

const baseProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(200, "Product name cannot exceed 200 characters"),

  size: z
    .string()
    .trim()
    .min(1, "Product size is required")
    .max(50, "Size cannot exceed 50 characters"),

  category: z
    .string()
    .trim()
    .min(1, "Category is required")
    .max(100, "Category cannot exceed 100 characters"),

  // Supplier information from frontend / Excel.
  // These fields are input values, not Product DB columns.

  supplierName: supplierNameSchema,

  supplierCode: supplierCodeSchema,

  // Actual relational foreign key.
  supplierCodeId: supplierCodeIdSchema,

  sellingPrice: sellingPriceSchema,

  barcode: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9-]{8,32}$/,
      "Barcode must contain 8 to 32 letters, numbers or hyphens"
    )
    .optional(),

  openingStock: z
    .number()
    .int("Opening stock must be a whole number")
    .nonnegative("Opening stock cannot be negative")
    .max(
      2147483647,
      "Opening stock exceeds the allowed limit"
    )
    .nullish(),
});

// ============================================================
// SUPPLIER PAIR VALIDATION
// ============================================================

function validateSupplierFields(
  data: {
    supplierName?: string | null;
    supplierCode?: string | null;
    supplierCodeId?: string | null;
  },
  ctx: z.RefinementCtx
) {
  const hasSupplierName =
    Boolean(data.supplierName?.trim());

  const hasSupplierCode =
    Boolean(data.supplierCode?.trim());

  const hasSupplierCodeId =
    Boolean(data.supplierCodeId);

  // When entering supplier details as text,
  // supplier name and code must appear together.
  //
  // This does not apply when an existing supplierCodeId
  // is supplied directly by the product dropdown.

  if (hasSupplierName !== hasSupplierCode) {
    if (!hasSupplierName && hasSupplierCode) {
      ctx.addIssue({
        code: "custom",
        path: ["supplierName"],
        message:
          "Supplier name is required when supplier code is provided",
      });
    }

    if (hasSupplierName && !hasSupplierCode) {
      ctx.addIssue({
        code: "custom",
        path: ["supplierCode"],
        message:
          "Supplier code is required when supplier name is provided",
      });
    }
  }

  // Prevent choosing an existing code ID while also
  // specifying a new supplier name and code.
  // The API should use one relationship method.

  if (
    hasSupplierCodeId &&
    (hasSupplierName || hasSupplierCode)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["supplierCodeId"],
      message:
        "Provide either supplierCodeId or supplierName and supplierCode, not both",
    });
  }
}

// ============================================================
// CREATE PRODUCT SCHEMA
// ============================================================

export const createProductSchema =
  baseProductSchema.superRefine(
    validateSupplierFields
  );

// ============================================================
// UPDATE PRODUCT SCHEMA
// ============================================================

// Allow partial updates for name, size, category,
// price, stock, barcode, or supplier relationship.
//
// A partial update does not require both supplierName
// and supplierCode unless the API is changing the
// relationship using text values.

export const updateProductSchema =
  baseProductSchema
    .partial()
    .extend({
      sold: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      if (Object.keys(data).length === 0) {
        ctx.addIssue({
          code: "custom",
          message:
            "Provide at least one field to update",
        });

        return;
      }

      // Only validate a name/code pair if these fields
      // were explicitly provided in the update.
      const supplierNameProvided =
        data.supplierName !== undefined;

      const supplierCodeProvided =
        data.supplierCode !== undefined;

      if (
        supplierNameProvided ||
        supplierCodeProvided
      ) {
        const hasName =
          Boolean(data.supplierName?.trim());

        const hasCode =
          Boolean(data.supplierCode?.trim());

        if (hasName !== hasCode) {
          ctx.addIssue({
            code: "custom",
            path: [
              hasName
                ? "supplierCode"
                : "supplierName",
            ],
            message:
              "Supplier name and supplier code must be supplied together",
          });
        }

        if (
          data.supplierCodeId &&
          (hasName || hasCode)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["supplierCodeId"],
            message:
              "Provide either supplierCodeId or supplier name and code",
          });
        }
      }
    });

// ============================================================
// SOLD STATUS VALIDATION
// ============================================================

export const soldStatusSchema = z.object({
  sold: z.boolean(),
});

// ============================================================
// GENERATE INTERNAL 13-DIGIT EAN-STYLE BARCODE
// ============================================================

export function generateBarcode(): string {
  const digits = String(
    randomInt(0, 1_000_000_000_000)
  ).padStart(12, "0");

  const sum = [...digits].reduce(
    (acc, digit, index) =>
      acc +
      Number(digit) *
        (index % 2 === 0 ? 1 : 3),
    0
  );

  const checkDigit =
    (10 - (sum % 10)) % 10;

  return digits + String(checkDigit);
}

// ============================================================
// FORMAT PRODUCT RESPONSE
// ============================================================

// Convert Prisma.Decimal to string while preserving
// the rest of the product object, including its supplier
// relation when included in the database query.

export function formatProduct<
  T extends {
    sellingPrice: {
      toString(): string;
    };
  }
>(product: T) {
  return {
    ...product,
    sellingPrice:
      product.sellingPrice.toString(),
  };
}

// ============================================================
// EXPORTED INFERRED TYPES
// ============================================================

export type CreateProductInput = z.infer<
  typeof createProductSchema
>;

export type UpdateProductInput = z.infer<
  typeof updateProductSchema
>;

export type SoldStatusInput = z.infer<
  typeof soldStatusSchema
>;

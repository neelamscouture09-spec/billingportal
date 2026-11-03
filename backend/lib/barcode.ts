import { Prisma } from "../generated/prisma/client";

export async function reserveProductBarcodes(
  tx: Prisma.TransactionClient,
  quantity: number
): Promise<string[]> {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Invalid barcode quantity");
  }

  // Initialize counter once, using the highest existing NEL code.
  // ON CONFLICT ensures concurrent initializers cannot overwrite it.
  await tx.$executeRaw`
    INSERT INTO "barcode_counters" ("key", "lastNumber")
    SELECT
      'product',
      COALESCE(
        MAX(CAST(SUBSTRING("barcode" FROM 4) AS INTEGER)),
        0
      )
    FROM "products"
    WHERE "barcode" ~ '^NEL[0-9]+$'
    ON CONFLICT ("key") DO NOTHING
  `;

  // Atomic increment: PostgreSQL locks this counter row
  // until the transaction finishes.
  const counter = await tx.barcodeCounter.update({
    where: {
      key: "product",
    },
    data: {
      lastNumber: {
        increment: quantity,
      },
    },
  });

  const firstNumber = counter.lastNumber - quantity + 1;

  return Array.from({ length: quantity }, (_, index) => {
    const sequence = firstNumber + index;

    return `NEL${String(sequence).padStart(4, "0")}`;
  });
}
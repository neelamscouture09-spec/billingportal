
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { prisma } from "../../../../../lib/prisma";
import { corsHeaders, corsOptions } from "../../../../../lib/cors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const OPTIONS = (request: NextRequest) =>
  corsOptions(request);

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const headers = corsHeaders(request);

  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers,
    });

  try {
    const { id } = await context.params;

    if (!id || !id.trim()) {
      return respond(
        {
          success: false,
          error: "Product ID is required",
        },
        400
      );
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
      },
    });

    if (!product) {
      return respond(
        {
          success: false,
          error: "Product not found",
        },
        404
      );
    }

    // Delete the product regardless of stock quantity,
    // reserved quantity, sales history or returns history.
    //
    // Historical invoice and return records must remain
    // in the database. This operation does not delete them.
    //
    // Database foreign keys may still prevent deletion
    // when dependent records reference this product.

    await prisma.product.delete({
      where: { id },
    });

    return respond({
      success: true,
      message: "Product deleted successfully",
      deletedProductId: product.id,
      deletedProductName: product.name,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return respond(
          {
            success: false,
            error: "Product already deleted or not found",
          },
          404
        );
      }

      if (error.code === "P2003") {
        return respond(
          {
            success: false,
            error:
              "Product is referenced by database records. A schema change is required to allow safe deletion while preserving transaction history.",
          },
          409
        );
      }

      if (error.code === "P2034") {
        return respond(
          {
            success: false,
            error: "Concurrent database update. Please retry.",
          },
          409
        );
      }
    }

    console.error("[DELETE PRODUCT]", error);

    return respond(
      {
        success: false,
        error: "Failed to delete product",
      },
      500
    );
  }
}

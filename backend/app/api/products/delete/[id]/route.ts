import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { prisma } from "../../../../../lib/prisma";
import {
  corsHeaders,
  corsOptions,
} from "../../../../../lib/cors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const headers = corsHeaders(request);

  try {
    const { id } = await context.params;

    try {
      const product = await prisma.product.delete({
        where: { id },
      });

      return NextResponse.json(
        {
          success: true,
          message: "Product deleted successfully",
          deletedProductId: product.id,
        },
        { status: 200, headers }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
      ) {
        if (error.code === "P2025") {
          return NextResponse.json(
            {
              success: false,
              error: "Product not found",
            },
            { status: 404, headers }
          );
        }

        if (error.code === "P2003") {
          return NextResponse.json(
            {
              success: false,
              error: "Product is referenced by another record",
            },
            { status: 409, headers }
          );
        }
      }

      throw error;
    }
  } catch (error) {
    console.error("[DELETE PRODUCT]", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete product",
      },
      { status: 500, headers }
    );
  }
}
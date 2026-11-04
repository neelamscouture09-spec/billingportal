
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { prisma } from "../../../../../../lib/prisma";
import {
  corsHeaders,
  corsOptions,
} from "../../../../../../lib/cors";

type Context = {
  params: Promise<{
    id: string;
    codeId: string;
  }>;
};

// ------------------------------------------------------------
// CORS PREFLIGHT
// ------------------------------------------------------------
export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

// ------------------------------------------------------------
// PATCH - UPDATE SUPPLIER CODE
// PATCH /api/suppliers/:id/codes/:codeId
// ------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: Context
) {
  const headers = corsHeaders(request);

  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers });

  try {
    const { id, codeId } = await params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return respond(
        {
          success: false,
          error: "Invalid JSON body.",
        },
        400
      );
    }

    const input =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const code = input.code;

    if (
      typeof code !== "string" ||
      !code.trim() ||
      code.trim().length > 80
    ) {
      return respond(
        {
          success: false,
          error:
            "Valid supplier code is required (max 80 characters).",
        },
        400
      );
    }

    const existing = await prisma.supplierCode.findFirst({
      where: {
        id: codeId,
        supplierId: id,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return respond(
        {
          success: false,
          error: "Supplier code not found for this supplier.",
        },
        404
      );
    }

    const supplierCode = await prisma.supplierCode.update({
      where: {
        id: codeId,
        supplierId: id,
      },
      data: {
        code: code.trim().toUpperCase(),
      },
    });

    return respond({
      success: true,
      message: "Supplier code updated successfully.",
      supplierCode,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return respond(
          {
            success: false,
            error: "This supplier code already exists.",
          },
          409
        );
      }

      if (error.code === "P2025") {
        return respond(
          {
            success: false,
            error: "Supplier code not found.",
          },
          404
        );
      }
    }

    console.error("[UPDATE SUPPLIER CODE]", error);

    return respond(
      {
        success: false,
        error: "Failed to update supplier code.",
      },
      500
    );
  }
}

// ------------------------------------------------------------
// DELETE - DELETE SUPPLIER CODE
// DELETE /api/suppliers/:id/codes/:codeId
// ------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: Context
) {
  const headers = corsHeaders(request);

  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers });

  try {
    const { id, codeId } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.supplierCode.findFirst({
        where: {
          id: codeId,
          supplierId: id,
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        return "NOT_FOUND";
      }

      const productCount = await tx.product.count({
        where: {
          supplierCodeId: codeId,
        },
      });

      if (productCount > 0) {
        return "IN_USE";
      }

      await tx.supplierCode.delete({
        where: {
          id: codeId,
          supplierId: id,
        },
      });

      return "DELETED";
    });

    if (result === "NOT_FOUND") {
      return respond(
        {
          success: false,
          error: "Supplier code not found.",
        },
        404
      );
    }

    if (result === "IN_USE") {
      return respond(
        {
          success: false,
          error:
            "This supplier code is linked to products. Reassign those products before deleting it.",
        },
        409
      );
    }

    return respond({
      success: true,
      message: "Supplier code deleted successfully.",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        return respond(
          {
            success: false,
            error: "Supplier code is still linked to a product.",
          },
          409
        );
      }

      if (error.code === "P2025") {
        return respond(
          {
            success: false,
            error: "Supplier code not found.",
          },
          404
        );
      }
    }

    console.error("[DELETE SUPPLIER CODE]", error);

    return respond(
      {
        success: false,
        error: "Failed to delete supplier code.",
      },
      500
    );
  }
}

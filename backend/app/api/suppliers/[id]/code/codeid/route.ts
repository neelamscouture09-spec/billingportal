
import { NextResponse } from "next/server";
import { Prisma } from "../../../.././../../generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{
    id: string;
    codeId: string;
  }>;
};

// ------------------------------------------------------------
// PATCH - UPDATE SUPPLIER CODE
// PATCH /api/suppliers/:id/codes/:codeId
// ------------------------------------------------------------
export async function PATCH(
  request: Request,
  { params }: Context
) {
  const { id, codeId } = await params;

  try {
    const body = await request.json();

    if (
      typeof body?.code !== "string" ||
      !body.code.trim() ||
      body.code.trim().length > 80
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Valid supplier code is required (max 80 characters).",
        },
        { status: 400 }
      );
    }

    const existing = await prisma.supplierCode.findFirst({
      where: {
        id: codeId,
        supplierId: id,
      },
    });

    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: "Supplier code not found for this supplier.",
        },
        { status: 404 }
      );
    }

    const supplierCode = await prisma.supplierCode.update({
      where: {
        id: codeId,
        supplierId: id,
      },
      data: {
        code: body.code.trim().toUpperCase(),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Supplier code updated successfully.",
      supplierCode,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            error: "This supplier code already exists.",
          },
          { status: 409 }
        );
      }

      if (error.code === "P2025") {
        return NextResponse.json(
          {
            success: false,
            error: "Supplier code not found.",
          },
          { status: 404 }
        );
      }
    }

    console.error("[UPDATE SUPPLIER CODE]", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to update supplier code.",
      },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// DELETE - DELETE SUPPLIER CODE
// DELETE /api/suppliers/:id/codes/:codeId
// ------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: Context
) {
  const { id, codeId } = await params;

  try {
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.supplierCode.findFirst({
        where: {
          id: codeId,
          supplierId: id,
        },
        select: { id: true },
      });

      if (!existing) return "NOT_FOUND";

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
      return NextResponse.json(
        {
          success: false,
          error: "Supplier code not found.",
        },
        { status: 404 }
      );
    }

    if (result === "IN_USE") {
      return NextResponse.json(
        {
          success: false,
          error:
            "This supplier code is linked to products. Reassign those products before deleting it.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Supplier code deleted successfully.",
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Supplier code is still linked to a product.",
        },
        { status: 409 }
      );
    }

    console.error("[DELETE SUPPLIER CODE]", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete supplier code.",
      },
      { status: 500 }
    );
  }
}

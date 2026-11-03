
import { NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ id: string }>;
};

const includeCodes = {
  codes: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.SupplierInclude;

// GET /api/suppliers/:id
export async function GET(
  _request: Request,
  { params }: Context
) {
  const { id } = await params;

  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: includeCodes,
    });

    if (!supplier) {
      return NextResponse.json(
        { success: false, error: "Supplier not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    console.error("[GET SUPPLIER]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch supplier." },
      { status: 500 }
    );
  }
}

// PATCH /api/suppliers/:id
export async function PATCH(
  request: Request,
  { params }: Context
) {
  const { id } = await params;

  try {
    const body = await request.json();

    if (
      typeof body?.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 180
    ) {
      return NextResponse.json(
        { success: false, error: "Valid supplier name required." },
        { status: 400 }
      );
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: { name: body.name.trim() },
      include: includeCodes,
    });

    return NextResponse.json({
      success: true,
      supplier,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json(
          { success: false, error: "Supplier not found." },
          { status: 404 }
        );
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { success: false, error: "Supplier name already exists." },
          { status: 409 }
        );
      }
    }

    console.error("[UPDATE SUPPLIER]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update supplier." },
      { status: 500 }
    );
  }
}

// DELETE /api/suppliers/:id
export async function DELETE(
  _request: Request,
  { params }: Context
) {
  const { id } = await params;

  try {
    const result = await prisma.$transaction(async tx => {
      const supplier = await tx.supplier.findUnique({
        where: { id },
        include: { codes: { select: { id: true } } },
      });

      if (!supplier) {
        return "NOT_FOUND";
      }

      const codeIds = supplier.codes.map(c => c.id);

      if (codeIds.length > 0) {
        const productCount = await tx.product.count({
          where: { supplierCodeId: { in: codeIds } },
        });

        if (productCount > 0) {
          return "IN_USE";
        }
      }

      await tx.supplier.delete({ where: { id } });
      return "DELETED";
    });

    if (result === "NOT_FOUND") {
      return NextResponse.json(
        { success: false, error: "Supplier not found." },
        { status: 404 }
      );
    }

    if (result === "IN_USE") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cannot delete this supplier because its codes are linked to products. Reassign those products first.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Supplier and its unused codes deleted.",
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        { success: false, error: "Supplier is still in use." },
        { status: 409 }
      );
    }

    console.error("[DELETE SUPPLIER]", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete supplier." },
      { status: 500 }
    );
  }
}

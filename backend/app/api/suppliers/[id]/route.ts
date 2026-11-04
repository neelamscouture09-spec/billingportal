
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../../lib/prisma";
import {
  corsHeaders,
  corsOptions,
} from "../../../../lib/cors";

type Context = {
  params: Promise<{ id: string }>;
};

// ------------------------------------------------------------
// PRISMA RELATIONS
// ------------------------------------------------------------
const includeCodes = {
  codes: {
    orderBy: {
      createdAt: "asc",
    },
  },
} satisfies Prisma.SupplierInclude;

// ------------------------------------------------------------
// CORS PREFLIGHT
// OPTIONS /api/suppliers/:id
// ------------------------------------------------------------
export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

// ------------------------------------------------------------
// GET - FETCH SUPPLIER
// GET /api/suppliers/:id
// ------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: Context
) {
  const headers = corsHeaders(request);

  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers });

  try {
    const { id } = await params;

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: includeCodes,
    });

    if (!supplier) {
      return respond(
        {
          success: false,
          error: "Supplier not found.",
        },
        404
      );
    }

    return respond({
      success: true,
      supplier,
    });
  } catch (error) {
    console.error("[GET SUPPLIER]", error);

    return respond(
      {
        success: false,
        error: "Failed to fetch supplier.",
      },
      500
    );
  }
}

// ------------------------------------------------------------
// PATCH - UPDATE SUPPLIER
// PATCH /api/suppliers/:id
// ------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: Context
) {
  const headers = corsHeaders(request);

  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers });

  try {
    const { id } = await params;

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

    const name = input.name;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 180
    ) {
      return respond(
        {
          success: false,
          error: "Valid supplier name required (max 180 characters).",
        },
        400
      );
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: name.trim(),
      },
      include: includeCodes,
    });

    return respond({
      success: true,
      supplier,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return respond(
          {
            success: false,
            error: "Supplier not found.",
          },
          404
        );
      }

      if (error.code === "P2002") {
        return respond(
          {
            success: false,
            error: "Supplier name already exists.",
          },
          409
        );
      }
    }

    console.error("[UPDATE SUPPLIER]", error);

    return respond(
      {
        success: false,
        error: "Failed to update supplier.",
      },
      500
    );
  }
}

// ------------------------------------------------------------
// DELETE - DELETE SUPPLIER
// DELETE /api/suppliers/:id
// ------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: Context
) {
  const headers = corsHeaders(request);

  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers });

  try {
    const { id } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id },
        include: {
          codes: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!supplier) {
        return "NOT_FOUND";
      }

      const codeIds = supplier.codes.map((code) => code.id);

      if (codeIds.length > 0) {
        const productCount = await tx.product.count({
          where: {
            supplierCodeId: {
              in: codeIds,
            },
          },
        });

        if (productCount > 0) {
          return "IN_USE";
        }
      }

      // Delete unused supplier codes before deleting supplier.
      // This avoids relying on database cascade configuration.
      if (codeIds.length > 0) {
        await tx.supplierCode.deleteMany({
          where: {
            supplierId: id,
          },
        });
      }

      await tx.supplier.delete({
        where: { id },
      });

      return "DELETED";
    });

    if (result === "NOT_FOUND") {
      return respond(
        {
          success: false,
          error: "Supplier not found.",
        },
        404
      );
    }

    if (result === "IN_USE") {
      return respond(
        {
          success: false,
          error:
            "Cannot delete this supplier because its codes are linked to products. Reassign those products first.",
        },
        409
      );
    }

    return respond({
      success: true,
      message: "Supplier and its unused codes deleted.",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        return respond(
          {
            success: false,
            error: "Supplier is still in use.",
          },
          409
        );
      }

      if (error.code === "P2025") {
        return respond(
          {
            success: false,
            error: "Supplier not found.",
          },
          404
        );
      }
    }

    console.error("[DELETE SUPPLIER]", error);

    return respond(
      {
        success: false,
        error: "Failed to delete supplier.",
      },
      500
    );
  }
}

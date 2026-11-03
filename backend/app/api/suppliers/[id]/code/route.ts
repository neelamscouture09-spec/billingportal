
import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ id: string }>;
};

// POST /api/suppliers/:id/codes
export async function POST(
  request: Request,
  { params }: Context
) {
  const { id: supplierId } = await params;

  try {
    const body = await request.json();
    const code = body?.code;

    if (
      typeof code !== "string" ||
      !code.trim() ||
      code.trim().length > 80
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Supplier code must contain 1–80 characters.",
        },
        { status: 400 }
      );
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });

    if (!supplier) {
      return NextResponse.json(
        { success: false, error: "Supplier not found." },
        { status: 404 }
      );
    }

    const supplierCode = await prisma.supplierCode.create({
      data: {
        code: code.trim().toUpperCase(),
        supplierId,
      },
      include: {
        supplier: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(
      { success: true, supplierCode },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            error: "This code already exists for this supplier.",
          },
          { status: 409 }
        );
      }
      if (error.code === "P2003") {
        return NextResponse.json(
          { success: false, error: "Supplier no longer exists." },
          { status: 404 }
        );
      }
    }

    console.error("[CREATE SUPPLIER CODE]", error);
    return NextResponse.json(
      { success: false, error: "Failed to create supplier code." },
      { status: 500 }
    );
  }
}

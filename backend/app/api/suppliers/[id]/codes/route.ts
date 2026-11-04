
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { prisma } from "../../../../../lib/prisma";
import {
  corsHeaders,
  corsOptions,
} from "../../../../../lib/cors";

type Context = {
  params: Promise<{ id: string }>;
};

// Handle browser CORS preflight requests.
export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

// POST /api/suppliers/:id/codes
export async function POST(
  request: NextRequest,
  { params }: Context
) {
  const headers = corsHeaders(request);

  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers,
    });

  try {
    const { id: supplierId } = await params;

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
          error: "Supplier code must contain 1–80 characters.",
        },
        400
      );
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
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

    const supplierCode = await prisma.supplierCode.create({
      data: {
        code: code.trim().toUpperCase(),
        supplierId,
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return respond(
      {
        success: true,
        supplierCode,
      },
      201
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return respond(
          {
            success: false,
            error: "This code already exists for this supplier.",
          },
          409
        );
      }

      if (error.code === "P2003") {
        return respond(
          {
            success: false,
            error: "Supplier no longer exists.",
          },
          404
        );
      }
    }

    console.error("[CREATE SUPPLIER CODE]", error);

    return respond(
      {
        success: false,
        error: "Failed to create supplier code.",
      },
      500
    );
  }
}

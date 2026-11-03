
import { NextRequest } from "next/server";

import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../../lib/prisma";

import {
  corsJson,
  corsOptions,
} from "../../../lib/cors";


// ============================================================
// PRISMA RELATIONS
// ============================================================

const includeCodes = {
  codes: {
    orderBy: {
      createdAt: "asc",
    },
  },
} satisfies Prisma.SupplierInclude;

// ============================================================
// OPTIONS /api/suppliers
// ============================================================

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

// ============================================================
// ERROR HANDLING
// ============================================================

function errorResponse(
  request: NextRequest,
  error: unknown
) {
  if (
    error instanceof
    Prisma.PrismaClientKnownRequestError
  ) {
    if (error.code === "P2002") {
      return corsJson(
        request,
        {
          success: false,
          error: "Supplier already exists.",
        },
        409
      );
    }
  }

  console.error("[SUPPLIERS API ERROR]", error);

  return corsJson(
    request,
    {
      success: false,
      error: "Internal server error.",
    },
    500
  );
}

// ============================================================
// GET /api/suppliers
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: includeCodes,

      orderBy: {
        createdAt: "desc",
      },
    });

    const totalCodes = suppliers.reduce(
      (sum, supplier) =>
        sum + supplier.codes.length,
      0
    );

    return corsJson(request, {
      success: true,
      count: suppliers.length,
      totalCodes,
      suppliers,
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}

// ============================================================
// POST /api/suppliers
// ============================================================

export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return corsJson(
        request,
        {
          success: false,
          error: "Invalid JSON body.",
        },
        400
      );
    }

    const name =
      body &&
      typeof body === "object" &&
      "name" in body
        ? (body as { name: unknown }).name
        : undefined;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 180
    ) {
      return corsJson(
        request,
        {
          success: false,
          error:
            "Supplier name must contain 1–180 characters.",
        },
        400
      );
    }

    const supplier = await prisma.supplier.create({
      data: {
        name: name.trim(),
      },

      include: includeCodes,
    });

    return corsJson(
      request,
      {
        success: true,
        supplier,
        message: "Supplier created successfully.",
      },
      201
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}

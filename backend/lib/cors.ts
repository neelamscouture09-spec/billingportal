
import { NextRequest, NextResponse } from "next/server";

// ============================================================
// PUBLIC CORS CONFIGURATION
// ============================================================

export function corsHeaders(
  _request: NextRequest
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET, POST, PATCH, PUT, DELETE, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept",

    "Access-Control-Max-Age": "86400",
  };
}

// ============================================================
// OPTIONS PREFLIGHT
// ============================================================

export function corsOptions(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

// ============================================================
// JSON RESPONSE WITH CORS
// ============================================================

export function corsJson(
  request: NextRequest,
  data: unknown,
  status = 200
) {
  return NextResponse.json(data, {
    status,
    headers: corsHeaders(request),
  });
}

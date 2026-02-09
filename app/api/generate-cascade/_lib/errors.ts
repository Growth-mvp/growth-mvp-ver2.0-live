/**
 * _lib/errors.ts
 * Error formatting and HTTP response conversion
 */

import { NextResponse } from 'next/server';

/**
 * Convert error to HTTP response
 */
export function toHttpResponse(error: any): NextResponse {
  const message = error?.message || String(error);
  const statusCode = 400;

  return NextResponse.json(
    {
      error: message,
    },
    {
      status: statusCode,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}

// app/api/knowledge/route.ts - DEPRECATED: this endpoint is no longer in use
// Knowledge is managed through growthKnowledge and RAG index instead
// This file remains for backwards compatibility but both GET/POST return 410 Gone

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: 'This endpoint is deprecated. Use growthKnowledge or RAG instead.' },
    { status: 410 }
  )
}

export async function GET() {
  return NextResponse.json(
    { error: 'This endpoint is deprecated. Use growthKnowledge or RAG instead.' },
    { status: 410 }
  )
}

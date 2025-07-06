// app/api/knowledge/route.ts
import { NextRequest, NextResponse } from 'next/server'

// 保存用の仮データ（アプリ再起動で消えます。将来DBに移行可）
let knowledgeStore: any = {}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    knowledgeStore = { ...data } // 上書き保存（MVP用）
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('保存エラー:', e)
    return NextResponse.json({ success: false, error: '保存に失敗しました' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json(knowledgeStore || {})
}

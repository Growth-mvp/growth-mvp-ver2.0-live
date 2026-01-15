// /app/api/market/pbr/route.ts
import { NextResponse } from 'next/server';

/**
 * PBR スタブAPI
 *
 * GET /api/market/pbr?ticker=7203
 *
 * 将来的には Yahoo Finance や Bloomberg API などと連携予定。
 * 現在はダミーデータを返すスタブ実装。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker')?.trim() ?? '';

  if (!ticker) {
    return NextResponse.json(
      { error: 'ticker parameter is required' },
      { status: 400 }
    );
  }

  // ========================================
  // スタブ実装：ダミーデータを返す
  // ========================================

  // 有名企業のダミー PBR データ
  const mockPbrData: Record<string, number> = {
    // 日本株（ティッカーは証券コード）
    '7203': 1.05,   // トヨタ自動車
    '9984': 1.42,   // ソフトバンクグループ
    '6758': 2.15,   // ソニーグループ
    '6861': 4.32,   // キーエンス
    '6902': 0.95,   // デンソー
    '9432': 1.18,   // NTT
    '6501': 1.82,   // 日立製作所
    '8306': 0.78,   // 三菱UFJ
    '7974': 6.45,   // 任天堂
    '4063': 2.87,   // 信越化学
    // 米国株
    'AAPL': 45.2,
    'MSFT': 12.8,
    'GOOGL': 6.5,
    'AMZN': 8.2,
    'TSLA': 15.4,
  };

  const pbr = mockPbrData[ticker.toUpperCase()] ?? null;

  // ランダムに遅延を入れてAPI風にする
  await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 200));

  if (pbr === null) {
    return NextResponse.json(
      {
        ticker,
        pbr: null,
        message: `No data found for ticker: ${ticker}. This is a stub API.`,
        isStub: true,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ticker,
    pbr,
    currency: ticker.length === 4 ? 'JPY' : 'USD',
    fetchedAt: new Date().toISOString(),
    isStub: true,
    message: 'This is mock data from stub API. Real market data integration coming soon.',
  });
}

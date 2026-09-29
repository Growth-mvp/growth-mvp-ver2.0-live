/**
 * 外部決算情報検索
 * 公開企業の最新決算情報を取得
 * Tavily Search API で決算資料を検索
 */

export interface ExternalFinancialData {
  companyName: string;
  fiscalYear?: string;      // 決算期（例：2024年3月期）
  fiscalEndDate?: string;   // 決算日（例：2024-03-31）
  disclosureDate?: string;  // 開示日（例：2024-05-15）
  documentUrl?: string;     // 決算資料URL
  revenue?: number;         // 売上高（円）
  operatingIncome?: number; // 営業利益（円）
  netIncome?: number;       // 当期純利益（円）
  source: 'tavily' | 'edinet' | 'company_ir' | 'web_search' | 'mock' | 'none';
  sourceLabel: string;      // 出所表記（例：「日本製罐 2024年3月期決算説明資料」）
}

/**
 * Tavily Search API で決算情報を検索
 */
async function searchWithTavily(companyName: string): Promise<ExternalFinancialData | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.log('[externalFinancialSearch] TAVILY_API_KEY not set, skipping Tavily search');
    return null;
  }

  try {
    console.log('[externalFinancialSearch] Searching Tavily for:', companyName);

    // Tavily API を呼び出し（決算資料を検索）
    const query = `${companyName} 決算説明資料 決算短信 フィリング site:edinet-fsa.go.jp OR site:ir.co.jp OR site:investors`;

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        include_answer: true,
        max_results: 5,
      }),
    });

    if (!response.ok) {
      console.error('[externalFinancialSearch] Tavily API error:', response.status);
      return null;
    }

    const result = await response.json();
    console.log('[externalFinancialSearch] Tavily results:', {
      query,
      resultCount: result.results?.length || 0,
    });

    // 検索結果から決算資料を抽出
    if (!result.results || result.results.length === 0) {
      return null;
    }

    // 最初の結果から情報を抽出
    const firstResult = result.results[0];
    return {
      companyName,
      documentUrl: firstResult.url,
      sourceLabel: `${companyName} 決算資料（${firstResult.source || 'Web検索'}）`,
      source: 'tavily',
    };
  } catch (error) {
    console.error('[externalFinancialSearch] Tavily search error:', error);
    return null;
  }
}

/**
 * 外部決算情報を検索
 * Tavily API で公開決算資料を検索
 */
export async function searchExternalFinancialData(
  companyName: string,
): Promise<ExternalFinancialData | null> {
  try {
    console.log('[externalFinancialSearch] Searching for:', companyName);

    // ★ Tavily API で検索（TAVILY_API_KEY 設定時）
    const tavilyResult = await searchWithTavily(companyName);
    if (tavilyResult) {
      return tavilyResult;
    }

    // Tavily が利用不可の場合は null を返す（STAGE1 登録データのみ使用）
    console.log('[externalFinancialSearch] No external data found');
    return null;
  } catch (error) {
    console.error('[externalFinancialSearch] Error:', error);
    return null;
  }
}

/**
 * 外部財務データをプロンプト用ブロックにフォーマット
 */
export function buildExternalFinancialBlock(extData: ExternalFinancialData): string {
  const lines: string[] = ['【外部決算情報（最新取得）】'];

  if (extData.fiscalYear) {
    lines.push(`決算期：${extData.fiscalYear}`);
  }
  if (extData.disclosureDate) {
    lines.push(`開示日：${extData.disclosureDate}`);
  }
  if (extData.documentUrl) {
    lines.push(`資料：${extData.documentUrl}`);
  }

  const financialLines: string[] = [];
  if (extData.revenue !== undefined) {
    financialLines.push(`売上高：${formatExternalAmount(extData.revenue)}`);
  }
  if (extData.operatingIncome !== undefined) {
    financialLines.push(`営業利益：${formatExternalAmount(extData.operatingIncome)}`);
  }
  if (extData.netIncome !== undefined) {
    financialLines.push(`当期純利益：${formatExternalAmount(extData.netIncome)}`);
  }

  if (financialLines.length > 0) {
    lines.push('財務数値：');
    lines.push(...financialLines.map((l) => `  ${l}`));
  }

  if (extData.sourceLabel) {
    lines.push(`出所：${extData.sourceLabel}`);
  }

  return lines.join('\n');
}

function formatExternalAmount(n: number): string {
  if (n === 0) return '0円';
  const absN = Math.abs(n);
  if (absN >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}十億円`;
  if (absN >= 1_000_000) return `${(n / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円`;
  if (absN >= 1_000) return `${(n / 1_000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}千円`;
  return `${n}円`;
}

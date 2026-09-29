/**
 * 外部決算情報検索
 * OpenAI Responses API を使用した Web 検索
 * 公開企業の決算資料URL と情報を取得
 */

import { OpenAI } from 'openai';

export interface ExternalFinancialData {
  companyName: string;
  fiscalYear?: string;      // 決算期（例：2024年3月期）
  disclosureDate?: string;  // 開示日（例：2024-05-15）
  documentUrl?: string;     // 決算資料URL
  irPageUrl?: string;       // IR トップページ URL
  revenue?: number;         // 売上高（円）
  operatingIncome?: number; // 営業利益（円）
  netIncome?: number;       // 当期純利益（円）
  source: 'openai_responses' | 'edinet' | 'company_ir' | 'none';
  sourceLabel: string;      // 出所表記
}

/**
 * OpenAI Responses API で決算資料を検索
 * 最小限の情報（企業名）のみを使用
 */
async function searchWithResponsesAPI(companyName: string): Promise<ExternalFinancialData | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[externalFinancialSearch] OPENAI_API_KEY not set');
    return null;
  }

  try {
    console.log('[externalFinancialSearch] Searching with OpenAI Responses API for:', companyName);

    const openai = new OpenAI({ apiKey });

    // ★ 最小限の検索クエリ：企業名のみ
    const searchQuery = `${companyName} 決算説明資料`;

    const response = await openai.responses.create({
      model: 'gpt-4o',
      tools: [{ type: 'web_search' }],
      input: searchQuery,
    });

    console.log('[externalFinancialSearch] Responses API status:', {
      status: (response as any).status,
      completed: (response as any).completed_at ? true : false,
    });

    if ((response as any).status !== 'completed') {
      console.log('[externalFinancialSearch] Search not completed');
      return null;
    }

    // レスポンスから URL を抽出
    const output = (response as any).output;
    if (!output || output.length === 0) {
      console.log('[externalFinancialSearch] No output from Responses API');
      return null;
    }

    const outputText = output[0]?.text || '';
    console.log('[externalFinancialSearch] Search result preview:', outputText.slice(0, 200));

    // URL を抽出（IR ページと決算資料）
    const urlRegex = /https?:\/\/[^\s"\n））》」、。，，；：）]+/g;
    const urls = outputText.match(urlRegex) || [];

    if (urls.length === 0) {
      console.log('[externalFinancialSearch] No URLs found in response');
      return null;
    }

    console.log('[externalFinancialSearch] Found URLs:', urls.slice(0, 3));

    // IR ページを優先、次に決算資料を検索
    const irPageUrl = urls.find(url => url.includes('ir.') || url.includes('/ir/'));
    const decisanUrl = urls.find(url => url.includes('pdf') || url.includes('決算'));
    const primaryUrl = decisanUrl || irPageUrl;

    if (!primaryUrl) {
      console.log('[externalFinancialSearch] No suitable URL found');
      return null;
    }

    return {
      companyName,
      documentUrl: primaryUrl,
      irPageUrl: irPageUrl,
      sourceLabel: `${companyName} 決算資料（Web検索）`,
      source: 'openai_responses',
    };
  } catch (error) {
    console.error('[externalFinancialSearch] Responses API error:', error);
    return null;
  }
}

/**
 * 外部決算情報を検索
 * OpenAI Responses API で決算資料 URL を取得
 */
export async function searchExternalFinancialData(
  companyName: string,
): Promise<ExternalFinancialData | null> {
  try {
    console.log('[externalFinancialSearch] Searching for:', companyName);

    // ★ OpenAI Responses API で検索
    const result = await searchWithResponsesAPI(companyName);
    if (result) {
      return result;
    }

    // 検索失敗時は null を返す（STAGE1 登録データのみ使用）
    console.log('[externalFinancialSearch] No external data found');
    return null;
  } catch (error) {
    console.error('[externalFinancialSearch] Error:', error);
    return null;
  }
}

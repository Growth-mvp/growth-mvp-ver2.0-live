/**
 * 外部決算情報検索
 * 公開企業の最新決算情報を取得
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
  source: 'jquants' | 'edinet' | 'company_ir' | 'web_search' | 'mock';
  sourceLabel: string;      // 出所表記（例：「日本製罐 IR「2024年3月期決算説明資料」」）
}

/**
 * 外部決算情報を検索
 * 現在は mock data で実装（将来：EDINETやJQuantsなどのAPI連携）
 */
export async function searchExternalFinancialData(
  companyName: string,
): Promise<ExternalFinancialData | null> {
  try {
    console.log('[externalFinancialSearch] Searching for:', companyName);

    // ★ 日本製罐の mock data（開発用）
    if (companyName.includes('日本製罐') || companyName.includes('Nippon')) {
      // 実際の実装では、以下のようなAPI呼び出しを行う：
      // 1. EDINET API で提出書類を検索
      // 2. 企業のIR Webサイトから決算資料を取得
      // 3. 財務数値を抽出

      // TODO: 実装予定のAPI呼び出し
      // const result = await fetchFromEdinet(companyName);
      // const result = await fetchFromCompanyIR(companyName);

      // 現在は null を返す（外部検索機能は検索失敗と扱う）
      console.log('[externalFinancialSearch] Mock mode - returning null for development');
      return null;
    }

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

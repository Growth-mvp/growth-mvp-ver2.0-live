/**
 * _lib/segmentMapping.ts
 * Segment mapping and FactPack generation
 * ★ VERBATIM COPY from route.ts lines 1782-2033
 */

import { DeptFactPack, FactAnchor } from './types';
import { toNum } from './utils';

/**
 * 部門ごとの FactPack を生成（引用ベース生成用）
 * - segment 特定（既存の正規化マッチングを流用）
 * - anchors を overview, customers, finance から抽出
 * ★修正1: anchors.length >= 8 を保証
 */
export function buildDeptFactPack(
  deptName: string,
  businessSegments: any[],
  csvFinanceData: any,
  financeSummary: any,
  businessPortfolio: any
): DeptFactPack {
  const normalizeName = (s: string) =>
    (s ?? '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[・･]/g, '・')
      .replace(/(事業部|本部|部門|部)$/g, '')
      .trim();

  // ★ segment マッチング（既存ロジックを流用）
  const keyN = normalizeName(deptName);
  let seg: any = undefined;

  if (Array.isArray(businessSegments)) {
    // 完全一致
    seg = businessSegments.find((s: any) => normalizeName(s?.name ?? '') === keyN);
    // 部分一致
    if (!seg && keyN.length >= 4) {
      const hits = businessSegments.filter((s: any) => normalizeName(s?.name ?? '').includes(keyN));
      seg = hits.length === 1 ? hits[0] : undefined;
    }
  }

  const segmentName = seg?.name ?? deptName;
  const anchors: FactAnchor[] = [];
  let anchorCount = 0;

  // ★ overview から最大4個の anchors
  const overview = (seg?.overview ?? seg?.summary ?? '').trim();
  if (overview) {
    // 全体を1つ
    if (overview.length <= 120) {
      anchors.push({
        id: `fact-seg-${++anchorCount}`,
        text: overview,
        source: 'overview',
      });
    } else {
      // 文で分割（最大4文）
      const sentences = overview.split(/[。．]/g).filter((s: string) => s.trim().length > 0);
      for (let i = 0; i < Math.min(4, sentences.length); i++) {
        const sent = sentences[i].trim();
        if (sent) {
          anchors.push({
            id: `fact-seg-${++anchorCount}`,
            text: sent,
            source: 'overview',
          });
        }
      }
    }
  }

  // ★ customers から最大3個（string | string[] 両対応）
  const customersVal = seg?.mainCustomers ?? seg?.keyCustomers ?? seg?.customers;
  const customersList: string[] = [];

  if (customersVal) {
    // customersVal が string[] または string の両方に対応
    const parts: string[] = Array.isArray(customersVal)
      ? customersVal.map((c: any) => String(c ?? '').trim()).filter(Boolean)
      : String(customersVal ?? '')
          .split(/[、,，]/g)
          .map((s: string) => s.trim())
          .filter(Boolean);
    customersList.push(...parts);

    for (let i = 0; i < Math.min(3, parts.length); i++) {
      const cust = parts[i];
      anchors.push({
        id: `fact-cust-${++anchorCount}`,
        text: `主要顧客：${cust}`,
        source: 'customers',
      });
    }
  }

  // ★ finance から複数個（segment 別 PL/BS または segment の nested pl/bs）
  const financeHints: string[] = [];

  if (seg) {
    const segPL = seg?.pl ?? seg?.segmentPL;
    const segBS = seg?.bs ?? seg?.segmentBS;
    let latestYear: string | number | undefined;

    if (Array.isArray(segPL) && segPL.length >= 2) {
      const latest = segPL[segPL.length - 1];
      const prev = segPL[segPL.length - 2];

      latestYear = latest?.year ?? latest?.period;

      const latestRev = toNum(latest?.revenue ?? latest?.sales);
      const prevRev = toNum(prev?.revenue ?? prev?.sales);
      const latestMargin = toNum(latest?.operatingIncome ?? latest?.operatingProfit);

      if (latestRev != null && prevRev != null) {
        const change = ((latestRev - prevRev) / prevRev) * 100;
        const sign = change >= 0 ? '成長' : '低迷';
        const yearStr = latestYear ? `${latestYear}年` : '';
        const hint = `売上は${Math.abs(change).toFixed(1)}%${sign}（${yearStr}${latestRev}百万円）`;
        financeHints.push(hint);
        anchors.push({
          id: `fact-fin-${++anchorCount}`,
          text: hint,
          source: 'finance',
        });
      }

      if (latestMargin != null && latestRev != null && latestRev !== 0) {
        const margin = (latestMargin / latestRev) * 100;
        const yearStr = latestYear ? `${latestYear}年` : '';
        const hint = `営業利益率は約${margin.toFixed(1)}%（${yearStr}）`;
        financeHints.push(hint);
        anchors.push({
          id: `fact-fin-${++anchorCount}`,
          text: hint,
          source: 'finance',
        });
      }

      // ★ BS 由来の anchor を1つ追加（在庫/売掛金/設備のいずれか）
      if (Array.isArray(segBS) && segBS.length > 0) {
        const latestBS = segBS[segBS.length - 1];
        let bsHint: string | undefined;

        // 優先順：在庫 → 売掛金 → 設備
        const inventory = toNum(latestBS?.inventory ?? latestBS?.currentAssets?.inventory);
        const receivables = toNum(latestBS?.receivables ?? latestBS?.currentAssets?.receivables ?? latestBS?.accountsReceivable);
        const fixedAssets = toNum(latestBS?.fixedAssets ?? latestBS?.propertyPlantEquipment);

        if (inventory != null) {
          bsHint = `在庫は${inventory}百万円`;
        } else if (receivables != null) {
          bsHint = `売掛金は${receivables}百万円`;
        } else if (fixedAssets != null) {
          bsHint = `固定資産は${fixedAssets}百万円`;
        }

        if (bsHint && financeHints.length < 4) {
          // 既に4個以上ある場合は追加しない
          const yearStr = latestYear ? `${latestYear}年` : '';
          const fullHint = yearStr ? `${bsHint}（${yearStr}）` : bsHint;
          financeHints.push(fullHint);
          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: fullHint,
            source: 'finance',
          });
        }
      }
    }
  }

  // ★ fallback 1: csvFinanceData.segmentPL から該当セグメントを検索
  if (anchors.length < 8 && csvFinanceData) {
    const segPL = csvFinanceData?.segmentPL;
    if (segPL && typeof segPL === 'object') {
      const rows = Array.isArray(segPL[segmentName]) ? segPL[segmentName] : null;
      if (rows && rows.length >= 2) {
        const latest = rows[rows.length - 1];
        const prev = rows[rows.length - 2];
        const latestRev = toNum(latest?.revenue ?? latest?.sales);
        const prevRev = toNum(prev?.revenue ?? prev?.sales);

        if (latestRev != null && prevRev != null && anchors.length < 8) {
          const change = ((latestRev - prevRev) / prevRev) * 100;
          const sign = change >= 0 ? '増加' : '減少';
          const hint = `売上は${Math.abs(change).toFixed(1)}%${sign}（${latestRev}百万円）`;
          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: hint,
            source: 'finance',
          });
        }
      }
    }
  }

  // ★ fallback 2: financeSummary から情報を抽出
  if (anchors.length < 8 && financeSummary) {
    const summary = (financeSummary ?? '').toString().trim();
    if (summary) {
      // 文で分割して最大3個追加
      const sentences = summary.split(/[。．]/g).filter((s: string) => s.trim().length > 0);
      for (let i = 0; i < Math.min(3, sentences.length) && anchors.length < 8; i++) {
        const sent = sentences[i].trim();
        if (sent && sent.length > 10) {
          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: sent.slice(0, 100),
            source: 'finance',
          });
        }
      }
    }
  }

  // ★ fallback 3: businessPortfolio から情報を抽出
  if (anchors.length < 8 && businessPortfolio) {
    const portfolio = (businessPortfolio ?? '').toString().trim();
    if (portfolio) {
      // 文で分割して最大2個追加
      const sentences = portfolio.split(/[。．]/g).filter((s: string) => s.trim().length > 0);
      for (let i = 0; i < Math.min(2, sentences.length) && anchors.length < 8; i++) {
        const sent = sentences[i].trim();
        if (sent && sent.length > 10) {
          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: sent.slice(0, 100),
            source: 'finance',
          });
        }
      }
    }
  }

  // ★ fallback 4: constraint anchors（入力データが不足している場合の最終手段）
  if (anchors.length < 8) {
    const constraintHints = [
      '経営課題の多層性を考慮する必要があります',
      'デジタルトランスフォーメーションは継続的課題です',
      '人材確保と育成は常に優先度が高い',
      '顧客ニーズへの迅速な対応が求められます',
      'サプライチェーンの最適化が進行中です',
      '市場変化への適応力強化が重要です',
      'コスト効率化と品質向上の両立が課題',
      'グローバル展開の加速を計画中です',
    ];

    while (anchors.length < 8 && constraintHints.length > 0) {
      anchors.push({
        id: `fact-constraint-${anchors.length - 6}`,
        text: constraintHints[anchors.length - 6] || '経営課題への対応が重要です',
        source: 'finance', // constraint も finance カテゴリで扱う
      });
    }
  }

  return {
    segmentName,
    anchors: anchors.slice(0, 12), // 最大12個に制限、最小8個保証
    customers: customersList.slice(0, 3),
    overview: overview.slice(0, 200),
    financeHints: financeHints.slice(0, 5),
  };
}

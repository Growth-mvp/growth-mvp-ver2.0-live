/* 経営点検の初期表示の要約。AIを呼ばず、点検の判定結果（構造化された値）だけから組み立てる。
 * 詳細（事実・仮説・判断材料不足・点検対象外）は別に保持し、要約では省略しない。 */
import type { RiskStatus } from './companionRisk';

export type RiskHighlights = {
  targetGaps: Array<{ metric: '売上' | '営業利益'; fiscalYear: number | null; gapYen: number }>;
  cashShortfalls: Array<{ year: number; shortfallYen: number }>;
  overdueKrCount: number;
  stalledActionCount: number;
  planGapCount: number;
};

export const NO_HIGHLIGHTS: RiskHighlights = {
  targetGaps: [],
  cashShortfalls: [],
  overdueKrCount: 0,
  stalledActionCount: 0,
  planGapCount: 0,
};

/** 億円・万円の読みやすい表記（例：7000万円、1.8億円） */
export function yenJa(yen: number): string {
  const n = Math.abs(yen);
  if (n >= 1e8) return `${Math.round(n / 1e7) / 10}億円`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ja-JP')}万円`;
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

const GREETING = 'お疲れさまです。御社の経営状況を確認しましたが、少し気になることがあります。';

export function riskSummaryOf(status: RiskStatus, h: RiskHighlights = NO_HIGHLIGHTS): string {
  if (status === 'FAILED') {
    return 'お疲れさまです。経営点検を完了できませんでした。しばらくしてから、「最新の点検を確認」を押してください。';
  }
  if (status === 'NO_ISSUE') {
    return 'お疲れさまです。保存済みの内容を点検しましたが、点検できた範囲では問題は見当たりませんでした。点検していない範囲は、詳細で確認できます。';
  }
  if (status === 'INSUFFICIENT') {
    return 'お疲れさまです。経営状況を確認しようとしましたが、判断に必要な情報が一部不足しているため、まだ結論は出せません。不足している項目は、詳細で確認できます。';
  }

  const paragraphs = [GREETING];
  const hasFinance = h.targetGaps.length > 0 || h.cashShortfalls.length > 0;

  if (h.targetGaps.length > 0) {
    const years = h.targetGaps.map((g) => g.fiscalYear).filter((y): y is number => y !== null);
    const year = years.length > 0 ? Math.min(...years) : null;
    const metrics = [...new Set(h.targetGaps.map((g) => g.metric))];
    const metricText = metrics.length === 2 ? '売上高と営業利益' : metrics[0] === '売上' ? '売上高' : '営業利益';
    const yearText = year !== null ? `${year}年度の` : '';
    const amounts = h.targetGaps.map((g) => `${g.metric === '売上' ? '売上高' : '営業利益'} ${yenJa(g.gapYen)}`);
    paragraphs.push(
      `現在の業績見通しでは、${yearText}経営目標に対して、${metricText}が不足しています。不足額は、${amounts.join('、')}です。`,
    );
  }

  if (h.cashShortfalls.length > 0) {
    const first = h.cashShortfalls.reduce((a, b) => (b.year < a.year ? b : a));
    paragraphs.push(
      `また、${first.year}年度は、資金が最低必要額を${yenJa(first.shortfallYen)}下回る見込みです（資金繰りの試算による見込みで、借入の計画は確定していません）。`,
    );
  }

  const presentKinds = [h.overdueKrCount, h.stalledActionCount, h.planGapCount].filter((n) => n > 0).length;
  let mentionedKinds = 0;
  if (!hasFinance) {
    if (h.overdueKrCount > 0) {
      paragraphs.push(`期限を過ぎた目標（KR）のうち、${h.overdueKrCount}件は、実績が届いていないか、未登録です。`);
      mentionedKinds += 1;
    }
    if (h.stalledActionCount > 0) {
      paragraphs.push(`進行中の実施事項のうち、${h.stalledActionCount}件は30日以上更新がありません。`);
      mentionedKinds += 1;
    }
    if (mentionedKinds === 0 && h.planGapCount > 0) {
      paragraphs.push(`売上効果のうち、${h.planGapCount}件は計画を下回っています。`);
      mentionedKinds += 1;
    }
  }
  const hasOtherPoints = hasFinance ? presentKinds > 0 : presentKinds > mentionedKinds;
  if (hasOtherPoints) paragraphs.push('ほかにも、詳細で確認できる点があります。');

  paragraphs.push(
    hasFinance
      ? '現在の戦略や実行計画で、この差をどのように埋めていくか、一緒に考えてみませんか。'
      : 'まず、どこから手を付けるかを一緒に整理してみませんか。',
  );
  return paragraphs.join('\n\n');
}

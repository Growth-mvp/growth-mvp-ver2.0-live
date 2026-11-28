import { riskSummaryOf, yenJa, type RiskHighlights } from './companionRiskSummary';
import { riskReviewView, type RiskReviewResult } from './companionRiskClient';
import { NOT_CHECKED_NOTE } from './companionRisk';

const NONE: RiskHighlights = { targetGaps: [], cashShortfalls: [], overdueKrCount: 0, stalledActionCount: 0, planGapCount: 0 };

describe('経営点検の要約：金額の表記', () => {
  it('億円・万円の読みやすい表記にする', () => {
    expect(yenJa(70_000_000)).toBe('7,000万円');
    expect(yenJa(18_000_000)).toBe('1,800万円');
    expect(yenJa(100_000_000)).toBe('1億円');
    expect(yenJa(150_000_000)).toBe('1.5億円');
    expect(yenJa(16_760_000)).toBe('1,676万円');
    expect(yenJa(9_000)).toBe('9,000円');
  });
});

describe('経営点検の要約：会話形式の初期表示', () => {
  it('経営目標の未達を、年度・項目・不足額とともに、最初の一文から伝える（表示例に沿う）', () => {
    const text = riskSummaryOf('ISSUES', {
      ...NONE,
      targetGaps: [
        { metric: '売上', fiscalYear: 2029, gapYen: 70_000_000 },
        { metric: '営業利益', fiscalYear: 2029, gapYen: 18_000_000 },
      ],
    });
    expect(text.startsWith('お疲れさまです。御社の経営状況を確認しましたが、少し気になることがあります。')).toBe(true);
    expect(text).toContain('2029年度の経営目標に対して、売上高と営業利益が不足しています。');
    expect(text).toContain('不足額は、売上高 7,000万円、営業利益 1,800万円です。');
    expect(text.endsWith('現在の戦略や実行計画で、この差をどのように埋めていくか、一緒に考えてみませんか。')).toBe(true);
  });

  it('資金不足は、年度と不足額を示し、借入の計画が確定していないことも添える', () => {
    const text = riskSummaryOf('ISSUES', { ...NONE, cashShortfalls: [{ year: 2026, shortfallYen: 16_760_000 }] });
    expect(text).toContain('2026年度は、資金が最低必要額を1,676万円下回る見込みです');
    expect(text).toContain('借入の計画は確定していません');
  });

  it('目標や資金ではなく、期限超過や停滞だけがある場合も、件数で簡潔に伝える', () => {
    const text = riskSummaryOf('ISSUES', { ...NONE, overdueKrCount: 2, stalledActionCount: 1, planGapCount: 1 });
    expect(text).toContain('期限を過ぎた目標（KR）のうち、2件');
    expect(text).toContain('進行中の実施事項のうち、1件');
    expect(text).toContain('ほかにも、詳細で確認できる点があります。');
  });

  it('問題なし・判断材料不足・点検失敗も、簡潔な定型文にし、仮説は含めない', () => {
    for (const status of ['NO_ISSUE', 'INSUFFICIENT', 'FAILED'] as const) {
      const text = riskSummaryOf(status);
      expect(text.startsWith('お疲れさまです。')).toBe(true);
      expect(text).not.toContain('仮説');
      expect(text.length).toBeLessThan(120);
    }
  });
});

describe('経営点検の表示：要約と詳細（詳細は省略しない）', () => {
  const issues: RiskReviewResult = {
    status: 'ISSUES',
    facts: ['- 2027年度：不足'],
    text: '### 仮説\n**2026年度**は不足の可能性があります。',
    serious: true,
    coverage: ['- 実施事項の進捗：未登録（進捗が1件も記録されていません）'],
    aiState: 'GENERATED',
    checkedAt: '2027-06-15T00:05:00Z',
    summary: riskSummaryOf('ISSUES', { ...NONE, targetGaps: [{ metric: '売上', fiscalYear: 2027, gapYen: 70_000_000 }] }),
  };

  it('要約・点検日時は常に表示し、詳細には事実・仮説・判断材料不足・点検していない範囲を残す', () => {
    const view = riskReviewView(issues);
    expect(view.summary).toContain('2027年度の経営目標に対して');
    expect(view.checkedLabel).toContain('点検日時：2027年6月15日 9時05分（日本時間）');
    expect(view.detail).toContain('事実（保存済みデータの計算結果）');
    expect(view.detail).toContain('- 2027年度：不足');
    expect(view.detail).toContain('仮説\n2026年度は不足の可能性があります。');
    expect(view.detail).not.toContain('###');
    expect(view.detail).toContain('判断できなかった項目（理由別）');
    expect(view.detail).toContain('実施事項の進捗：未登録');
    expect(view.detail?.endsWith(NOT_CHECKED_NOTE)).toBe(true);
    expect(view.body).toContain(view.summary);
    expect(view.body).toContain(view.detail!);
  });

  it('点検処理の失敗は、詳細を作らない（所見も事実も作らない）', () => {
    const view = riskReviewView({ status: 'FAILED', facts: [], text: null, serious: false, coverage: [] });
    expect(view.detail).toBeNull();
    expect(view.summary).toContain('完了できませんでした');
  });

  it('問題なしは、要約のあと、点検していない範囲を詳細で確認できる', () => {
    const view = riskReviewView({ status: 'NO_ISSUE', facts: [], text: null, serious: false, coverage: [] });
    expect(view.summary).toContain('問題は見当たりませんでした');
    expect(view.detail).toContain('点検していない範囲');
  });
});

import { classifyStatisticPeriod, countUnmatchedNumbers, productScopesIn, statisticCounts } from './statisticScope';

describe('統計の対象期間の判定（文字列から期間を推定しない）', () => {
  it('1. 暦年の通年と、年の一部だけを対象とする期間を区別する', () => {
    expect(classifyStatisticPeriod('2025年1月〜12月')).toBe('calendar_year');
    expect(classifyStatisticPeriod('2025年1〜12月')).toBe('calendar_year');
    expect(classifyStatisticPeriod('2025年1月〜10月')).toBe('partial');
    expect(classifyStatisticPeriod('2025年1〜10月（累計）')).toBe('partial');
  });

  it('2. 年度の通年と、年度内の部分期間を区別する', () => {
    expect(classifyStatisticPeriod('2025年4月〜2026年3月')).toBe('fiscal_year');
    expect(classifyStatisticPeriod('2025年4月〜2025年9月')).toBe('partial');
  });

  it('3. 月次・上半期・四半期を正しく扱う', () => {
    expect(classifyStatisticPeriod('2025年9月')).toBe('monthly');
    expect(classifyStatisticPeriod('2025年上半期')).toBe('partial');
    expect(classifyStatisticPeriod('2025年第3四半期')).toBe('partial');
  });

  it('4. 対象期間が曖昧なら unknown とし、通年と断定しない', () => {
    expect(classifyStatisticPeriod('2025年')).toBe('unknown');
    expect(classifyStatisticPeriod('2025年度')).toBe('unknown');
    expect(classifyStatisticPeriod('2024年3月期')).toBe('unknown');
    expect(classifyStatisticPeriod('2025年通年')).toBe('unknown');
    expect(classifyStatisticPeriod('')).toBe('unknown');
    expect(classifyStatisticPeriod(null)).toBe('unknown');
    expect(classifyStatisticPeriod('不明')).toBe('unknown');
  });
});

describe('製品区分の扱い（判定できない区分は補わない）', () => {
  it('6. 200L缶と18L缶を別の区分として扱い、同じ区分にしない', () => {
    expect(productScopesIn('200L缶の出荷は2.6%減')).toEqual(['200L缶']);
    expect(productScopesIn('18L缶の出荷は増えた')).toEqual(['18L缶']);
    expect(productScopesIn('一斗缶の出荷は増えた')).toEqual(['18L缶']);
    expect(productScopesIn('200L缶と18L缶')).toEqual(['200L缶', '18L缶']);
  });

  it('7. 製品区分が本文にない場合は、区分を補わない（金属缶を特定区分とみなさない）', () => {
    expect(productScopesIn('金属缶の出荷は2.6%減')).toEqual([]);
    expect(productScopesIn('金属缶市場の出荷は横ばい')).toEqual([]);
  });

  it('統計の件数は、期間の区分と製品区分の取得件数を数える', () => {
    const counts = statisticCounts([
      { text: '200L缶の出荷は2.6%減', period: '2025年1月〜12月' },
      { text: 'ペール缶の出荷は増えた', period: '2025年1月〜10月' },
      { text: '金属缶の出荷は横ばい', period: '2025年9月' },
      { text: '出荷は増えた', period: null },
    ]);
    expect(counts).toEqual({ annual: 1, partial: 1, monthly: 1, unknownPeriod: 1, productScopeKnown: 2 });
  });
});

describe('数値の照合（機械的に照合できる範囲だけ）', () => {
  it('5. 検索で得た事実に現れない数値を数える。日付は数値として扱わない', () => {
    const basis = ['200L缶の出荷は2.6%減', '2025年1月〜10月'];
    expect(countUnmatchedNumbers('200L缶の出荷は2.6%減。2025年1月の状況は不明。', basis)).toBe(0);
    expect(countUnmatchedNumbers('200L缶の出荷は2.6%減、市場は5.0%増。', basis)).toBe(1);
  });

  it('URLは数値として数えない', () => {
    expect(countUnmatchedNumbers('出典: https://example.com/report/2026/5', [])).toBe(0);
  });
});

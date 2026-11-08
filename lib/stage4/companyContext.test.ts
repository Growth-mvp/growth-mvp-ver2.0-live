import type { Department, FinancePLRow } from '@/types/strategy';
import { buildExecutionCompanyContext } from './companyContext';
import { companyContextSection, REASONING_RULES, sanitizeDraftReasoning } from './draftPromptSections';

const M = 1_000_000;

const delivery = {
  name: '物流営業部',
  strategicRole: '法人顧客の新規獲得で、配送量を増やす',
  keyIssues: ['既存配送先の単価が下がっている', '追加配送の費用が見えていない'],
  interDeptCollab: ['配車部と繁忙期の枠を調整'],
  alignmentRiskPoints: ['新規法人の契約条件の決め方'],
  projects: [],
} as unknown as Department;

const fitness = {
  name: 'スポーツ事業部',
  strategicRole: '会員の継続率を高める',
  keyIssues: ['退会率の上昇'],
  interDeptCollab: [],
  alignmentRiskPoints: [],
  projects: [],
} as unknown as Department;

const manufacturing = {
  name: 'ものづくり事業部',
  strategicRole: '新しい用途の部品を開拓する',
  keyIssues: ['主力部品の原価上昇'],
  interDeptCollab: [],
  alignmentRiskPoints: ['新用途の試作の優先順位'],
  projects: [],
} as unknown as Department;

const finance: FinancePLRow[] = [
  { year: 2024, revenue: 900 * M, operatingIncome: 30 * M },
  { year: 2025, revenue: 1000 * M, operatingIncome: 50 * M },
];

describe('AI生成に渡す会社情報：記録済みの情報だけを使う', () => {
  it('部門の役割・重点課題・連携事項と、直近の財務実績（営業利益率を含む）を渡す', () => {
    const ctx = buildExecutionCompanyContext({ department: delivery, priorityThemes: ['配送の法人比率を上げる'], financePL: finance });
    expect(ctx.department).toMatchObject({
      name: '物流営業部',
      strategicRole: '法人顧客の新規獲得で、配送量を増やす',
      keyIssues: ['既存配送先の単価が下がっている', '追加配送の費用が見えていない'],
    });
    expect(ctx.latestFinance).toEqual({ year: 2025, revenueMJPY: 1000, operatingIncomeMJPY: 50, operatingMarginPct: 5 });
    expect(ctx.priorityThemes).toEqual(['配送の法人比率を上げる']);
  });

  it('利益が無い年度は、利益率を作らず未入力として扱う（0で埋めない）', () => {
    const ctx = buildExecutionCompanyContext({ department: delivery, financePL: [{ year: 2025, revenue: 1000 * M }] });
    expect(ctx.latestFinance).toEqual({ year: 2025, revenueMJPY: 1000, operatingIncomeMJPY: null, operatingMarginPct: null });
  });

  it('財務の売上が無ければ、財務の欄自体を作らない', () => {
    const ctx = buildExecutionCompanyContext({ department: delivery, financePL: [{ year: 2025, operatingIncome: 5 * M }] });
    expect(ctx.latestFinance).toBeUndefined();
  });

  it('部門ごとに分かれている：配送の依頼で、フィットネス・製造の情報は混ざらない', () => {
    const section = companyContextSection(buildExecutionCompanyContext({ department: delivery }));
    expect(section).toContain('物流営業部');
    expect(section).not.toContain('スポーツ事業部');
    expect(section).not.toContain('退会率');
    expect(section).not.toContain('ものづくり事業部');
  });

  it('個人の感情メモなど、一覧にない項目は渡さない', () => {
    const withMemo = { ...delivery, mood: '違和感・もやもや（個人）', discomfort: '私はこの方針に納得していない' } as unknown as Department;
    const ctx = buildExecutionCompanyContext({ department: withMemo });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('違和感');
    expect(json).not.toContain('もやもや');
    expect(json).not.toContain('納得していない');
  });

  it('全社戦略は抜粋（600字まで）にする', () => {
    const story = [{ title: '章', body: 'あ'.repeat(2000) }];
    const ctx = buildExecutionCompanyContext({ finalStory: story });
    expect((ctx.strategyExcerpt ?? '').length).toBeLessThanOrEqual(600);
  });

  it('記録が何も無ければ、会社情報の節は空になる', () => {
    expect(companyContextSection(buildExecutionCompanyContext({}))).toBe('');
  });
});

describe('AIへの指示：因果関係・算定方式・根拠区分', () => {
  it('因果関係の6項目を、顧客の課題から売上・利益までの順に指示する', () => {
    for (const phrase of ['どの顧客のどの課題を解決するのか', 'なぜ自社が選ばれると考えるのか', 'そのために何を実行するのか', 'どのような成果が生まれるのか', 'その成果は売上・利益にどうつながるのか', '何の数値を確認すべきか']) {
      expect(REASONING_RULES).toContain(phrase);
    }
  });

  it('事業の型ごとの算定方式を示し、会員・継続課金をFUNNELに無理に変換しないと書く', () => {
    expect(REASONING_RULES).toContain('会員・継続課金');
    expect(REASONING_RULES).toContain('退会率・継続率');
    expect(REASONING_RULES).toContain('FUNNELに無理に変換しない');
    expect(REASONING_RULES).toContain('生産性向上');
    expect(REASONING_RULES).toContain('新規事業・新用途開拓');
  });

  it('根拠区分を明示し、会社の実績が無い数値を実績として書かせない', () => {
    for (const label of ['USER_DATA', 'DERIVED', 'HYPOTHESIS', 'PRESET', 'MISSING']) {
      expect(REASONING_RULES).toContain(label);
    }
    expect(REASONING_RULES).toContain('会社の実績が無い数値を、実績らしく書いてはいけません');
  });

  it('経営目標から逆算した必要件数と、見込み件数を別の数値として分ける', () => {
    expect(REASONING_RULES).toContain('経営目標から逆算した必要件数');
    expect(REASONING_RULES).toContain('実際に獲得できると見込む件数（仮説）');
  });

  it('AIが返した追加項目は、型が違えば捨てる（AIの値を実績として扱わない）', () => {
    const cleaned = sanitizeDraftReasoning({
      causalChain: { customer: '既存の配送先', problem: 123, actions: '  ', outcome: '単価の回復' },
      assumptionBasis: { targetCustomers: 'HYPOTHESIS', conversionRatePct: 'GUESS' },
      verificationItems: ['過去12か月の商談数', 5, '  '],
    });
    expect(cleaned.causalChain).toEqual({ customer: '既存の配送先', outcome: '単価の回復' });
    expect(cleaned.assumptionBasis).toEqual({ targetCustomers: 'HYPOTHESIS' });
    expect(cleaned.verificationItems).toEqual(['過去12か月の商談数']);
  });

  it('確認項目は最大8件まで', () => {
    const cleaned = sanitizeDraftReasoning({ verificationItems: Array.from({ length: 12 }, (_, i) => `項目${i}`) });
    expect(cleaned.verificationItems).toHaveLength(8);
  });

  it('返却値が不正な形でも例外にしない', () => {
    expect(sanitizeDraftReasoning(undefined)).toEqual({ verificationItems: [] });
    expect(sanitizeDraftReasoning({ causalChain: 'x', assumptionBasis: [], verificationItems: 'x' })).toEqual({ verificationItems: [] });
  });
});

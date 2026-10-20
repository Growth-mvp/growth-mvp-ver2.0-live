import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { CfAssumptions } from '@/utils/stage6/cashflow';
import { buildBankFinancialPlanBlock, type BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import type { Stage6SourceInputs } from '@/utils/stage6/bankFinancialPlanSource';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from '@/utils/stage6/financePlanSnapshot';
import { markdownToBlocks } from './export/planExportDocument';
import { buildBankFinancialFacts } from './bankFinancialDocument';
import { formatMillionYen, formatPercent, collectAllowedFigures } from './bankFinancialFormat';
import {
  BANK_TABLE_PLACEHOLDER,
  bankFinancialPromptText,
  financialProseIssues,
  finalizeBankPlanText,
} from './bankFinancialText';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const STRATEGY = '33333333-3333-4333-8333-333333333333';
const NOW_YEAR = 2026;
const SAVED_AT = '2026-10-19T00:00:00.000Z';

const financePL: FinancePLRow[] = [
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 10_000_000 },
];
const financeBS: FinanceBSRow[] = [
  { year: 2025, cash: 100_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 60_000_000, interestBearingDebt: 300_000_000 },
];
const assumptions: CfAssumptions = {
  minCashYen: 80_000_000,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};
const domain: FinancePlanDomain = {
  assumptions,
  existingLoans: [
    {
      id: 'e1',
      name: 'A銀行',
      category: 'BANK',
      balanceYen: 300_000_000,
      annualRate: 0.02,
      scheduledPrincipalYen: { 2026: 30_000_000, 2027: 30_000_000, 2028: 30_000_000 },
    },
  ],
  newLoans: [],
  dividendsYen: {},
};
const companyTargets = [{ id: 't1', label: '売上高', unit: '百万円', dueYear: 2028, base: 1500, priority: 1 }];

function departments(paymentYm = '2027-03'): Department[] {
  return [
    {
      name: '営業部',
      projects: [
        {
          title: 'A社開拓',
          planStatus: 'approved',
          skillPlans: [
            { id: 'sk1', skillName: '設備', cost: 30_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm } },
          ],
        },
      ],
    },
  ] as unknown as Department[];
}

function inputs(overrides: Partial<Stage6SourceInputs> = {}): Stage6SourceInputs {
  return {
    financePL,
    financeBS,
    departments: departments(),
    fiscalYearEnd: '3',
    companyTargets,
    storedFinancePlan: undefined,
    ...overrides,
  };
}

const noDebtDomain: FinancePlanDomain = { ...domain, existingLoans: [], dividendsYen: {} };

function savedFrom(
  src: Stage6SourceInputs,
  companyId = COMPANY,
  metaCompanyId = COMPANY,
  useDomain: FinancePlanDomain = domain,
): unknown {
  const c = computeStage6FinancePlan({
    financePL: src.financePL,
    financeBS: src.financeBS,
    departments: src.departments,
    fiscalYearEnd: src.fiscalYearEnd,
    domain: useDomain,
    currentYear: NOW_YEAR,
  });
  const meta: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: metaCompanyId,
    baseYear: c.basePlan.baseYear,
    bsBaseYear: c.basePlan.bsBaseYear,
    assumptionsHash: c.assumptionsHash,
    sourceHash: c.sourceHash,
    unconfirmed: {
      unapprovedReadyYen: c.investment.unapprovedReadyYen,
      unclassifiedYen: c.investment.unclassifiedYen,
      unscheduledYen: c.investment.unscheduledYen,
      candidateYen: c.investment.candidateYen,
      basisPendingYen: c.investment.basisPendingYen,
    },
    computedAt: SAVED_AT,
  };
  return JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain: useDomain, companyId, meta, savedAt: SAVED_AT })));
}

function blockOf(src: Stage6SourceInputs, saved: unknown = savedFrom(src), companyId = COMPANY): BankFinancialPlanBlock {
  return buildBankFinancialPlanBlock({
    companyId,
    strategyId: STRATEGY,
    storedFinancePlan: saved,
    inputs: { ...src, storedFinancePlan: saved },
    currentYear: NOW_YEAR,
    computedAt: SAVED_AT,
  });
}

const CURRENT = () => blockOf(inputs());

/** 第4章を含む生成本文の例 */
function generatedText(chapter4Body: string): string {
  return [
    '## 1. 経営課題の分析',
    '売上の伸び悩みが課題です。',
    '',
    '## 2. 改善戦略',
    '営業の強化を進めます。',
    '',
    '## 3. 具体的施策と期待効果',
    '施策の効果を説明します。',
    '',
    '## 4. 財務計画と返済可能性',
    chapter4Body,
    '',
    '## 5. 実行管理体制',
    '月次で進捗を確認します。',
  ].join('\n');
}

describe('1. CURRENT・確定の財務計画', () => {
  it('計算結果として掲載でき、承認の断定はしない注記を付ける', () => {
    const facts = buildBankFinancialFacts(CURRENT())!;
    expect(facts.usable).toBe(true);
    expect(facts.statusLines[0]).toContain('承認を得たものではありません');
    expect(facts.markdown).toContain('**A. 財務目標と収益計画**');
    expect(facts.markdown).toContain('2027年');
  });

  it('表に内部用語（CURRENT・STALE・numbersConfirmed 等）を出さない', () => {
    const md = buildBankFinancialFacts(CURRENT())!.markdown;
    for (const term of ['CURRENT', 'STALE', 'numbersConfirmed', 'partial', 'phase4a']) {
      expect(md).not.toContain(term);
    }
  });
});

describe('2. STALEの参考値', () => {
  it('元データ変更後は参考値と明示し、確定の財務計画と区別する', () => {
    const saved = savedFrom(inputs());
    const changed = blockOf(inputs({ financeBS: [{ ...financeBS[0], cash: 120_000_000 }] }), saved);
    expect(changed.status).toBe('STALE');
    const facts = buildBankFinancialFacts(changed)!;
    expect(facts.statusLines[0]).toContain('参考値');
    expect(facts.markdown).toContain('（参考値）');
    expect(facts.usable).toBe(true);
  });
});

describe('3〜5. 財務数値を出さない状態', () => {
  it('NOT_SAVED：数値を含まない', () => {
    const facts = buildBankFinancialFacts(blockOf(inputs({ storedFinancePlan: undefined }), null))!;
    expect(facts.usable).toBe(false);
    expect(facts.markdown).not.toMatch(/\d+(\.\d+)?\s*(百万円|円|%|倍|年度)/);
    expect(facts.markdown).not.toContain('|');
    expect(facts.allowed.yen).toEqual([]);
  });

  it('INVALID：未対応の形式は数値を出さない', () => {
    const saved = { ...(savedFrom(inputs()) as object), formatVersion: 2 };
    const facts = buildBankFinancialFacts(blockOf(inputs(), saved))!;
    expect(facts.usable).toBe(false);
    expect(facts.markdown).not.toMatch(/\d/);
  });

  it('財務計画が無い場合、第4章が無い本文は変更しない（既存の出力を維持）', () => {
    const text = '第1章 経営課題の分析\n本文です。\n\n第2章 改善戦略\n本文です。';
    const out = finalizeBankPlanText(text, blockOf(inputs({ storedFinancePlan: undefined }), null));
    expect(out.text).toBe(text);
    expect(out.check.applied).toBe(false);
  });

  it('DIFFERENT_COMPANY：会社IDが一致しないデータは表にも本文生成にも渡さない', () => {
    const block = blockOf(inputs(), savedFrom(inputs(), OTHER_COMPANY, OTHER_COMPANY));
    expect(block.status).toBe('DIFFERENT_COMPANY');
    const facts = buildBankFinancialFacts(block)!;
    expect(facts.usable).toBe(false);
    expect(facts.markdown).not.toMatch(/\d/);
    expect(bankFinancialPromptText(block)).not.toMatch(/\d+(\.\d+)?(百万円|円|%)/);
  });
});

describe('6. 決算月未設定', () => {
  it('年度別の投資は暦年仮定と明示し、確定扱いにしない', () => {
    const block = blockOf(inputs({ fiscalYearEnd: undefined }));
    expect(block.numbersConfirmed).toBe(false);
    const facts = buildBankFinancialFacts(block)!;
    expect(facts.markdown).toContain('暦年仮定');
    expect(facts.markdown).toContain('（参考値）');
  });
});

describe('7. 年度ずれ', () => {
  it('PLとBSの基準年度が異なる場合は参考値とし、理由を示す', () => {
    const src = inputs({ financeBS: [{ ...financeBS[0], year: 2024 }] });
    const block = blockOf(src);
    expect(block.numbersConfirmed).toBe(false);
    const facts = buildBankFinancialFacts(block)!;
    expect(facts.statusLines[0]).toContain('一致しない');
  });
});

describe('8. 円・百万円の変換', () => {
  it('円を百万円（小数第1位）に換算し、負値は-で示す', () => {
    expect(formatMillionYen(1_234_500_000)).toBe('1,234.5');
    expect(formatMillionYen(-500_000)).toBe('-0.5');
    expect(formatMillionYen(0)).toBe('0.0');
    expect(formatPercent(0.052)).toBe('5.2%');
  });
});

describe('9. 投資・借入返済の数値一致', () => {
  it('表の値は計算結果と一致し、計算結果にない数値は本文で不一致と判定される', () => {
    const facts = buildBankFinancialFacts(CURRENT())!;
    expect(facts.markdown).toMatch(/\|\s*2027年\s*\|\s*30\.0\s*\|/);
    expect(facts.allowed.yen).toContain(30_000_000);
    expect(financialProseIssues('2027年の設備投資は30.0百万円です。', facts.allowed)).toEqual([]);
    expect(financialProseIssues('2027年の設備投資は31.0百万円です。', facts.allowed).length).toBeGreaterThan(0);
  });
});

describe('10. 欠損値と0の区別', () => {
  it('未確定は「未確定」、0は0.0で区別する', () => {
    expect(formatMillionYen(null)).toBe('未確定');
    expect(formatMillionYen(0)).toBe('0.0');
  });

  it('借入未入力では返済額を0として表示しない', () => {
    const src = inputs();
    const facts = buildBankFinancialFacts(blockOf(src, savedFrom(src, COMPANY, COMPANY, noDebtDomain)))!;
    expect(facts.markdown).toContain('借入・返済計画は未入力');
    expect(facts.markdown).not.toContain('期末借入残高');
  });
});

describe('11. 財務目標と推計の差額', () => {
  it('登録目標との差額を符号付きで示す（推計は横ばい1,000.0、目標1,500.0）', () => {
    const facts = buildBankFinancialFacts(CURRENT())!;
    expect(facts.markdown).toContain('登録目標（STAGE2）');
    expect(facts.markdown).toContain('1,500.0');
    expect(facts.markdown).toContain('-500.0');
  });
});

describe('12. 銀行向け本文への反映', () => {
  it('第4章の本文を保ち、プレースホルダーの位置に財務表を挿入する', () => {
    const text = generatedText(`財務計画は次のとおりです。\n\n${BANK_TABLE_PLACEHOLDER}\n\nこの前提が変わると結果も変わります。`);
    const out = finalizeBankPlanText(text, CURRENT());
    expect(out.check.applied).toBe(true);
    expect(out.check.regionFound).toBe(true);
    expect(out.check.placeholderFound).toBe(true);
    expect(out.check.proseReplaced).toBe(false);
    expect(out.text).not.toContain(BANK_TABLE_PLACEHOLDER);
    expect(out.text).toContain('財務計画は次のとおりです。');
    expect(out.text).toContain('**A. 財務目標と収益計画**');
  });

  it('計算結果にない数値を含む本文は、決まった説明文に差し替える', () => {
    const text = generatedText('売上は3,000百万円に達する見込みです。');
    const out = finalizeBankPlanText(text, CURRENT());
    expect(out.check.proseReplaced).toBe(true);
    expect(out.check.issues.some((i) => i.includes('計算結果にない数値'))).toBe(true);
    expect(out.text).not.toContain('3,000百万円');
  });

  it('禁止表現（組織体制の推測・断定）を含む本文も差し替える', () => {
    const out = finalizeBankPlanText(generatedText('返済は十分可能です。CFO室で確認します。'), CURRENT());
    expect(out.check.proseReplaced).toBe(true);
    expect(out.text).not.toContain('十分可能');
    expect(out.text).not.toContain('CFO室');
  });

  it('第4章が無い場合は財務表を末尾に付ける', () => {
    const text = '## 1. 経営課題の分析\n本文です。\n\n## 5. 実行管理体制\n進捗を確認します。';
    const out = finalizeBankPlanText(text, CURRENT());
    expect(out.check.regionFound).toBe(false);
    expect(out.text).toContain('【財務計画・返済可能性（財務表）】');
    expect(out.text).toContain('**A. 財務目標と収益計画**');
  });
});

describe('13. 銀行向け以外への非干渉', () => {
  it('ブロックが無い場合は本文もプロンプトも変えない', () => {
    const text = generatedText('財務計画は今後確認します。');
    expect(finalizeBankPlanText(text, undefined)).toEqual({
      text,
      check: { applied: false, usable: false, regionFound: false, placeholderFound: false, proseReplaced: false, issues: [] },
    });
    expect(bankFinancialPromptText(undefined)).toBe('');
  });
});

describe('14. 既存計画書の章構成維持', () => {
  it('章見出しと第5章の本文を変えない', () => {
    const out = finalizeBankPlanText(generatedText(BANK_TABLE_PLACEHOLDER), CURRENT()).text;
    const headings = (s: string) => s.split('\n').filter((l) => /^## /.test(l));
    expect(headings(out)).toEqual(headings(generatedText('')));
    expect(out).toContain('## 5. 実行管理体制\n月次で進捗を確認します。');
  });
});

describe('15. Word/PDF出力との整合性', () => {
  it('挿入後のMarkdownから表ブロックが取り出せ、主要な列見出しが一致する', () => {
    const out = finalizeBankPlanText(generatedText(BANK_TABLE_PLACEHOLDER), CURRENT()).text;
    const tables = markdownToBlocks(out).filter((b) => b.type === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(4);
    const headers = tables.map((t) => (t.type === 'table' ? t.header.map((h) => h.map((r) => r.text).join('')).join('|') : ''));
    expect(headers.some((h) => h.includes('売上高') && h.includes('営業利益'))).toBe(true);
    expect(headers.some((h) => h.includes('返済可能性の判定'))).toBe(true);
  });
});

describe('許容集合', () => {
  it('表示される金額・比率のみを許容集合に含める', () => {
    const allowed = collectAllowedFigures({ a: 1_000_000, b: 0.25, year: 2027, label: 'x' });
    expect(allowed.yen).toEqual([1_000_000]);
    expect(allowed.fractions).toEqual([0.25]);
  });
});

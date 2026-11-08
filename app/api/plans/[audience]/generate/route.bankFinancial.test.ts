import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/inputGuardLogger', () => ({
  checkSuspiciousKeywords: () => ({ autoMotive: false, exhaust: false, ceramic: false, oem: false }),
}));
jest.mock('@/lib/modelConfig', () => ({
  getOpenAIModelParamsForProcess: () => ({ model: 'test-model' }),
}));
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } };
  },
}));

import { POST } from './route';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createFakeDb } from '@/lib/plans/testing/fakeSupabase';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from '@/utils/stage6/financePlanSnapshot';
import type { CfAssumptions } from '@/utils/stage6/cashflow';
import { formatMillionYen } from '@/lib/plans/bankFinancialFormat';
import { investmentInputMismatches } from '@/lib/plans/projectInvestment';
import { buildPlanExportDocument, planDocumentPlainText } from '@/lib/plans/export/planExportDocument';

const revenueEffect = (mjpy: number) => ({
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: mjpy * 1_000_000,
  amountBasis: 'ANNUAL',
  startYm: '2026-04',
  sourceNote: '架空',
  source: 'USER_INPUT',
  confirmed: true,
});

const YEAR = new Date().getFullYear();
const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const STRATEGY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ADMIN = '99999999-9999-4999-8999-999999999999';

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
  existingLoans: [],
  newLoans: [],
  dividendsYen: { [YEAR]: null, [YEAR + 1]: 5_000_000 },
};

const financePL = [
  { year: YEAR - 1, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 10_000_000 },
];
const financeBS = [
  { year: YEAR - 1, cash: 100_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 60_000_000, interestBearingDebt: 300_000_000 },
];
const departments = [
  {
    name: '営業部',
    projects: [
      {
        title: 'A社開拓',
        planStatus: 'approved',
        skillPlans: [
          {
            id: 'sk1',
            skillName: '設備',
            cost: 30_000_000,
            spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: `${YEAR + 1}-03` },
          },
        ],
      },
    ],
  },
];

/** store の保存処理（null・空文字を落とす）と同じ規則で保存済みの前提を作る */
function storePrune(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(storePrune).filter((v) => !(v === undefined || v === null));
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const pv = storePrune(v);
      const drop = pv === undefined || pv === null || (typeof pv === 'string' && pv.trim() === '');
      if (!drop) out[k] = pv;
    }
    return out;
  }
  return obj;
}

function snapshotFor(opts: {
  companyId?: string;
  fiscalYearEnd?: string;
  financeBSOverride?: typeof financeBS;
  domainOverride?: FinancePlanDomain;
  departmentsOverride?: typeof departments;
} = {}) {
  const bs = opts.financeBSOverride ?? financeBS;
  const useDomain = opts.domainOverride ?? domain;
  const c = computeStage6FinancePlan({
    financePL,
    financeBS: bs,
    departments: (opts.departmentsOverride ?? departments) as never,
    fiscalYearEnd: opts.fiscalYearEnd ?? '3',
    domain: useDomain,
    currentYear: YEAR,
  });
  const meta: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: opts.companyId ?? COMPANY,
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
    computedAt: new Date().toISOString(),
  };
  const inMemory = buildStoredFinancePlan({
    domain: useDomain,
    companyId: opts.companyId ?? COMPANY,
    meta,
    savedAt: new Date().toISOString(),
  });
  const persisted = JSON.parse(JSON.stringify(storePrune(inMemory)));
  return { persisted, stage6: c };
}

function strategyRow(opts: {
  csv?: Record<string, unknown> | null;
  fiscalYearEnd?: string | null;
  industry?: string;
  extra?: Record<string, unknown>;
  departments?: typeof departments;
  companyTargets?: unknown[];
}) {
  return {
    ...(opts.extra ?? {}),
    id: STRATEGY,
    company_id: COMPANY,
    company_name: 'テスト株式会社',
    industry: opts.industry,
    departments: opts.departments ?? departments,
    final_story: [],
    finance_pl: financePL,
    company_targets: opts.companyTargets ?? [],
    fiscal_year_end: opts.fiscalYearEnd === undefined ? '3' : opts.fiscalYearEnd,
    csv_finance_data: opts.csv === undefined ? { financeBS } : opts.csv,
  };
}

const CH4_WITH_PLACEHOLDER = [
  '第1章 経営課題の分析',
  '本文'.repeat(60),
  '第2章 改善戦略',
  '本文'.repeat(60),
  '第3章 具体的施策と期待効果',
  '本文'.repeat(60),
  '第4章 財務計画と返済可能性',
  '財務計画の内容を次の表で説明します。',
  '[[BANK_FINANCIAL_TABLES]]',
  '第5章 実行管理体制',
  '本文'.repeat(60),
].join('\n');

const PLAIN_TEXT = [
  '第1章 経営課題の分析',
  '本文'.repeat(60),
  '第2章 改善戦略',
  '本文'.repeat(60),
].join('\n');

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/plans/bank/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

const context = (audience: string) => ({ params: Promise.resolve({ audience }) });

function openAiReply(text: string) {
  return {
    model: 'test-model',
    choices: [{ finish_reason: 'stop', message: { content: text } }],
    usage: { completion_tokens: 50, prompt_tokens: 10 },
  };
}

let db: ReturnType<typeof createFakeDb>;

function useRow(row: Record<string, unknown>) {
  db = createFakeDb({ strategy_data: [row] });
  (getSupabaseAdmin as jest.Mock).mockReturnValue(db.client);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_ADMIN);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER_ADMIN, companyId: COMPANY, role: 'admin', departmentId: null });
  mockCreate.mockResolvedValue(openAiReply(CH4_WITH_PLACEHOLDER));
});

function promptSent(): string {
  return String(mockCreate.mock.calls[0][0].messages[1].content);
}

async function generate(audience = 'bank') {
  const res = await POST(makeRequest({ companyId: COMPANY, strategyId: STRATEGY }), context(audience));
  return { res, json: await res.json() };
}

const CONSISTENCY_DEPARTMENTS = [
  {
    name: '営業部',
    projects: [
      {
        title: 'A社開拓',
        planStatus: 'approved',
        financeEffect: revenueEffect(120),
        skillPlans: [
          { id: 'c1', skillName: '設備', cost: 30_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: `${YEAR + 1}-03` } },
        ],
      },
      {
        title: 'B社開拓',
        planStatus: 'draft',
        financeEffect: revenueEffect(50),
        impactInvestmentMJPY: 80,
        skillPlans: [
          { id: 'c2', skillName: '採用', cost: 100_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: `${YEAR + 1}-03` } },
        ],
      },
      { title: '文化施設の知見展開', planStatus: 'draft', financeEffect: revenueEffect(40)},
    ],
  },
];

const CONSISTENCY_TARGETS = [
  { id: 't1', label: '売上高', unit: '百万円', base: 130000, dueYear: YEAR + 1, priority: 1 },
  { id: 't2', label: '営業利益', unit: '百万円', base: 11700, dueYear: YEAR + 1, priority: 2 },
];

const SHARED_AI_TEXT = `## 1. 経営方針\n${YEAR + 1}年の売上高は130000百万円、営業利益は11700百万円を目指します。売上目標は公式な全社売上目標として登録されています。A社開拓の期待売上寄与は¥120Mです。\n${'本文'.repeat(60)}`;

describe('同一のモック企業データで銀行・株主・社員の3種類を生成して照合する', () => {
  async function generateAll() {
    const { persisted } = snapshotFor({ departmentsOverride: CONSISTENCY_DEPARTMENTS as never });
    const results: Record<'bank' | 'shareholder' | 'employee', { text: string; prompt: string }> = {} as never;
    for (const audience of ['bank', 'shareholder', 'employee'] as const) {
      mockCreate.mockClear();
      mockCreate.mockResolvedValue(openAiReply(SHARED_AI_TEXT));
      useRow(
        strategyRow({
          csv: { financeBS, financePlanAssumptions: persisted },
          departments: CONSISTENCY_DEPARTMENTS as never,
          companyTargets: CONSISTENCY_TARGETS,
        }),
      );
      const { res, json } = await generate(audience);
      expect(res.status).toBe(200);
      results[audience] = { text: json.generatedText, prompt: promptSent() };
    }
    return results;
  }

  it('登録目標の金額と承認状態が3種類で一致する', async () => {
    const r = await generateAll();
    for (const audience of ['bank', 'shareholder', 'employee'] as const) {
      expect(r[audience].prompt).toContain(`130000百万円（${YEAR + 1}年）`);
      expect(r[audience].prompt).toContain('承認未確認');
      expect(r[audience].text).toContain('130,000百万円');
      expect(r[audience].text).toContain('11,700百万円');
      expect(r[audience].text).not.toContain('公式');
    }
  });

  it('同一施策の投資額と承認状態が矛盾しない', async () => {
    const r = await generateAll();
    expect(r.bank.prompt).toContain('承認未確認 100.0百万円');
    expect(r.shareholder.prompt).toContain('投資額: 100.0百万円（承認未確認）');
    expect(r.employee.prompt).toContain('投資額: 100.0百万円（承認未確認）');
    expect(r.bank.text).toContain('| B社開拓 | 営業部 | 50.0 | 未確定 | 1件 | 100.0 | 承認未確認 |');
    expect(r.bank.text).toContain('| A社開拓 | 営業部 | 120.0 | 未確定 | 1件 | 30.0 | 承認済み |');
    expect(r.bank.text).toContain('必要投資額（プロジェクト総額）');
    expect(r.bank.text).toContain('重複確認中（合計に含めていません）');
    expect(r.shareholder.prompt).not.toContain('80.0百万円');
  });

  it('期待売上寄与が3種類で一致する', async () => {
    const r = await generateAll();
    expect(r.shareholder.prompt).toContain('財務効果（売上）: 年額換算 +120百万円（確認済み）');
    expect(r.employee.prompt).toContain('財務効果（売上）: 年額換算 +120百万円（確認済み）');
    expect(r.bank.text).toContain('| A社開拓 | 営業部 | 120.0 |');
    expect(r.shareholder.text).toContain('120百万円');
  });

  it('支出の登録がない施策を0円と表示しない', async () => {
    const r = await generateAll();
    expect(r.shareholder.prompt).toMatch(/文化施設の知見展開[\s\S]*?投資額: 未定/);
    expect(r.employee.prompt).toMatch(/文化施設の知見展開[\s\S]*?投資額: 未定/);
    expect(r.bank.text).toContain('| 文化施設の知見展開 | 営業部 | 40.0 | 未確定 | 未登録 | 未登録 | 承認未確認 |');
    expect(r.bank.text).not.toContain('| 文化施設の知見展開 | 営業部 | 40.0 | 未確定 | 未登録 | 0.0 |');
  });

  it('共通する財務指標（営業利益率）が矛盾しない', async () => {
    const r = await generateAll();
    expect(r.shareholder.prompt).toContain(`営業利益率（${YEAR - 1}年度）：5.0%`);
    expect(r.bank.text).toMatch(new RegExp(`\\|\\s*${YEAR - 1}年\\s*\\|\\s*実績\\s*\\|[^\\n]*5\\.0%`));
  });

  it('投資額の入力欄と支出の登録の不一致を統合せず報告する', () => {
    expect(investmentInputMismatches(CONSISTENCY_DEPARTMENTS as never)).toEqual([
      { departmentName: '営業部', title: 'B社開拓', spendYen: 100_000_000, inputYen: 80_000_000 },
    ]);
  });

  it('金額の表示はいずれの出力も同じ正規化規則に従う', async () => {
    const r = await generateAll();
    for (const audience of ['bank', 'shareholder', 'employee'] as const) {
      expect(r[audience].text).not.toMatch(/[¥￥]\s*\d+(\.\d+)?\s*M(?![A-Za-z])/);
      expect(r[audience].text).not.toMatch(/\d％/);
    }
  });
});

describe('銀行向け計画書：保存済みSTAGE6財務前提から最終Markdownまでの結合', () => {
  it('CURRENT：財務表A〜Eが第4章に入り、保存本文と返却本文が一致する', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));

    const { res, json } = await generate();

    expect(res.status).toBe(200);
    expect(json.bankFinancialPlan.status).toBe('CURRENT');
    expect(json.bankFinanceCheck.regionFound).toBe(true);
    expect(json.bankFinanceCheck.proseReplaced).toBe(false);
    expect(json.generatedText).not.toContain('[[BANK_FINANCIAL_TABLES]]');
    for (const heading of ['**A. 財務目標と収益計画', '**B. 投資・資金需要', '**C. キャッシュフロー', '**D. 借入・返済計画', '**E. 計算の前提']) {
      expect(json.generatedText).toContain(heading);
    }
    expect(json.generatedText).toContain('第5章 実行管理体制');
    expect(db.rows.generated_plans[0].generated_text).toBe(json.generatedText);
  });

  it('数値がSTAGE6の計算結果と一致する（CAPEX・期末現預金の表記）', async () => {
    const { persisted, stage6 } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    const { json } = await generate();

    const capex = stage6.plan.years.find((y) => y.year === YEAR + 1)!.capex.value!;
    expect(capex).toBe(30_000_000);
    expect(json.generatedText).toMatch(new RegExp(`\\|\\s*${YEAR + 1}年\\s*\\|\\s*${formatMillionYen(capex)}\\s*\\|`));
    const closing = stage6.plan.years.find((y) => y.year === YEAR + 1)!.closingCashAfterFinancing.value!;
    expect(json.generatedText).toContain(formatMillionYen(closing));
  });

  it('STALE：保存後に元データが変わった場合、参考値として表示する', async () => {
    const { persisted } = snapshotFor();
    const changedBS = [{ ...financeBS[0], cash: 120_000_000 }];
    useRow(strategyRow({ csv: { financeBS: changedBS, financePlanAssumptions: persisted } }));
    const { json } = await generate();

    expect(json.bankFinancialPlan.status).toBe('STALE');
    expect(json.generatedText).toContain('参考値');
    expect(json.generatedText).toContain('**A. 財務目標と収益計画（参考値）**');
  });

  it('NOT_SAVED：保存がない場合は理由を示し、財務表も数値も出さない', async () => {
    useRow(strategyRow({ csv: { financeBS } }));
    const { json } = await generate();

    expect(json.bankFinancialPlan.status).toBe('NOT_SAVED');
    expect(json.generatedText).toContain('財務計画が保存されていない');
    expect(json.generatedText).not.toContain('**A. 財務目標と収益計画');
    expect(json.generatedText).not.toMatch(/\|\s*\d{4}年\s*\|/);
    expect(json.generatedText).not.toContain('[[BANK_FINANCIAL_TABLES]]');
  });

  it('INVALID：識別子が一致しない保存データは使わず、財務表を出さない', async () => {
    const { persisted } = snapshotFor();
    const tampered = JSON.parse(JSON.stringify(persisted));
    tampered.newLoans = [{ id: 'x', amountYen: 1, annualRate: 0.01, termYears: 1, method: 'BULLET', drawYear: YEAR + 1 }];
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: tampered } }));
    const { json } = await generate();

    expect(json.bankFinancialPlan.status).toBe('INVALID');
    expect(json.generatedText).not.toContain('**A. 財務目標と収益計画');
    expect(promptSent()).not.toMatch(/\d+(\.\d+)?百万円/);
  });

  it('DIFFERENT_COMPANY：他社の保存データは本文生成へ渡さない', async () => {
    const { persisted } = snapshotFor({ companyId: OTHER_COMPANY });
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    const { json } = await generate();

    expect(json.bankFinancialPlan.status).toBe('DIFFERENT_COMPANY');
    expect(json.generatedText).not.toContain('**A. 財務目標と収益計画');
    expect(promptSent()).not.toContain('【財務計画（計算済み・変更禁止）】');
    expect(JSON.stringify(json.bankFinancialPlan)).not.toMatch(/"revenue"|"capex"/);
  });

  it('決算月未設定：年度別の投資は暦年仮定と明示し、確定扱いにしない', async () => {
    const { persisted } = snapshotFor({ fiscalYearEnd: '' });
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted }, fiscalYearEnd: null }));
    const { json } = await generate();

    expect(json.bankFinancialPlan.numbersConfirmed).toBe(false);
    expect(json.generatedText).toContain('暦年仮定');
  });

  it('新規借入のみ：既存借入は「明細未入力」、新規借入の返済計算は表に残り、過去実績は単位未確認のまま', async () => {
    const withNew: FinancePlanDomain = {
      assumptions,
      existingLoans: [],
      newLoans: [
        {
          id: 'n0',
          name: '新規借入',
          drawYear: YEAR,
          drawMonth: 12,
          amountYen: 100_000_000,
          annualRate: 0.03,
          termYears: 5,
          graceYears: 0,
          method: 'EQUAL_PRINCIPAL',
        },
      ],
      dividendsYen: {},
    };
    const { persisted } = snapshotFor({ domainOverride: withNew });
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    const { json } = await generate();

    expect(json.bankFinancialPlan.status).toBe('CURRENT');
    expect(json.generatedText).toContain('既存借入の明細は未入力です');
    expect(json.generatedText).toContain('**新規借入の返済計画（計算可能な部分）**');
    expect(json.generatedText).toContain('過去の財務実績の金額の単位は未確認です');
    expect(json.generatedText).not.toMatch(/STAGE\d|GROWTH SHIFT/);
    expect(promptSent()).toMatch(/過去年度別財務実績[\s\S]*未確認/);
  });

  it('PDF用Markdownに財務表が残る（Word/PDFと同じ文書モデル）', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    const { json } = await generate();

    const doc = buildPlanExportDocument({ audience: 'bank', companyName: 'テスト株式会社', generatedAt: json.generatedAt, markdown: json.generatedText });
    const tables = doc.blocks.filter((b) => b.type === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(4);
    const headers = tables.map((t) => (t.type === 'table' ? t.header.map((h) => h.map((r) => r.text).join('')).join('|') : ''));
    expect(headers.some((h) => h.includes('売上高') && h.includes('営業利益'))).toBe(true);

    const plainText = planDocumentPlainText(doc);
    expect(plainText).not.toMatch(/STAGE\d|GROWTH SHIFT/);
    expect(plainText).toContain('経営計画の要約');
  });

  it('銀行向けの本文は冒頭に要約を置き、内部用語を残さない', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    const { json } = await generate();

    expect(json.generatedText.startsWith('## 経営計画の要約')).toBe(true);
    expect(json.generatedText).not.toMatch(/STAGE\d|GROWTH SHIFT/);
  });

  it('株主向けの本文は内部用語を経営用語に置き換え、冒頭要約は付けない', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    mockCreate.mockResolvedValue(
      openAiReply(
        `## 1. 経営方針\nSTAGE2の全社戦略に基づき、STAGE4の実行施策を進めます。売上高は2023年を底として増加しています。\n${'本文'.repeat(60)}`,
      ),
    );
    const { json } = await generate('shareholder');

    expect(json.generatedText).toContain('全社戦略に基づき、実行施策を進めます。');
    expect(json.generatedText).toContain('売上高の過去実績の推移は、実績表のとおりです。');
    expect(json.generatedText).not.toContain('2023年を底として');
    expect(json.generatedText).not.toMatch(/STAGE\d/);
    expect(json.generatedText).not.toContain('経営計画の要約');
  });

  it('STAGE2の確定戦略と全件数の施策を銀行向けに渡し、株主向けには確定戦略だけを渡す', async () => {
    const { persisted } = snapshotFor();
    const extra = {
      final_story_final: [{ title: '確定章', body: '確定した戦略本文' }],
      final_story_conclusion: { conclusion: '全社戦略の結論X' },
      swot_suggestions: {
        midtermStrategy: {
          growthStrategy: '成長戦略A',
          strategicCore: { customerValue: '顧客が選ぶ理由C' },
        },
      },
    };
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted }, extra }));
    await generate('bank');

    const bankPrompt = promptSent();
    expect(bankPrompt).toContain('【全社戦略（入力された内容のみ）】');
    expect(bankPrompt).toContain('戦略ストーリーの版：確定版');
    expect(bankPrompt).toContain('全社戦略の結論：全社戦略の結論X');
    expect(bankPrompt).toContain('成長戦略：成長戦略A');
    expect(bankPrompt).toContain('顧客が当社を選ぶ理由・提供価値：顧客が選ぶ理由C');
    expect(bankPrompt).toContain('確定した戦略本文');

    mockCreate.mockClear();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted }, extra }));
    await generate('shareholder');
    const shareholderPrompt = promptSent();
    expect(shareholderPrompt).toContain('【全社戦略（入力された内容のみ）】');
    expect(shareholderPrompt).toContain('確定した戦略本文');
    expect(shareholderPrompt).toContain('【部門別戦略】\n');
    expect(shareholderPrompt).not.toContain('件を掲載');
  });

  it('過去実績の表は、円で確認済みの年度だけ百万円に換算し、未確認の年度は換算しない', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted, financeUnitConfirmed: { pl: [YEAR - 1] } } }));
    await generate('shareholder');
    const confirmedPrompt = promptSent();
    expect(confirmedPrompt).toContain(`| ${YEAR - 1} | 1,000.0 | - | 50.0 | 30.0 | 百万円 |`);
    expect(confirmedPrompt).not.toContain('1,000,000,000');

    mockCreate.mockClear();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    await generate('shareholder');
    const unconfirmedPrompt = promptSent();
    expect(unconfirmedPrompt).toContain(`| ${YEAR - 1} | 1,000,000,000 | - | 50,000,000 | 30,000,000 | 未確認 |`);
    expect(unconfirmedPrompt).not.toContain('| 百万円 |');
  });

  it('株主向けは財務指標を計算値として渡し、上場区分が未入力のときPBRを出さない', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    await generate('shareholder');

    const prompt = promptSent();
    expect(prompt).toContain('【財務指標（現状分析の計算値）】');
    expect(prompt).toContain('上場区分：未入力');
    expect(prompt).toContain('未算出');
    expect(prompt).not.toContain('PBR（株価純資産倍率）');
  });

  it('生成された本文の金額・単位・承認状態の表現を統一し、年度は変えない', async () => {
    mockCreate.mockResolvedValue(
      openAiReply(
        `## 1. 経営方針\n2029年の売上高は¥130000M、営業利益は11700百万円を目指します。公式な全社売上目標として登録されています。営業利益率は-3.01％です。\n${'本文'.repeat(60)}`,
      ),
    );
    const { json } = await generate('shareholder');

    expect(json.generatedText).toContain('2029年の売上高は130,000百万円');
    expect(json.generatedText).toContain('11,700百万円');
    expect(json.generatedText).toContain('登録された全社売上目標');
    expect(json.generatedText).toContain('-3.01%');
    expect(json.generatedText).not.toMatch(/[¥￥]\s*\d+\s*M/);
    expect(json.generatedText).not.toContain('公式な');
  });

  it('社員向けは財務指標を渡さず、担当者の協議による決定を断定しない', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    await generate('employee');

    const prompt = promptSent();
    expect(prompt).not.toContain('【財務指標（現状分析の計算値）】');
    expect(prompt).not.toContain('マネージャーとの協議で確定');
    expect(prompt).toContain('部門別OKRが未入力の場合は「未設定」');
    expect(prompt).not.toContain('基本実装段階');
  });

  it('業種は内部コードではなく日本語の業種名で渡す', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted }, industry: 'service' }));
    await generate();

    expect(promptSent()).toContain('業種: その他サービス業');
    expect(promptSent()).not.toContain('業種: service');
  });

  it('銀行向け以外の計画書：財務ブロックもプロンプトの財務データも含めず、本文を変えない', async () => {
    const { persisted } = snapshotFor();
    useRow(strategyRow({ csv: { financeBS, financePlanAssumptions: persisted } }));
    mockCreate.mockResolvedValue(openAiReply(PLAIN_TEXT));

    const { json } = await generate('shareholder');

    expect(json).not.toHaveProperty('bankFinancialPlan');
    expect(json).not.toHaveProperty('bankFinanceCheck');
    expect(json.generatedText).toBe(PLAIN_TEXT);
    expect(promptSent()).not.toContain('【財務計画（計算済み・変更禁止）】');
    expect(promptSent()).not.toContain('財務シミュレーション状況');
    expect(promptSent()).not.toContain('基本実装段階');
    expect(promptSent()).not.toContain('準備中');
  });
});

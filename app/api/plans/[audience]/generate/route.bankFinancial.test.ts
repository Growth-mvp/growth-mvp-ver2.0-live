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
import { buildPlanExportDocument } from '@/lib/plans/export/planExportDocument';

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
} = {}) {
  const bs = opts.financeBSOverride ?? financeBS;
  const useDomain = opts.domainOverride ?? domain;
  const c = computeStage6FinancePlan({
    financePL,
    financeBS: bs,
    departments: departments as never,
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
}) {
  return {
    id: STRATEGY,
    company_id: COMPANY,
    company_name: 'テスト株式会社',
    departments,
    final_story: [],
    finance_pl: financePL,
    company_targets: [],
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
    expect(json.generatedText).toContain('既存借入：明細未入力（0件とはしていません）');
    expect(json.generatedText).toContain('**新規借入の返済計画（計算可能な部分）**');
    expect(json.generatedText).toContain('STAGE1の財務実績の単位：未確認');
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
    expect(promptSent()).toContain('財務シミュレーション状況');
  });
});

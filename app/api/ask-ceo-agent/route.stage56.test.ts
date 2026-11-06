import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockClassifyLLM = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } };
    constructor(_opts: unknown) {}
  },
}));
jest.mock('@/utils/supabase/strategy', () => ({
  getFullStrategyDataByStrategyId: jest.fn(),
}));
jest.mock('@/utils/supabase/normalize', () => ({
  normalizeStrategyData: (x: unknown) => x,
}));
jest.mock('@/lib/inputGuardLogger', () => ({
  checkSuspiciousKeywords: () => ({}),
  logInputGuard: jest.fn(),
}));
jest.mock('@/lib/supabase/agentLogs', () => ({
  insertAgentLog: jest.fn(async () => undefined),
}));
jest.mock('@/lib/intentRouter', () => {
  const actual = jest.requireActual('@/lib/intentRouter');
  return { ...actual, classifyLLM: (...args: unknown[]) => mockClassifyLLM(...args) };
});
jest.mock('@/lib/facilitatorProtocol', () => ({ buildFacilitatorBlock: () => '' }));
jest.mock('@/lib/facilitatorSchema', () => ({
  buildJSONOutputInstruction: () => '',
  safeParseFacilitatorJSON: () => null,
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => ({}) }));
jest.mock('@/lib/helpPrompt', () => ({ buildHelpSystemPrompt: () => '' }));
jest.mock('@/lib/growthKnowledge', () => ({ pickRelevantKnowledge: () => [] }));
jest.mock('@/lib/externalFinancialSearch', () => ({ searchExternalFinancialData: jest.fn() }));
jest.mock('@/lib/rag/indexer', () => ({
  getGrowthRagIndex: () => ({ docs: [], chunks: [], loadedAt: 0 }),
}));
jest.mock('@/lib/rag/retriever', () => ({ retrieveGrowthKnowledge: () => ({ hits: [] }) }));
jest.mock('@/lib/rag/prompt', () => ({
  buildRagContextBlock: () => '',
  buildRagDebugFooter: () => '',
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  resolveCompanyIdFromStrategyId: jest.fn(),
}));

import { getFullStrategyDataByStrategyId } from '@/utils/supabase/strategy';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  requireMembership,
  resolveCompanyIdFromStrategyId,
} from '@/lib/server/rbacGuard';
import { buildStoredFinancePlan, FINANCE_PLAN_CALC_VERSION } from '@/utils/stage6/financePlanSnapshot';
import { POST } from './route';

type Row = Record<string, any>;

const USER = 'user-1';
const STRATEGY_OF_A = 'strategy-a';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const NOW_ISO = new Date().toISOString();

const DB: Record<string, Row[]> = {
  okrs: [
    { id: 'o1', company_id: COMPANY_A, department_id: 'd1', project_id: 'p1', objective: '新規', is_deleted: false },
    { id: 'o2', company_id: COMPANY_A, department_id: 'd1', project_id: 'p2', objective: '工程', is_deleted: false },
    { id: 'o9', company_id: COMPANY_B, department_id: 'dB', project_id: 'pB', objective: '他社', is_deleted: false },
  ],
  progress_logs: [
    {
      id: 'l1',
      company_id: COMPANY_A,
      user_id: USER,
      okr_id: 'o1',
      created_at: NOW_ISO,
      content: '__META__{"k":1}\n営業の本文です',
      score: 4,
      status: '進行中',
    },
    { id: 'l2', company_id: COMPANY_A, user_id: 'other-user', okr_id: 'o1', created_at: NOW_ISO, content: '他人の機密本文' },
    { id: 'l3', company_id: COMPANY_B, user_id: 'b-user', okr_id: 'o9', created_at: NOW_ISO, content: 'B社の本文' },
    { id: 'l4', company_id: COMPANY_A, user_id: 'other-user', okr_id: 'o2', created_at: NOW_ISO, content: '', score: null, status: '' },
  ],
};

/** 条件（eq / gte）を実際に適用する模擬。会社の絞り込みが無いクエリは他社の行を返してしまう。 */
function makeAdmin() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        gte: (col: string, val: string) => {
          filters.push((r) => String(r[col] ?? '') >= val);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve({ data: (DB[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(
            resolve,
            reject
          ),
      };
      return builder;
    },
  };
}

function storedPlanFor(companyId: string) {
  return buildStoredFinancePlan({
    domain: {
      assumptions: {
        minCashYen: null,
        taxRate: 0.3,
        depreciationYen: null,
        arRatio: null,
        inventoryRatio: null,
        apRatio: null,
        targetRevenueYen: 1_200_000_000,
        targetOperatingIncomeYen: null,
        targetYear: 2027,
      },
      existingLoans: [],
      newLoans: [],
      dividendsYen: {},
    },
    companyId,
    savedAt: '2026-10-20T00:00:00Z',
    meta: {
      calcVersion: FINANCE_PLAN_CALC_VERSION,
      companyId,
      baseYear: 2025,
      bsBaseYear: 2025,
      assumptionsHash: 'a',
      sourceHash: 's',
      unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2026-10-20T00:00:00Z',
    },
  });
}

function strategyRow(overrides: Row = {}): Row {
  return {
    id: STRATEGY_OF_A,
    companyName: 'モック株式会社',
    departments: [
      {
        id: 'd1',
        name: '営業部',
        mission: '新規と既存の顧客を伸ばす',
        projects: [
          { id: 'p1', title: '新規顧客開拓', ownerName: '佐藤花子', okrsV2: [] },
          { id: 'p2', title: '工程の標準化', okrsV2: [] },
        ],
      },
    ],
    answers2: [],
    finalStoryFinal: [{ title: '提供価値', body: '地域の中小製造業に点検サービスを届ける。' }],
    financePL: [
      { year: 2024, revenue: 900_000_000, operatingIncome: 80_000_000, interest: 4_000_000, tax: 20_000_000, netIncome: 56_000_000, depreciation: 18_000_000 },
      { year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000, interest: 5_000_000, tax: 28_500_000, netIncome: 66_500_000, depreciation: 20_000_000 },
    ],
    financeBS: [
      { year: 2024, cash: 250_000_000, ar: 135_000_000, inventory: 72_000_000, ap: 81_000_000 },
      { year: 2025, cash: 300_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 90_000_000 },
    ],
    fiscalYearEnd: '3',
    csvFinanceData: { financePlanAssumptions: storedPlanFor(COMPANY_A) },
    simulationResults: [],
    ...overrides,
  };
}

function req(query: string) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_OF_A,
      companyId: COMPANY_A,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

async function ask(query: string, row: Row = strategyRow()) {
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: row, error: null });
  const res = await POST(req(query));
  expect(res.status).toBe(200);
  return mockChatCreate.mock.calls[0][0].messages[0].content as string;
}

const PROGRESS = '# 実行状況（STAGE5';
const PLAN = '# 業績・資金の数値（STAGE6、区分ごとに表示）';

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(makeAdmin());
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_A);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY_A, role: 'admin', departmentId: null });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
});

describe('評価の7問：必要な STAGE5・6 の情報が届く（モック）', () => {
  it('1. 営業部門の進捗はどうなっているか？：会社全体は確認日時の集計、本人の本文だけ', async () => {
    const p = await ask('営業部門の進捗はどうなっているか？');
    expect(p).toContain(PROGRESS);
    expect(p).toContain('直近7日に確認があったプロジェクト: 1/2件');
    expect(p).toContain('営業の本文です');
    expect(p).not.toContain('__META__');
    expect(p).not.toContain('他人の機密本文');
    expect(p).not.toContain('B社の本文');
    expect(p).not.toContain(PLAN);
  });

  it('2. 目標未達の原因は何か？：進捗のブロックを使い、資金計画は入れない', async () => {
    const p = await ask('目標未達の原因は何か？');
    expect(p).toContain(PROGRESS);
    expect(p).not.toContain(PLAN);
  });

  it('3. 遅れているプロジェクトはどれか？：確認がないプロジェクトを名前で出す', async () => {
    const p = await ask('遅れているプロジェクトはどれか？');
    expect(p).toContain(PROGRESS);
    expect(p).toContain('確認がないプロジェクト');
    expect(p).toContain('営業部 / 工程の標準化（最終確認: 30日以内の記録なし）');
    expect(p).not.toContain('営業部 / 新規顧客開拓（最終確認');
  });

  it('4. このままでは3年後の利益はいくらになるか？：目標と予測を区別し、予測は未算出と明示する', async () => {
    const p = await ask('このままでは3年後の利益はいくらになるか？');
    expect(p).toContain(PLAN);
    expect(p).toContain('予測未算出');
    expect(p).not.toMatch(/\d{4}年度（予測）/);
    expect(p).not.toContain(PROGRESS);
  });

  it('5. 来年度の資金繰りは大丈夫か？：登録済みの目標と、未算出の項目を区別する', async () => {
    const p = await ask('来年度の資金繰りは大丈夫か？');
    expect(p).toContain(PLAN);
    expect(p).toContain('目標（経営者が登録）：2027年度');
    expect(p).toContain('既存借入・新規借入・配当は未登録です');
  });

  it('6. 設備投資を増やしても借入返済は可能か？：借入が未登録なら、返済額を作らない', async () => {
    const p = await ask('設備投資を増やしても借入返済は可能か？');
    expect(p).toContain(PLAN);
    expect(p).toContain('返済額は算出していません');
  });

  it('7. 今、最も優先すべき経営課題は何か？：STAGE5・6 の両方を入れる', async () => {
    const p = await ask('今、最も優先すべき経営課題は何か？');
    expect(p).toContain(PROGRESS);
    expect(p).toContain(PLAN);
  });
});

describe('未登録・他社・古い前提の扱い', () => {
  it('保存データに他の項目があり前提が無い場合は未保存と書き、数値を作らない', async () => {
    const p = await ask('来年度の資金繰りは大丈夫か？', strategyRow({ csvFinanceData: { financeBS: [] } }));
    expect(p).toContain('保存済みの資金計画はありません');
    expect(p).not.toMatch(/\d{4}年度（予測）/);
  });

  it('保存データが空で未保存と確認できない場合は、未保存と断定しない', async () => {
    const p = await ask('来年度の資金繰りは大丈夫か？', strategyRow({ csvFinanceData: {} }));
    expect(p).not.toContain('保存済みの資金計画はありません');
    expect(p).toContain('保存済みの資金計画は今回参照した情報では確認できません');
  });

  it('別の会社の資金計画は使わない', async () => {
    const p = await ask(
      '来年度の資金繰りは大丈夫か？',
      strategyRow({ csvFinanceData: { financePlanAssumptions: storedPlanFor(COMPANY_B) } })
    );
    expect(p).toContain('この会社のものとして確認できませんでした');
    expect(p).not.toMatch(/\d{4}年度（予測）/);
  });

  it('決算月が無ければ、年度の対応が未確定と書く', async () => {
    const p = await ask('来年度の資金繰りは大丈夫か？', strategyRow({ fiscalYearEnd: undefined }));
    expect(p).toContain('決算月が未登録');
  });

  it('保存済みのシミュレーションは、保存時点の結果として出す', async () => {
    const p = await ask(
      '来年度の資金繰りは大丈夫か？',
      strategyRow({
        simulationResults: [
          {
            id: 's1',
            created_at: '2026-09-01T00:00:00Z',
            title: '投資を増やす案',
            payload: { projection: { points: [{ year: '2027', sales: 1_100_000_000, op: 90_000_000 }] }, finalProb: 0.6 },
          },
        ],
      })
    );
    expect(p).toContain('保存済み（保存時点の計算結果）：投資を増やす案');
    expect(p).toContain('現在のSTAGE1・4のデータとの一致は未検証');
  });

  it('空の記録だけの製造部は、確認ありと数えない', async () => {
    const p = await ask('営業部門の進捗はどうなっているか？');
    expect(p).toContain('直近7日に確認があったプロジェクト: 1/2件');
    expect(p).toContain('営業部 / 工程の標準化');
  });
});

describe('認証・所属・会社の一致は従来どおり必須', () => {
  it('ログインがなければ、会社データも進捗も読まない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
    const res = await POST(req('営業部門の進捗はどうなっているか？'));
    expect(res.status).toBe(401);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('戦略が別の会社に属するなら拒否し、進捗も読まない', async () => {
    (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_B);
    const res = await POST(req('営業部門の進捗はどうなっているか？'));
    expect(res.status).toBe(403);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('所属がなければ拒否する', async () => {
    (requireMembership as jest.Mock).mockResolvedValue(null);
    const res = await POST(req('営業部門の進捗はどうなっているか？'));
    expect(res.status).toBe(403);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });
});

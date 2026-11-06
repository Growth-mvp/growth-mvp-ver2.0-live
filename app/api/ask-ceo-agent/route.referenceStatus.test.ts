import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockClassifyLLM = jest.fn();
const mockNormalize = jest.fn((x: unknown) => x);

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
  normalizeStrategyData: (x: unknown) => mockNormalize(x),
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
import { POST } from './route';

type Row = Record<string, any>;

const USER = 'user-1';
const STRATEGY_A = 'strategy-a';
const COMPANY_A = 'company-a';
const STRATEGY_B = 'strategy-b';
const COMPANY_B = 'company-b';
const STATUS_HEADER = '【参照状況（内部情報）】';

const adminWithFailure = (failTable?: string) => ({
  from(table: string) {
    const error = table === failTable ? { message: 'simulated failure' } : null;
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error }).then(resolve, reject),
    };
    return builder;
  },
});

const TARGETS = [
  { id: 't1', label: '売上高', unit: '百万円', base: 12000, dueYear: 2030, prioritySimple: 'primary', linkedIssueIds: [], rationale: '' },
];

function strategyRow(overrides: Row = {}): Row {
  return {
    id: STRATEGY_A,
    companyName: 'モック株式会社',
    departments: [{ id: 'd1', name: '営業部', mission: '新規', projects: [{ id: 'p1', title: '新規顧客開拓', okrsV2: [] }] }],
    answers2: [],
    financePL: [{ year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000 }],
    financeBS: [{ year: 2025, cash: 300_000_000 }],
    fiscalYearEnd: '3',
    simulationResults: [],
    companyTargets: TARGETS,
    ...overrides,
  };
}

function req(messages: Array<{ role: 'user' | 'assistant'; content: string }>, strategyId = STRATEGY_A, companyId = COMPANY_A) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({ userId: USER, strategyId, companyId, messages }),
  });
}

async function askTurns(
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
  row: Row = strategyRow(),
  opts: { strategyId?: string; companyId?: string } = {}
): Promise<string> {
  const strategyId = opts.strategyId ?? STRATEGY_A;
  const companyId = opts.companyId ?? COMPANY_A;
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: row, error: null });
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(companyId);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId, role: 'admin', departmentId: null });
  const res = await POST(req(turns, strategyId, companyId));
  expect(res.status).toBe(200);
  const calls = mockChatCreate.mock.calls;
  return calls[calls.length - 1][0].messages[0].content as string;
}

const ask = (query: string, row?: Row) => askTurns([{ role: 'user', content: query }], row);

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  mockNormalize.mockImplementation((x: unknown) => x);
  (getSupabaseAdmin as jest.Mock).mockReturnValue(adminWithFailure());
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
});

const CONSULT = '当社の戦略の弱点は何か';

describe('参照状況の注入（route・モック）', () => {
  it('1. 同一企業の連続質問：進捗質問で参照したSTAGE5を、次の質問では未登録ではなく今回未参照と示す', async () => {
    const first = await ask('当社の施策の進捗は？');
    expect(first).toContain('- STAGE5 会社全体の進捗: 参照済み');

    const second = await askTurns([
      { role: 'user', content: '当社の施策の進捗は？' },
      { role: 'assistant', content: '（前回の回答）' },
      { role: 'user', content: CONSULT },
    ]);
    expect(second).toContain('- STAGE5 会社全体の進捗: 今回の回答では参照していない');
    expect(second).not.toContain('- STAGE5 会社全体の進捗: 登録なし');
  });

  it('2. 取得失敗は登録なしと誤認されない（進捗ログの取得失敗）', async () => {
    (getSupabaseAdmin as jest.Mock).mockReturnValue(adminWithFailure('progress_logs'));
    const p = await ask(CONSULT);
    expect(p).toContain('- 直近進捗ログ（本人分）: 取得失敗');
    expect(p).not.toContain('- 直近進捗ログ（本人分）: 登録なし');
  });

  it('2. 回答データが空の場合は登録なしと断定せず状態不明にする', async () => {
    const p = await ask(CONSULT, strategyRow({ answers2: [] }));
    expect(p).toContain(STATUS_HEADER);
    expect(p).toContain('- STAGE2 掘り下げQA: 状態不明（登録なしと断定しない）');
    expect(p).toContain('- STAGE2 完成ストーリー: 状態不明（登録なしと断定しない）');
  });

  it('2. 財務サマリが空でも、登録なしと断定せず状態不明にする（基幹行の存在だけで判定しない）', async () => {
    const p = await ask(CONSULT, strategyRow({ financePL: [], financeBS: [] }));
    expect(p).toContain('- STAGE1 財務・5指標: 状態不明');
    expect(p).not.toContain('- STAGE1 財務・5指標: 登録なし');
  });

  it('3. 一部取得（各章の直近2件のみ）は全件として扱わない', async () => {
    const answers2 = [
      {
        chapterIndex: 0,
        chapterTitle: '第1章',
        steps: [
          { stepNumber: 1, question: 'q1', answer: 'a1' },
          { stepNumber: 2, question: 'q2', answer: 'a2' },
          { stepNumber: 3, question: 'q3', answer: 'a3' },
        ],
      },
    ];
    const p = await ask(CONSULT, strategyRow({ answers2 }));
    expect(p).toContain('- STAGE2 掘り下げQA: 一部のみ参照（全件として扱わない）（各章の直近2件のみ）');
  });

  it('4. 企業を切り替えても、前の企業の参照状況やデータが混入しない', async () => {
    const rowA = strategyRow({
      departments: [{ id: 'da', name: '営業部A', mission: '', projects: [{ id: 'pa', title: 'A社固有施策', okrsV2: [] }] }],
    });
    const rowB = strategyRow({
      id: STRATEGY_B,
      companyName: 'ビー株式会社',
      departments: [{ id: 'db', name: '製造部B', mission: '', projects: [] }],
      answers2: [],
    });
    const promptA = await askTurns([{ role: 'user', content: '当社の施策の進捗は？' }], rowA);
    expect(promptA).toContain('A社固有施策');

    const promptB = await askTurns([{ role: 'user', content: CONSULT }], rowB, { strategyId: STRATEGY_B, companyId: COMPANY_B });
    expect(promptB).toContain('製造部B');
    expect(promptB).not.toContain('A社固有施策');
    expect(promptB).not.toContain('営業部A');
    expect(promptB).toContain('- STAGE5 会社全体の進捗: 今回の回答では参照していない');
  });

  it('5. 操作案内は help のまま、参照状況や企業データを注入しない', async () => {
    const p = await ask('この画面の使い方を教えて');
    expect(p).not.toContain(STATUS_HEADER);
    expect(p).not.toContain('【STAGE1');
  });

  it('6. 継続的な経営相談で、参照状況が付き、help 判定にされない', async () => {
    const p = await askTurns([
      { role: 'user', content: '当社の施策は何件ありますか' },
      { role: 'assistant', content: '（前回の回答）' },
      { role: 'user', content: 'それで当社の利益計画は妥当ですか' },
    ]);
    expect(p).toContain(STATUS_HEADER);
  });

  it('7. 一般的な経営知識の質問には参照状況を付けない', async () => {
    const p = await ask('OKRの一般的な決め方を教えて');
    expect(p).not.toContain(STATUS_HEADER);
  });
});

describe('本文と参照状況の矛盾確認（route・モック）', () => {
  const TARGET_Q = '営業利益目標は？';
  const PLAN_Q = '来年度の資金繰りは大丈夫か？';
  const ALIGN_Q = '当社の部門の行動の整合は取れているか';

  it('正常取得で目標が空と確認できる：本文は未登録、参照状況は登録なし', async () => {
    const p = await ask(TARGET_Q, strategyRow({ companyTargets: [] }));
    expect(p).toContain('未登録です（STAGE2で業績目標が登録されていません）');
    expect(p).toContain('- STAGE2 業績目標: 登録なし（取得成功を確認済み）');
  });

  it('目標の保存値はあるが有効な行が無い：本文は確認できないと書き、参照状況は状態不明', async () => {
    const p = await ask(TARGET_Q, strategyRow({ companyTargets: [{ label: '\n', unit: '百万円', base: 1 }] }));
    expect(p).not.toContain('未登録です');
    expect(p).toContain('今回参照した情報では業績目標を確認できません');
    expect(p).toContain('- STAGE2 業績目標: 状態不明');
  });

  it('ブリッジが未設定と確認できる：本文は未登録、参照状況は登録なし', async () => {
    const row = strategyRow();
    delete (row as Row).stage3_strategy_bridge;
    const p = await ask(ALIGN_Q, row);
    expect(p).toContain('STAGE3の戦略展開ブリッジは登録されていません');
    expect(p).toContain('- STAGE3 戦略展開ブリッジ: 登録なし（取得成功を確認済み）');
  });

  it('ブリッジの保存値がオブジェクトでない：本文は確認できないと書き、参照状況は状態不明', async () => {
    const p = await ask(ALIGN_Q, strategyRow({ stage3_strategy_bridge: 'broken' }));
    expect(p).not.toContain('STAGE3の戦略展開ブリッジは登録されていません');
    expect(p).toContain('STAGE3の戦略展開ブリッジは今回参照した情報では確認できません');
    expect(p).toContain('- STAGE3 戦略展開ブリッジ: 状態不明');
  });

  it('保存データに前提が無いと確認できる：本文は未保存、参照状況は登録なし', async () => {
    const p = await ask(PLAN_Q, strategyRow({ csvFinanceData: { financeBS: [] } }));
    expect(p).toContain('保存済みの資金計画はありません');
    expect(p).toContain('- STAGE6 財務計画: 登録なし（取得成功を確認済み）');
  });

  it('保存データが空で未保存と確認できない：本文は確認できないと書き、参照状況は状態不明', async () => {
    const p = await ask(PLAN_Q, strategyRow({ csvFinanceData: {} }));
    expect(p).not.toContain('保存済みの資金計画はありません');
    expect(p).toContain('- STAGE6 財務計画: 状態不明');
  });

  it('正規化で非オブジェクトのブリッジ保存値が落ちても、未登録とは断定しない（保存値を復元して判定）', async () => {
    mockNormalize.mockImplementation((x: any) => ({
      ...x,
      stage3_strategy_bridge: x.stage3_strategy_bridge && typeof x.stage3_strategy_bridge === 'object' && !Array.isArray(x.stage3_strategy_bridge)
        ? x.stage3_strategy_bridge
        : undefined,
    }));
    const p = await ask(ALIGN_Q, strategyRow({ stage3_strategy_bridge: 'broken' }));
    expect(p).not.toContain('STAGE3の戦略展開ブリッジは登録されていません');
    expect(p).toContain('STAGE3の戦略展開ブリッジは今回参照した情報では確認できません');
    expect(p).toContain('- STAGE3 戦略展開ブリッジ: 状態不明');
  });

  it('部門の保存値が配列でない：本文は確認できないと書き、参照状況は状態不明', async () => {
    const p = await ask(CONSULT, strategyRow({ departments: 'broken' }));
    expect(p).not.toContain('（部門・プロジェクトなし）');
    expect(p).toContain('（部門・プロジェクトは今回参照した情報では確認できません）');
    expect(p).toContain('- STAGE4 部門・施策: 状態不明');
  });

  it('部門が空の配列と確認できる：本文はなし、参照状況は登録なし', async () => {
    const p = await ask(CONSULT, strategyRow({ departments: [] }));
    expect(p).toContain('（部門・プロジェクトなし）');
    expect(p).toContain('- STAGE4 部門・施策: 登録なし（取得成功を確認済み）');
  });
});

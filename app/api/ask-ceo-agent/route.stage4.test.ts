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
import { POST } from './route';

const USER = 'user-1';
const STRATEGY_OF_A = 'strategy-a';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

const STAGE4_ROW = {
  id: STRATEGY_OF_A,
  companyName: 'モック株式会社',
  departments: [
    {
      name: '製造部',
      mission: '品質と原価を守る',
      projects: [
        {
          title: '工程の標準化',
          ownerName: '田中次郎',
          okrsV2: [{ label: '不良率', target: 1, unit: '%', owner: '田中次郎', due: '2027-01' }],
        },
      ],
    },
    {
      name: '営業部',
      mission: '新規と既存の顧客を伸ばす',
      projects: [
        {
          title: '新規顧客開拓',
          ownerName: '佐藤花子',
          planStatus: 'approved',
          valueDriverLinks: ['売上成長'],
          okrsV2: [
            {
              label: '新規商談数',
              target: 120,
              unit: '件',
              owner: '佐藤花子',
              due: '2027-03',
              milestones: [{ title: '提案資料の完成', dueYm: '2026-12' }],
            },
            { label: '継続率', target: 95, unit: '%', owner: '鈴木一郎', due: '2027-06' },
          ],
          impact: { metricDelta: [{ metric: '受注率', delta: 2, unit: 'pt' }] },
          humanInvestments: [{ type: 'HIRE', amount: 1200000 }],
          executionHumanInvestments: [{ type: 'TRAINING', amount: 3400000 }],
          ownerUserId: 'uid-secret',
        },
      ],
    },
  ],
  answers2: [],
  finalStoryFinal: [{ title: '提供価値', body: '地域の中小製造業に点検サービスを届ける。' }],
};

const BRIDGE_MARKER = '【STAGE3 戦略展開ブリッジ】';
const EXECUTION_HEADER = '# 部門・OKR・実行計画';

function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject)
          : () => proxy,
    }
  );
  return proxy;
}

const adminFake = { from: () => chain({ data: [], error: null }) };

function req(query: string, opts: { companyId?: string; userId?: string; bearer?: boolean } = {}) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.bearer === false ? {} : { authorization: 'Bearer t' }),
    },
    body: JSON.stringify({
      userId: opts.userId ?? USER,
      strategyId: STRATEGY_OF_A,
      companyId: opts.companyId ?? COMPANY_A,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

function lineIn(prompt: string, needle: string): string {
  const line = prompt.split('\n').find((l) => l.includes(needle));
  if (!line) throw new Error(`line not found: ${needle}`);
  return line;
}

async function ask(query: string) {
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: STAGE4_ROW, error: null });
  const res = await POST(req(query));
  expect(res.status).toBe(200);
  const body = await res.json();
  const prompt: string = mockChatCreate.mock.calls[0][0].messages[0].content;
  return { mode: body.resolvedMode as string, prompt };
}

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(adminFake);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_A);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY_A, role: 'admin', departmentId: null });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
});

describe('STAGE4 の問いに、正しい担当・期限・目標が届く（モック）', () => {
  it('1. 営業部門は来月何をする予定か？：営業部が先頭で、マイルストーンと期限が付く', async () => {
    const { mode, prompt } = await ask('営業部門は来月何をする予定か？');
    expect(mode).toBe('advisor');
    expect(prompt.indexOf('■ 部門: 営業部')).toBeLessThan(prompt.indexOf('■ 部門: 製造部'));
    expect(lineIn(prompt, 'KR: 新規商談数')).toContain('マイルストーン 提案資料の完成（2026-12）');
    expect(lineIn(prompt, 'KR: 新規商談数')).toContain('期限 2027-03');
  });

  it('2. 誰がこのプロジェクトを担当しているか？：プロジェクトの担当は佐藤花子で、KR の担当は各KRのものだけ', async () => {
    const { mode, prompt } = await ask('誰がこのプロジェクトを担当しているか？');
    expect(mode).toBe('advisor');
    expect(lineIn(prompt, 'プロジェクト: 新規顧客開拓')).toContain('担当 佐藤花子');
    expect(lineIn(prompt, 'プロジェクト: 新規顧客開拓')).not.toContain('鈴木一郎');
    expect(lineIn(prompt, 'KR: 継続率')).toContain('担当 鈴木一郎');
    expect(lineIn(prompt, 'KR: 継続率')).not.toContain('佐藤花子');
  });

  it('3. この施策はいつまでに完了するのか？：KR ごとの期限が、そのKRの行に出る', async () => {
    const { mode, prompt } = await ask('この施策はいつまでに完了するのか？');
    expect(mode).toBe('advisor');
    expect(lineIn(prompt, 'KR: 新規商談数')).toContain('期限 2027-03');
    expect(lineIn(prompt, 'KR: 継続率')).toContain('期限 2027-06');
    expect(lineIn(prompt, 'KR: 不良率')).toContain('期限 2027-01');
  });

  it('4. 営業部門のOKRは全社戦略と整合しているか？：登録された価値指標との対応だけを出し、未登録は未登録と書く', async () => {
    const { mode, prompt } = await ask('営業部門のOKRは全社戦略と整合しているか？');
    expect(mode).toBe('advisor');
    expect(prompt).toContain(BRIDGE_MARKER);
    expect(lineIn(prompt, 'プロジェクト: 新規顧客開拓')).toContain('価値指標との対応（登録）: 売上成長');
    expect(lineIn(prompt, 'プロジェクト: 工程の標準化')).toContain('価値指標との対応（登録）: 未登録');
  });

  it('5. 現在の実行計画で売上目標を達成できるか？：目標値と単位が出る。費用・人的投資は出ない', async () => {
    const { mode, prompt } = await ask('現在の実行計画で売上目標を達成できるか？');
    expect(mode).toBe('advisor');
    expect(lineIn(prompt, 'KR: 新規商談数')).toContain('目標 120件');
    expect(lineIn(prompt, 'KR: 継続率')).toContain('目標 95%');
    expect(prompt).toContain('受注率 +2pt');
    for (const secret of ['1200000', '3400000', 'uid-secret', 'HIRE', 'TRAINING']) {
      expect(prompt).not.toContain(secret);
    }
    expect(prompt).toContain(EXECUTION_HEADER);
  });
});

describe('認証・所属・会社の一致は従来どおり必須', () => {
  it('ログインがない場合は、企業データを読まず、AIも呼ばない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
    const res = await POST(req('営業部門は来月何をする予定か？', { bearer: false }));
    expect(res.status).toBe(401);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('別の利用者の名義では、企業データを読まない', async () => {
    const res = await POST(req('営業部門は来月何をする予定か？', { userId: 'someone-else' }));
    expect(res.status).toBe(403);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('戦略が別の会社に属する場合は拒否し、他社のデータを読まない', async () => {
    (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_B);
    const res = await POST(req('営業部門は来月何をする予定か？', { companyId: COMPANY_A }));
    expect(res.status).toBe(403);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('所属がない利用者は拒否する', async () => {
    (requireMembership as jest.Mock).mockResolvedValue(null);
    const res = await POST(req('営業部門は来月何をする予定か？'));
    expect(res.status).toBe(403);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('企業データは、戦略IDと会社IDの両方で絞って読む', async () => {
    await ask('営業部門は来月何をする予定か？');
    expect(getFullStrategyDataByStrategyId).toHaveBeenCalledWith(STRATEGY_OF_A, COMPANY_A, expect.anything());
  });
});

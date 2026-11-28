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
import { getAuthUserIdFromBearer, requireMembership, resolveCompanyIdFromStrategyId } from '@/lib/server/rbacGuard';
import { POST } from './route';

const USER = 'user-1';
const STRATEGY = 'strategy-a';
const COMPANY = 'company-a';
const BLOCK_TITLE = '【操作の提案（経営課題）】';

const EMPTY_ADMIN = {
  from() {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return builder;
  },
};

function strategyRow(): Record<string, unknown> {
  return {
    id: STRATEGY,
    companyName: 'モック株式会社',
    departments: [{ id: 'd1', name: '営業部', mission: '新規', projects: [{ id: 'p1', title: '新規顧客開拓', okrsV2: [] }] }],
    answers2: [],
    financePL: [{ year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000 }],
    financeBS: [{ year: 2025, cash: 300_000_000 }],
    fiscalYearEnd: '3',
    simulationResults: [],
    companyTargets: [],
  };
}

type Turn = { role: 'user' | 'assistant'; content: string };

function req(messages: Turn[], extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({ userId: USER, strategyId: STRATEGY, companyId: COMPANY, messages, ...extra }),
  });
}

function setRole(role: 'admin' | 'manager' | 'member') {
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role, departmentId: null });
}

function modelSays(content: string) {
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content } }] });
}

async function consult(messages: Turn[], extra: Record<string, unknown> = {}) {
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: strategyRow(), error: null });
  const res = await POST(req(messages, extra));
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, any>;
  const system = mockChatCreate.mock.calls.at(-1)?.[0].messages[0].content as string;
  return { body, system, calls: mockChatCreate.mock.calls.length };
}

const MARK = (json: string) => `<<OP ${json}>>`;
const CLEAR = { kind: 'stage1.issue', title: '新規顧客の獲得力が弱い', description: '既存顧客は増えるが、新規の商談が増えないと話された。' };

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(EMPTY_ADMIN);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY);
  setRole('admin');
  modelSays('OK');
});

describe('経営相談から操作候補を得る（1回のAI応答）：許可と検証', () => {
  it('管理職以上の通常相談には、操作候補の書き方の指示を加える（追加の呼び出しはしない）', async () => {
    modelSays('新規顧客が伸びにくい原因を一緒に整理しましょう。');
    const { system, calls } = await consult([{ role: 'user', content: '最近、新規顧客がなかなか増えないんですよ' }]);
    expect(calls).toBe(1);
    expect(system).toContain(BLOCK_TITLE);
  });

  it('一般の利用者には、操作候補の指示を加えず、候補が返っても捨てる', async () => {
    setRole('member');
    modelSays(`新規顧客の話です。\n${MARK(JSON.stringify(CLEAR))}`);
    const { body, system } = await consult([{ role: 'user', content: 'それを経営課題に入れておいて' }]);
    expect(system).not.toContain(BLOCK_TITLE);
    expect(body.operationCandidate).toBeUndefined();
    expect(body.content).not.toContain('<<OP');
  });

  it('明確な指示（経営課題として〇〇を追加）の候補は、印を本文から外して返す（シナリオA・B）', async () => {
    modelSays(`承知しました。\n${MARK(JSON.stringify(CLEAR))}`);
    const { body } = await consult(
      [
        { role: 'user', content: '最近、新規顧客が増えない' },
        { role: 'assistant', content: '経営課題として整理することを提案します。' },
        { role: 'user', content: 'それを経営課題に入れておいて' },
      ],
      { priorOffer: 'stage1.issue' },
    );
    expect(body.operationCandidate).toEqual({ kind: 'stage1.issue', title: CLEAR.title, description: CLEAR.description });
    expect(body.content).toBe('承知しました。');
  });

  it('短い同意（お願いします）は、直前の操作提案がある時だけ候補にする（シナリオC）', async () => {
    modelSays(`かしこまりました。\n${MARK(JSON.stringify(CLEAR))}`);
    const withOffer = await consult(
      [
        { role: 'user', content: '新規顧客が増えない' },
        { role: 'assistant', content: '経営課題として記録しますか。' },
        { role: 'user', content: 'お願いします' },
      ],
      { priorOffer: 'stage1.issue' },
    );
    expect(withOffer.body.operationCandidate?.title).toBe(CLEAR.title);

    modelSays(`かしこまりました。\n${MARK(JSON.stringify(CLEAR))}`);
    const withoutOffer = await consult([{ role: 'user', content: 'お願いします' }]);
    expect(withoutOffer.body.operationCandidate).toBeUndefined();
  });

  it('仮定・検討の発言は、候補にしない（シナリオD）', async () => {
    modelSays(`そうですね、整理してみましょう。\n${MARK(JSON.stringify(CLEAR))}`);
    const { body } = await consult([{ role: 'user', content: '新規顧客が増えないことを経営課題にした方がいいかな' }]);
    expect(body.operationCandidate).toBeUndefined();
    expect(body.content).toBe('そうですね、整理してみましょう。');
  });

  it('候補の形が正しくなければ（JSONの誤り・題名が長すぎる）捨て、本文は返す', async () => {
    modelSays(`回答です。\n<<OP {"kind":"stage1.issue","title":"` + 'あ'.repeat(101) + `"}>>\n<<OP {broken}>>`);
    const { body } = await consult([{ role: 'user', content: '経営課題として新規顧客の獲得力を追加して' }]);
    expect(body.operationCandidate).toBeUndefined();
    expect(body.content).toBe('回答です。');
  });

  it('提案のみの印（<<OFFER>>）は、画面に提案の有無だけを返し、保存に関係しない', async () => {
    modelSays('経営課題として整理しますか。\n<<OFFER stage1.issue>>');
    const { body } = await consult([{ role: 'user', content: '新規顧客が増えない' }]);
    expect(body.operationOffer).toBe('stage1.issue');
    expect(body.operationCandidate).toBeUndefined();
    expect(body.content).toBe('経営課題として整理しますか。');
  });

  it('相談の回答そのものは、印がなければ変わらない（通常相談の品質を保つ）', async () => {
    modelSays('新規顧客の伸びにくさは、商品の届け方か、商談の数かで打ち手が変わります。');
    const { body } = await consult([{ role: 'user', content: '新規顧客が増えない原因を考えたい' }]);
    expect(body.content).toBe('新規顧客の伸びにくさは、商品の届け方か、商談の数かで打ち手が変わります。');
    expect(body.operationCandidate).toBeUndefined();
    expect(body.operationOffer).toBeUndefined();
  });
});

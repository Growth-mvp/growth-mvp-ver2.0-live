import { NextRequest } from 'next/server';
import { proposalKeyOf } from '@/lib/aiOperations/proposal';

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

describe('経営相談から操作の提案・直接の操作を得る（1回のAI応答）：許可と検証', () => {
  const STAGE2_CTX = {
    targets: [],
    swot: { strength: '', weakness: '', opportunity: '', threat: '' },
    answers: {},
    focusQuestionId: null,
    questionIds: ['ch0-q1'],
  };
  const CEO = { kind: 'ceo.append', text: '収益性を高め、社員の給与を上げられる会社にする' };
  const PROPOSE = (json: string) => `<<PROPOSE ${json}>>`;

  it('管理職以上の通常相談には、提案の書き方の指示を加える（追加の呼び出しはしない）', async () => {
    modelSays('新規顧客が伸びにくい原因を一緒に整理しましょう。');
    const { system, calls } = await consult([{ role: 'user', content: '最近、新規顧客がなかなか増えないんですよ' }]);
    expect(calls).toBe(1);
    expect(system).toContain(BLOCK_TITLE);
  });

  it('一般の利用者には、提案の指示を加えず、提案が返っても捨てる', async () => {
    setRole('member');
    modelSays(`新規顧客の話です。\n${PROPOSE(JSON.stringify(CLEAR))}`);
    const { body, system } = await consult([{ role: 'user', content: '新規顧客が増えない' }]);
    expect(system).not.toContain(BLOCK_TITLE);
    expect(body.operationProposal).toBeUndefined();
    expect(body.content).not.toContain('<<PROPOSE');
  });

  it('提案は、同意を待つための内容として返す。直接の候補にはせず、保存もしない', async () => {
    modelSays(`経営課題として記録しましょうか？\n${PROPOSE(JSON.stringify(CLEAR))}`);
    const { body } = await consult([{ role: 'user', content: '新規顧客が増えない' }]);
    expect(body.operationProposal).toEqual({ op: CLEAR });
    expect(body.operationCandidate).toBeUndefined();
    expect(body.content).toBe('経営課題として記録しましょうか？');
  });

  it('同意の発言では、AIが印を書いても内容を作り直さず、直接の候補にもしない', async () => {
    modelSays(`かしこまりました。\n${MARK(JSON.stringify(CLEAR))}`);
    const { body } = await consult(
      [
        { role: 'user', content: '新規顧客が増えない' },
        { role: 'assistant', content: '経営課題として記録しましょうか？' },
        { role: 'user', content: 'お願いします' },
      ],
      { proposalOpen: true },
    );
    expect(body.operationCandidate).toBeUndefined();
    expect(body.operationProposal).toBeUndefined();
  });

  it('明確な依頼は直接の候補として返す。指示語（それを）は、提案が開いているときだけ', async () => {
    modelSays(`承知しました。\n${MARK(JSON.stringify(CLEAR))}`);
    const direct = await consult([{ role: 'user', content: '経営課題として新規顧客の獲得力を追加して' }]);
    expect(direct.body.operationCandidate).toEqual({ kind: 'stage1.issue', title: CLEAR.title, description: CLEAR.description });
    expect(direct.body.content).toBe('承知しました。');

    modelSays(`承知しました。\n${MARK(JSON.stringify(CLEAR))}`);
    const deictic = await consult([{ role: 'user', content: 'それを経営課題に入れておいて' }]);
    expect(deictic.body.operationCandidate).toBeUndefined();

    modelSays(`承知しました。\n${MARK(JSON.stringify(CLEAR))}`);
    const withOpen = await consult([{ role: 'user', content: 'それを経営課題に入れておいて' }], { proposalOpen: true });
    expect(withOpen.body.operationCandidate?.title).toBe(CLEAR.title);
  });

  it('否定された提案の内容は、同じ相談の中で繰り返し提案しない', async () => {
    modelSays(`経営課題として記録しましょうか？\n${PROPOSE(JSON.stringify(CLEAR))}`);
    const { body } = await consult([{ role: 'user', content: '新規顧客が増えない' }], {
      declinedProposalKeys: [proposalKeyOf({ kind: 'stage1.issue', title: CLEAR.title, description: CLEAR.description })],
    });
    expect(body.operationProposal).toBeUndefined();
    expect(body.content).toBe('経営課題として記録しましょうか？');
  });

  it('STAGE2の提案は、管理者の相談に限り、開いている画面を問わず返す', async () => {
    setRole('admin');
    modelSays(`経営者の思いに追記しましょうか？\n${PROPOSE(JSON.stringify(CEO))}`);
    const admin = await consult([{ role: 'user', content: '収益性を高めて給与を上げたい' }], {
      stage2Context: STAGE2_CTX,
      stage2Screen: false,
    });
    expect(admin.body.operationProposal).toEqual({ op: CEO });

    setRole('manager');
    modelSays(`経営者の思いに追記しましょうか？\n${PROPOSE(JSON.stringify(CEO))}`);
    const manager = await consult([{ role: 'user', content: '収益性を高めて給与を上げたい' }], {
      stage2Context: STAGE2_CTX,
      stage2Screen: false,
    });
    expect(manager.body.operationProposal).toBeUndefined();
  });

  it('STAGE2の直接の操作は、STAGE2の画面を開いているときだけ返す', async () => {
    modelSays(`承知しました。\n${MARK(JSON.stringify(CEO))}`);
    const away = await consult([{ role: 'user', content: '今の話を経営者の思いに追記して' }], {
      stage2Context: STAGE2_CTX,
      stage2Screen: false,
    });
    expect(away.body.stage2Operation).toBeUndefined();

    modelSays(`承知しました。\n${MARK(JSON.stringify(CEO))}`);
    const onScreen = await consult([{ role: 'user', content: '今の話を経営者の思いに追記して' }], {
      stage2Context: STAGE2_CTX,
      stage2Screen: true,
    });
    expect(onScreen.body.stage2Operation).toEqual(CEO);
  });

  it('印が2つ以上なら、提案も候補も返さず、本文だけを返す（安全側）', async () => {
    modelSays(`回答です。\n${PROPOSE(JSON.stringify(CLEAR))}\n${PROPOSE(JSON.stringify({ ...CLEAR, title: '別の課題' }))}`);
    const { body } = await consult([{ role: 'user', content: '新規顧客が増えない' }]);
    expect(body.operationProposal).toBeUndefined();
    expect(body.operationCandidate).toBeUndefined();
    expect(body.content).toBe('回答です。');
  });
});

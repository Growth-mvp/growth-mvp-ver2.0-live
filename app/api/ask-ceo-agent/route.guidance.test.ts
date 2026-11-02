import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockOpenAICtor = jest.fn();
const mockClassifyHeuristic = jest.fn();
const mockClassifyLLM = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } };
    constructor(opts: unknown) {
      mockOpenAICtor(opts);
    }
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
jest.mock('@/lib/agentPrompt', () => ({
  __esModule: true,
  default: jest.fn(() => 'AGENT_PROMPT'),
  buildExternalFinancialBlock: jest.fn(() => ''),
}));
jest.mock('@/lib/supabase/agentLogs', () => ({
  insertAgentLog: jest.fn(async () => undefined),
}));
jest.mock('@/lib/intentRouter', () => ({
  classifyHeuristic: (...args: unknown[]) => mockClassifyHeuristic(...args),
  classifyLLM: (...args: unknown[]) => mockClassifyLLM(...args),
  chooseBetter: (a: unknown) => a,
}));
jest.mock('@/lib/facilitatorProtocol', () => ({ buildFacilitatorBlock: () => '' }));
jest.mock('@/lib/facilitatorSchema', () => ({
  buildJSONOutputInstruction: () => '',
  safeParseFacilitatorJSON: () => null,
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => '' }));
jest.mock('@/lib/autoModeRouter', () => ({ detectAutoMode: () => ({ mode: 'advisor', reasons: [] }) }));
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
const GUIDE_HEADER = '【操作案内（登録簿に基づく）】';
const GUIDE_END = '8. 最後に、次に行う一歩を示す。';

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

function req(body: unknown) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });
}

function bodyFor(query: string, screenId: string | null, extra: Record<string, unknown> = {}) {
  return {
    userId: USER,
    strategyId: STRATEGY_OF_A,
    companyId: COMPANY_A,
    messages: [{ role: 'user', content: query }],
    ...(screenId ? { screen: { screenId } } : {}),
    ...extra,
  };
}

function systemContent(): string {
  return mockChatCreate.mock.calls[0][0].messages[0].content;
}

function guidanceBlock(content: string): string {
  const start = content.indexOf(GUIDE_HEADER);
  const end = content.indexOf(GUIDE_END);
  if (start < 0 || end < 0) return '';
  return content.slice(start, end + GUIDE_END.length);
}

function memberWithRole(role: 'admin' | 'manager' | 'member') {
  return async (_admin: unknown, _user: unknown, companyId: string) =>
    companyId === COMPANY_A ? { userId: USER, companyId: COMPANY_A, role, departmentId: null } : null;
}

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(adminFake);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_A);
  (requireMembership as jest.Mock).mockImplementation(memberWithRole('admin'));
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
    data: { id: STRATEGY_OF_A, departments: [], answers2: [], finalStory: [] },
    error: null,
  });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
  mockClassifyHeuristic.mockReturnValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  mockClassifyLLM.mockRejectedValue(new Error('LLM 分類は無効'));
});

describe('B3 回答品質の回帰（実 API 評価の 8 問）', () => {
  it('q1 初めて使うんだけど、何から始めたらいい？：最初の画面（STAGE1）の操作を示す', async () => {
    await POST(req(bodyFor('初めて使うんだけど、何から始めたらいい？', 'home')));
    expect(guidanceBlock(systemContent())).toContain('■ STAGE1 会社の現状はどうか（/stage1）');
  });

  it('q2 この画面では何をすればいい？：現在の画面の操作を、ラベルつきで示す', async () => {
    await POST(req(bodyFor('この画面では何をすればいい？', 'stage1')));
    expect(systemContent()).toContain('「会社名」');
    expect(systemContent()).toContain('■ STAGE1 会社の現状はどうか（/stage1）');
  });

  it('q3 SWOT分析って何？ どうすればいいの？：操作の質問として扱い、STAGE2 の操作を示す', async () => {
    await POST(req(bodyFor('SWOT分析って何？ どうすればいいの？', 'stage2')));
    expect(guidanceBlock(systemContent())).toContain('■ STAGE2 会社は何を目指すのか（/stage2）');
  });

  it('q4 経営計画書を作りたい。：経営計画書の画面の操作を示す', async () => {
    (requireMembership as jest.Mock).mockImplementation(memberWithRole('manager'));
    await POST(req(bodyFor('経営計画書を作りたい。', 'plan-hub')));
    expect(systemContent()).toContain('■ 経営計画書（/report）');
    expect(systemContent()).toContain('「計画書を見る」');
  });

  it('q5 組織変革ルームは何のためにあるの？：組織変革ルームの画面を示す', async () => {
    (requireMembership as jest.Mock).mockImplementation(memberWithRole('member'));
    await POST(req(bodyFor('組織変革ルームは何のためにあるの？', 'stage1')));
    expect(systemContent()).toContain('■ 組織変革・違和感を伝えるルーム（/org-transformation）');
    expect(systemContent()).not.toContain('■ STAGE1');
  });

  it('q6 この戦略で本当に売上が伸びるの？：経営相談として扱い、操作案内を付けない', async () => {
    await POST(req(bodyFor('この戦略で本当に売上が伸びるの？', 'stage2')));
    expect(systemContent()).not.toContain(GUIDE_HEADER);
  });

  it('q7 社員が全然動いてくれない。どうすればいい？：経営相談として扱い、操作案内を付けない', async () => {
    (requireMembership as jest.Mock).mockImplementation(memberWithRole('manager'));
    await POST(req(bodyFor('社員が全然動いてくれない。どうすればいい？', 'stage1')));
    expect(systemContent()).not.toContain(GUIDE_HEADER);
  });

  it('q8 そんなボタンが見当たらないけど？：推測せず、ボタン名か画面を一つだけ尋ねる', async () => {
    (requireMembership as jest.Mock).mockImplementation(memberWithRole('member'));
    await POST(req(bodyFor('そんなボタンが見当たらないけど？', 'stage1')));
    const block = guidanceBlock(systemContent());
    expect(block).toContain('特定できません');
    expect(block).toContain('画面上のボタンの表示名');
    expect(block).not.toContain('（stage1.');
    expect(block).not.toContain('「分析を更新」');
  });
});

describe('複合の質問（操作と経営相談）', () => {
  it('操作と経営相談を含む質問には、補助の注意を付け、操作の件数を絞る', async () => {
    await POST(req(bodyFor('経営計画書を作りたい。この戦略で売上は伸びる？', 'plan-hub')));
    const block = guidanceBlock(systemContent());
    expect(block).toContain('※ この質問には経営相談の要素も含まれています');
    expect((block.match(/^- 「/gm) ?? []).length).toBeLessThanOrEqual(2);
  });
});

describe('LLM 意図判定の有無による経路（通常経路とヒューリスティックのみ）', () => {
  const QUERY = 'この画面では何をすればいい？';

  it('ヒューリスティックのみの経路（確信度が高く、LLM を呼ばない）', async () => {
    mockClassifyHeuristic.mockReturnValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
    const res = await POST(req(bodyFor(QUERY, 'stage1')));
    expect(res.status).toBe(200);
    expect(mockClassifyLLM).not.toHaveBeenCalled();
    expect(guidanceBlock(systemContent())).toContain('■ STAGE1');
  });

  it('LLM 意図判定を含む通常経路（確信度が低く、LLM を呼ぶ）でも、操作案内は同じ', async () => {
    mockClassifyHeuristic.mockReturnValue({ stage: 'generic', confidence: 0.3, reasons: [] });
    mockClassifyLLM.mockResolvedValue({ stage: 'manual', confidence: 0.8, reasons: ['llm'] });
    const res = await POST(req(bodyFor(QUERY, 'stage1')));
    expect(res.status).toBe(200);
    expect(mockClassifyLLM).toHaveBeenCalledTimes(1);
    expect(guidanceBlock(systemContent())).toContain('■ STAGE1');
  });

  it('LLM 意図判定が失敗しても、ヒューリスティックの結果で回答し、操作案内は同じ', async () => {
    mockClassifyHeuristic.mockReturnValue({ stage: 'generic', confidence: 0.3, reasons: [] });
    mockClassifyLLM.mockRejectedValue(new Error('timeout'));
    const res = await POST(req(bodyFor(QUERY, 'stage1')));
    expect(res.status).toBe(200);
    expect(guidanceBlock(systemContent())).toContain('■ STAGE1');
  });
});

describe('画面 ID の検証（不正・未知の画面）', () => {
  it('未知の画面 ID は画面として扱わず、画面を特定できないと伝える', async () => {
    const res = await POST(req(bodyFor('この画面では何をすればいい？', 'stage9')));
    expect(res.status).toBe(200);
    expect(systemContent()).toContain('現在の画面を特定できない');
    expect(systemContent()).not.toContain('■ STAGE');
  });

  it('画面情報が無い場合（pathname のみ）は、画面を推測しない', async () => {
    const res = await POST(
      req({ ...bodyFor('この画面では何をすればいい？', null), screen: { pathname: '/stage1' } })
    );
    expect(res.status).toBe(200);
    expect(systemContent()).toContain('現在の画面を特定できない');
  });

  it('用途未確定の画面（/stage4 の旧ページ）は、操作を案内しない', async () => {
    const res = await POST(req(bodyFor('この画面では何をすればいい？', 'stage4-page')));
    expect(res.status).toBe(200);
    expect(systemContent()).not.toContain('（stage4.');
    expect(systemContent()).not.toContain('/stage4');
  });
});

describe('権限・登録情報の不足・未登録の操作', () => {
  it('一般社員には、管理者のみの操作（たたき台の生成）を案内しない', async () => {
    (requireMembership as jest.Mock).mockImplementation(memberWithRole('member'));
    await POST(req(bodyFor('たたき台を生成するには？', 'stage2')));
    expect(systemContent()).not.toContain('「たたき台を生成」（stage2.generate-draft）');
    expect(systemContent()).toContain('権限により、一部の操作は案内の対象外です');
  });

  it('登録にないボタンを尋ねられた場合は、登録にない操作を案内せず、表示名を尋ねる', async () => {
    await POST(req(bodyFor('ホームのレポートボタンはどこ？', 'stage1')));
    expect(systemContent()).toContain('登録にない操作は案内しない');
    expect(systemContent()).toContain('画面上のボタンの表示名');
  });
});

describe('企業スコープと旧データ', () => {
  it('別企業の strategy に対して画面情報を付けても、企業の不一致で 403 になり、AI を呼ばない', async () => {
    (requireMembership as jest.Mock).mockImplementation(memberWithRole('admin'));
    const res = await POST(req(bodyFor('この画面では何をすればいい？', 'stage1', { companyId: COMPANY_B })));
    expect(res.status).toBe(403);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('旧操作ガイド（operationData）の内容は使わない（STAGE4 の旧パス /stage4 を案内しない）', async () => {
    await POST(req(bodyFor('STAGE4の入力はどこ？', 'stage4')));
    expect(systemContent()).toContain('■ STAGE4 現場は何をするのか（/okr）');
    expect(systemContent()).not.toContain('/stage4');
    expect(systemContent()).not.toContain('【参考：操作ガイド情報】');
    expect(systemContent()).not.toContain('【ご注意】ユーザーは操作方法');
  });

  it('旧 MANUAL_QA の回答（OKR はカスケードで入力、など）は使わない', async () => {
    await POST(req(bodyFor('OKRはどこに入力するの？', 'stage4')));
    expect(systemContent()).not.toContain('【OKRの入力場所】');
    expect(systemContent()).not.toContain('「カスケード（/cascade）」を開く');
  });

  it('案内の注入量は上限内に収まり、件数も 6 件以内', async () => {
    await POST(req(bodyFor('STAGE2のたたき台を生成するには？', 'stage2')));
    const block = guidanceBlock(systemContent());
    expect(block.length).toBeGreaterThan(0);
    expect(block.length).toBeLessThanOrEqual(3000);
    expect((block.match(/^- 「/gm) ?? []).length).toBeLessThanOrEqual(6);
  });
});

describe('名称の統一（screenRegistry を基準にする）', () => {
  it('AI に渡す段階の名称は、ナビ・登録簿の名称と一致する', async () => {
    await POST(req(bodyFor('この画面では何をすればいい？', 'stage1')));
    const content = systemContent();
    expect(content).toContain('STAGE1 会社の現状はどうか');
    expect(content).not.toContain('STAGE1 財務・事業構造');
  });
});

describe('GROWTH SHIFT の支援の姿勢（基礎ガイドの原則）', () => {
  it('判断の主体は人で、AIは支援することを示し、業績は保証されないと明記する', async () => {
    await POST(req(bodyFor('この戦略を進めるうえでの考え方を教えて', null)));
    const content = systemContent();
    expect(content).toContain('## 支援の姿勢');
    expect(content).toContain('最終的な判断と対話の主体は人です。AIは論点の整理、問い、たたき台、確認を支援します。');
    expect(content).toContain('利用するだけで保証されるものではありません');
    expect(content).toContain('経営者と社員の対話と納得が欠かせません');
  });
});

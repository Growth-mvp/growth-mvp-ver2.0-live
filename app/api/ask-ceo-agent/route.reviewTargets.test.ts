import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockResponsesCreate = jest.fn();
const mockClassifyLLM = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } };
    responses = { create: (...args: unknown[]) => mockResponsesCreate(...args) };
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

type Row = Record<string, any>;

const USER = 'user-1';
const COMPANY_ID = 'company-1';
const QUESTION = '量産後の粗利額を確認したい';
const MARKER_R1 = '粗利の確認が必要です。\n[見直し候補: r1]';

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

function strategy(id: string, departments: Row[], overrides: Row = {}): Row {
  return {
    id,
    companyName: '日本製罐株式会社',
    industry: 'manufacturing',
    businessContent: '美術缶を製造・販売',
    businessSegments: [],
    departments,
    answers2: [],
    financePL: [],
    financeBS: [],
    fiscalYearEnd: '3',
    simulationResults: [],
    companyTargets: [],
    ...overrides,
  };
}

const SALES_DEPT = {
  id: 'dept-sales',
  name: '営業部',
  projects: [
    {
      id: 'proj-new',
      title: '新規開拓',
      reason: '受注件数を増やす',
      okrsV2: [
        { id: 'kr-1', label: '有償開発受注件数', target: 12, unit: '件', actual: { value: 987654 } },
        { id: 'kr-2', label: '量産後の案件別粗利額', target: null, unit: null },
      ],
    },
  ],
};

const SAME_NAME_PROD_DEPT = {
  id: 'dept-prod',
  name: '製造部',
  projects: [{ id: 'proj-new', title: '新規開拓', okrsV2: [{ id: 'kr-3', label: '歩留まり', target: 95, unit: '%' }] }],
};

const NO_ID_PROJECT_STRATEGY_DEPT = {
  id: 'dept-x',
  name: '企画部',
  projects: [{ title: 'ID無しの案件', okrsV2: [{ id: 'kr-x', label: 'ID無しKPI', target: 1, unit: '件' }] }],
};

function req(query: string, strategyId = 'strategy-1') {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId,
      companyId: COMPANY_ID,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

async function ask(
  question: string,
  row: Row,
  reply: string,
  strategyId = 'strategy-1',
  finishReason?: string
) {
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: row, error: null });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: reply }, finish_reason: finishReason }] });
  const res = await POST(req(question, strategyId));
  const chatArgs = mockChatCreate.mock.calls.at(-1)?.[0];
  const body = await res.json();
  return {
    status: res.status,
    system: (chatArgs?.messages?.[0]?.content as string) ?? '',
    content: body.content as string,
    reviewTargets: body.reviewTargets as Array<Record<string, any>>,
  };
}

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.CEO_CHAT_WEB_SEARCH_ENABLED;
  (getSupabaseAdmin as jest.Mock).mockReturnValue(EMPTY_ADMIN);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_ID);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY_ID, role: 'admin', departmentId: null });
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  mockResponsesCreate.mockResolvedValue({ output: [] });
});

describe('STAGE4の見直し案内（外部検索OFF）', () => {
  it('実在するプロジェクトを、サーバーが作ったリンクで案内する', async () => {
    const r = await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), MARKER_R1);
    expect(r.status).toBe(200);
    expect(r.reviewTargets).toEqual([
      expect.objectContaining({
        stage: 4,
        candidateId: 'r1',
        href: '/okr?projectId=proj-new&deptId=dept-sales',
        projectTitle: '新規開拓',
        checkItems: ['KPI・目標値'],
      }),
    ]);
    expect(r.content).toBe('粗利の確認が必要です。');
    expect(r.content).not.toContain('見直し候補');
  });

  it('候補一覧は、登録済みの名称とIDを渡し、実績値は渡さない', async () => {
    const r = await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), MARKER_R1);
    expect(r.system).toContain('【見直し候補（STAGE4・登録済みの実在データ）】');
    expect(r.system).toContain('- r1｜部門: 営業部｜プロジェクト: 新規開拓');
    expect(r.system).toContain('量産後の案件別粗利額（目標未設定）');
    expect(r.system).not.toContain('987654');
  });

  it('AIが存在しないIDを書いた場合は、案内しない（架空のリンクを作らない）', async () => {
    const r = await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '本文です。\n[見直し候補: r99]');
    expect(r.reviewTargets).toEqual([]);
    expect(r.content).toBe('本文です。');
  });

  it('AIがURLやプロジェクトIDを本文に書いても、それを案内先にしない', async () => {
    const r = await ask(
      QUESTION,
      strategy('strategy-1', [SALES_DEPT]),
      '/okr?projectId=proj-new を開いてください。'
    );
    expect(r.reviewTargets).toEqual([]);
    expect(r.content).toBe('/okr?projectId=proj-new を開いてください。');
  });

  it('見直しが不要な回答には、案内も候補の表示も付けない', async () => {
    const r = await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '一般的な助言です。');
    expect(r.reviewTargets).toEqual([]);
    expect(r.content).toBe('一般的な助言です。');
  });

  it('プロジェクトIDが無い案件は、候補にも案内にも出さない', async () => {
    const r = await ask(QUESTION, strategy('strategy-1', [NO_ID_PROJECT_STRATEGY_DEPT]), MARKER_R1);
    expect(r.system).not.toContain('見直し候補（STAGE4');
    expect(r.reviewTargets).toEqual([]);
  });

  it('同名の案件は、IDと部門で区別する', async () => {
    const r = await ask(
      QUESTION,
      strategy('strategy-1', [SALES_DEPT, SAME_NAME_PROD_DEPT]),
      '確認してください。\n[見直し候補: r2]'
    );
    expect(r.reviewTargets).toEqual([
      expect.objectContaining({ candidateId: 'r2', href: '/okr?projectId=proj-new&deptId=dept-prod', departmentName: '製造部' }),
    ]);
  });

  it('企業を切り替えると、前の企業の候補は次の回答に残らない', async () => {
    await ask(QUESTION, strategy('strategy-A', [SALES_DEPT]), MARKER_R1, 'strategy-A');
    const other = strategy('strategy-B', [
      { id: 'dept-b', name: '販売部', projects: [{ id: 'proj-b', title: '別会社の案件' }] },
    ], { companyName: '別会社株式会社', businessContent: '小売店舗' });
    const r = await ask(QUESTION, other, MARKER_R1, 'strategy-B');
    expect(r.system).not.toContain('新規開拓');
    expect(r.reviewTargets).toEqual([
      expect.objectContaining({ candidateId: 'r1', strategyId: 'strategy-B', href: '/okr?projectId=proj-b&deptId=dept-b' }),
    ]);
  });

  it('一般的な経営知識の質問（企業データを使わない経路）では、候補を渡さず、案内も付けない', async () => {
    const r = await ask('売上高とは何ですか？', strategy('strategy-1', [SALES_DEPT]), '一般的な説明です。');
    expect(r.system).not.toContain('見直し候補（STAGE4');
    expect(r.reviewTargets).toEqual([]);
  });
});

describe('STAGE4の見直し案内（外部検索ON）', () => {
  beforeEach(() => {
    process.env.CEO_CHAT_WEB_SEARCH_ENABLED = 'true';
  });

  it('外部検索を使った回答でも、見直し案内は同じ仕組みで処理される', async () => {
    mockResponsesCreate.mockResolvedValue({ output: [] });
    const r = await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), MARKER_R1);
    expect(r.status).toBe(200);
    expect(r.reviewTargets).toHaveLength(1);
    expect(r.content).not.toContain('見直し候補');
  });
});

describe('診断ログ（stage4_review）', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const reviewLog = (): Record<string, unknown> | undefined =>
    logSpy.mock.calls.find((c) => c[2] === 'stage4_review')?.[3] as Record<string, unknown> | undefined;

  it('案内が返った場合は returned と件数を記録する', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), MARKER_R1);
    expect(reviewLog()).toMatchObject({ reason: 'returned', stage4Total: 1, returned: 1, markerLines: 1, validMarkerLines: 1, matchedIds: 1 });
  });

  it('マーカーが無い場合は no_marker を記録する', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '一般的な助言です。');
    expect(reviewLog()).toMatchObject({ reason: 'no_marker', markerLines: 0, returned: 0 });
  });

  it('形式が合わないマーカーは marker_format_invalid を記録する', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '本文\n【見直し候補: r1】');
    expect(reviewLog()).toMatchObject({ reason: 'marker_format_invalid', markerLines: 1, validMarkerLines: 0 });
  });

  it('提示していないIDは marker_id_mismatch を記録する', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '本文\n[見直し候補: r99]');
    expect(reviewLog()).toMatchObject({ reason: 'marker_id_mismatch', markerIds: 1, matchedIds: 0, unmatchedIds: 1 });
  });

  it('候補が無い場合は no_candidates を記録する', async () => {
    await ask(QUESTION, strategy('strategy-1', []), '本文');
    expect(reviewLog()).toMatchObject({ reason: 'no_candidates', stage4Total: 0 });
  });

  it('ログに案件名・KPI名・回答本文・質問を含めない', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), `粗利の確認が必要です。\n${MARKER_R1}`);
    const text = JSON.stringify(logSpy.mock.calls.filter((c) => c[2] === 'stage4_review'));
    expect(text).not.toContain('新規開拓');
    expect(text).not.toContain('有償開発受注件数');
    expect(text).not.toContain('粗利の確認');
    expect(text).not.toContain(QUESTION);
  });

  it('見直し案内が対象外の経路（一般知識の質問）では、診断を出さない', async () => {
    await ask('売上高とは何ですか？', strategy('strategy-1', [SALES_DEPT]), '一般的な説明です。');
    expect(reviewLog()).toBeUndefined();
  });

  it('マーカーが無く、終了理由が length の場合は no_marker_truncated（途中切れの疑い）を記録する', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '粗利の確認が必要で、次に', 'strategy-1', 'length');
    expect(reviewLog()).toMatchObject({
      reason: 'no_marker_truncated',
      finishReason: 'length',
      possiblyTruncated: true,
      contentChars: '粗利の確認が必要で、次に'.length,
    });
  });

  it('マーカーが無く、終了理由が stop の場合は no_marker（AIが出力しなかった）を記録する', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '一般的な助言です。', 'strategy-1', 'stop');
    expect(reviewLog()).toMatchObject({ reason: 'no_marker', finishReason: 'stop', possiblyTruncated: false });
  });

  it('終了理由と文字数を含めても、回答本文・案件名・KPI名は診断に含まれない', async () => {
    await ask(QUESTION, strategy('strategy-1', [SALES_DEPT]), '粗利の確認が必要です。', 'strategy-1', 'length');
    const text = JSON.stringify(logSpy.mock.calls.filter((c) => c[2] === 'stage4_review'));
    expect(text).not.toContain('粗利の確認が必要です');
    expect(text).not.toContain('新規開拓');
    expect(text).not.toContain('有償開発受注件数');
  });
});

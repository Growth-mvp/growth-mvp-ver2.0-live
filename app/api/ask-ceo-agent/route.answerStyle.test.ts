import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockClassifyHeuristic = jest.fn();
const mockClassifyLLM = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } };
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
  CONSULT_ROLE: 'CONSULT_ROLE_TEST',
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
  buildJSONOutputInstruction: () => 'JSON_OUTPUT_INSTRUCTION',
  safeParseFacilitatorJSON: () => null,
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => ({}) }));
jest.mock('@/lib/autoModeRouter', () => ({ detectAutoMode: () => ({ mode: 'advisor', reasons: [] }) }));
jest.mock('@/lib/helpPrompt', () => ({ buildHelpSystemPrompt: () => 'HELP_PROMPT' }));
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
import agentPrompt from '@/lib/agentPrompt';
import { POST } from './route';

const USER = 'user-1';
const STRATEGY = 'strategy-a';
const COMPANY = 'company-a';
const STYLE_MARK = '【今回の回答スタイル';
const Q_PROFIT = 'うちの会社、どうやったら業績上がるの？';
const Q_DETAIL = '2030年度の業績目標について、数値・施策・実行計画を詳しく分析して';
const Q_FOLLOW = '顧客別採算はまだ把握できていません';

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

function body(messages: { role: string; content: string }[], extra: Record<string, unknown> = {}) {
  return { userId: USER, strategyId: STRATEGY, companyId: COMPANY, messages, ...extra };
}

function sentRequest(): { system: string; messages: { role: string; content: string }[]; response_format?: unknown } {
  const req = mockChatCreate.mock.calls[0][0];
  return { system: req.messages[0].content, messages: req.messages.slice(1), response_format: req.response_format };
}

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(adminFake);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'admin', departmentId: null });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
    data: { id: STRATEGY, departments: [], answers2: [], finalStory: [] },
    error: null,
  });
  (agentPrompt as unknown as jest.Mock).mockReturnValue('AGENT_PROMPT');
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
  mockClassifyHeuristic.mockReturnValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  mockClassifyLLM.mockRejectedValue(new Error('LLM 分類は無効'));
});

describe('手動チャット advisor の回答スタイル（OpenAI へ送る最終指示）', () => {
  it('①業績の質問は、通常の経営相談の会話型を指示する', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }])));
    const sent = sentRequest();
    expect(sent.system).toContain('【今回の回答スタイル：通常の経営相談】');
    expect(sent.system).toContain('原則2〜4段落の自然な会話で答える');
    expect(sent.system).not.toContain('前の会話を踏まえ');
    expect(sent.messages).toEqual([{ role: 'user', content: Q_PROFIT }]);
  });

  it('②前の会話がある質問は、前の会話を踏まえる会話型を指示し、履歴をそのまま送る', async () => {
    const history = [
      { role: 'user', content: Q_PROFIT },
      { role: 'assistant', content: '売上の内訳を確認しましょう。' },
      { role: 'user', content: Q_FOLLOW },
    ];
    await POST(req(body(history)));
    const sent = sentRequest();
    expect(sent.system).toContain('【今回の回答スタイル：通常の経営相談（前の会話を踏まえる）】');
    expect(sent.system).toContain('相手の返答を受け止めて議論を深める');
    expect(sent.messages).toEqual(history);
  });

  it('③数値・施策・実行計画を詳しく求める質問は、詳細型を指示し、会話型の段落制限を付けない', async () => {
    await POST(req(body([{ role: 'user', content: Q_DETAIL }])));
    const sent = sentRequest();
    expect(sent.system).toContain('【今回の回答スタイル：詳細】');
    expect(sent.system).toContain('従来どおり十分に詳しく回答する');
    expect(sent.system).not.toContain('原則2〜4段落');
  });

  it('スタイル指示は、企業データの後・OpenAI 呼び出しの直前（system の末尾側）に入る', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }])));
    const sent = sentRequest();
    expect(sent.system.indexOf('AGENT_PROMPT')).toBeLessThan(sent.system.indexOf(STYLE_MARK));
    expect(sent.system.endsWith('- 判断材料が不足し重要な論点が残る場合に限り、自然な質問を1つ返す。質問は必須ではない。')).toBe(true);
    expect(sent.system.split('原則2〜4段落').length - 1).toBe(1);
    expect(sent.system.split('ツールが使えるとき').length - 1).toBe(0);
  });

  it('help モードには適用しない', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }], { meta: { mode: 'help' } })));
    expect(sentRequest().system).not.toContain(STYLE_MARK);
  });

  it('facilitator モードには適用しない', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }], { meta: { mode: 'facilitator', output: 'text' } })));
    expect(sentRequest().system).not.toContain(STYLE_MARK);
  });

  it('JSON 出力には適用せず、JSON 指示と response_format を維持する', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }], { meta: { output: 'json' } })));
    const sent = sentRequest();
    expect(sent.system).not.toContain(STYLE_MARK);
    expect(sent.system).toContain('JSON_OUTPUT_INSTRUCTION');
    expect(sent.response_format).toBeDefined();
  });

  it('自律伴走の助言（companion）には適用しない', async () => {
    await POST(
      req(body([{ role: 'user', content: Q_PROFIT }], { meta: { mode: 'facilitator', output: 'text', companion: { milestone: 'ANALYSIS' } } }))
    );
    expect(sentRequest().system).not.toContain(STYLE_MARK);
  });

  it('操作案内が付く質問には適用しない', async () => {
    await POST(req({ ...body([{ role: 'user', content: 'この画面では何をすればいい？' }]), screen: { screenId: 'stage1' } }));
    const sent = sentRequest();
    expect(sent.system).toContain('【操作案内（登録簿に基づく）】');
    expect(sent.system).not.toContain(STYLE_MARK);
  });
});

describe('会話履歴に基づく回答スタイル（繰り返し・異議・詳細）', () => {
  const ASSISTANT_PREV = { role: 'assistant', content: '前回の回答です。' };

  it('②同じ質問の繰り返しは、繰り返し用の指示になり、会話履歴をそのまま送る', async () => {
    const history = [{ role: 'user', content: Q_PROFIT }, ASSISTANT_PREV, { role: 'user', content: Q_PROFIT }];
    await POST(req(body(history)));
    const sent = sentRequest();
    expect(sent.system).toContain('【今回の回答スタイル：同じ質問の繰り返し】');
    expect(sent.system).toContain('前回と同じ説明は繰り返さない');
    expect(sent.messages).toEqual(history);
  });

  it('③「でも、それは現実的ではない」は、制約・異議の指示になり、会話履歴をそのまま送る', async () => {
    const history = [
      { role: 'user', content: Q_PROFIT },
      ASSISTANT_PREV,
      { role: 'user', content: 'でも、それは現実的ではない' },
    ];
    await POST(req(body(history)));
    const sent = sentRequest();
    expect(sent.system).toContain('【今回の回答スタイル：相手の制約・異議を受けて】');
    expect(sent.system).toContain('新しい判断条件として扱う');
    expect(sent.messages).toEqual(history);
  });

  it('④詳細分析の依頼は、会話履歴があっても詳細型を指示する', async () => {
    const history = [{ role: 'user', content: Q_PROFIT }, ASSISTANT_PREV, { role: 'user', content: Q_DETAIL }];
    await POST(req(body(history)));
    const sent = sentRequest();
    expect(sent.system).toContain('【今回の回答スタイル：詳細】');
    expect(sent.system).not.toContain('同じ質問の繰り返し');
    expect(sent.system).not.toContain('相手の制約・異議を受けて');
  });
});

describe('役割定義は通常の手動相談だけ置き換える', () => {
  const roleArg = () => (agentPrompt as unknown as jest.Mock).mock.calls.at(-1)?.[3];

  it('通常の手動チャットは、新しい役割定義を渡す', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }])));
    expect(roleArg()).toBe('CONSULT_ROLE_TEST');
  });

  it('facilitator・JSON では役割定義を置き換えない（従来どおり）', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }], { meta: { mode: 'facilitator', output: 'text' } })));
    expect(roleArg()).toBeUndefined();
    await POST(req(body([{ role: 'user', content: Q_PROFIT }], { meta: { output: 'json' } })));
    expect(roleArg()).toBeUndefined();
  });

  it('操作案内が付く質問では役割定義を置き換えない', async () => {
    await POST(req({ ...body([{ role: 'user', content: 'この画面では何をすればいい？' }]), screen: { screenId: 'stage1' } }));
    expect(roleArg()).toBeUndefined();
  });
});

describe('STAGE4見直し候補の指示（質問で出し分ける）', () => {
  const DEPTS = [
    {
      id: 'dept-sales',
      name: '営業部',
      projects: [{ id: 'proj-new', title: '新規開拓', okrsV2: [{ id: 'kr-1', label: '受注件数', target: 12, unit: '件' }] }],
    },
  ];
  const CANDIDATE_BLOCK = '【見直し候補（STAGE4・登録済みの実在データ）】';

  beforeEach(() => {
    (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
      data: { id: STRATEGY, departments: DEPTS, answers2: [], finalStory: [] },
      error: null,
    });
  });

  it('一般的な経営相談には、見直し候補の一覧も出力指示も入れない', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }])));
    expect(sentRequest().system).not.toContain(CANDIDATE_BLOCK);
  });

  it('KPIの見直しを求められた場合は、候補の一覧と出力指示を入れる', async () => {
    await POST(req(body([{ role: 'user', content: 'うちの会社のKPIを見直したい' }])));
    expect(sentRequest().system).toContain(CANDIDATE_BLOCK);
  });
});

describe('実行サマリ・STAGE4計画・進捗ログの出し分け（最終 system prompt）', () => {
  const EXEC_HEADER = '# 部門・OKR・実行計画（STAGE3・4、閲覧権限の範囲内の登録情報）';
  const PLAN_HEADER = '# 実行計画（STAGE4・保存済みの計画書）';
  const PROGRESS_HEADER = '# 直近進捗ログ';
  const DEPTS = [
    {
      id: 'dept-sales',
      name: '営業部',
      projects: [{ id: 'proj-new', title: '新規開拓', okrsV2: [{ id: 'kr-1', label: '受注件数', target: 12, unit: '件' }] }],
    },
  ];

  beforeEach(() => {
    (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
      data: { id: STRATEGY, departments: DEPTS, answers2: [], finalStory: [] },
      error: null,
    });
  });

  it('一般的な経営相談（①）では、実行サマリ・STAGE4計画・進捗ログを渡さない', async () => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }])));
    const s = sentRequest().system;
    expect(s).not.toContain(EXEC_HEADER);
    expect(s).not.toContain(PLAN_HEADER);
    expect(s).not.toContain(PROGRESS_HEADER);
  });

  it('施策・実行計画を詳しく求める質問（③）では、実行情報と進捗ログを渡す', async () => {
    await POST(req(body([{ role: 'user', content: Q_DETAIL }])));
    const s = sentRequest().system;
    expect(s).toContain(EXEC_HEADER);
    expect(s).toContain(PLAN_HEADER);
    expect(s).toContain(PROGRESS_HEADER);
  });

  it('KPIの質問では、実行サマリとSTAGE4計画を渡し、進捗ログは渡さない', async () => {
    await POST(req(body([{ role: 'user', content: 'うちの会社のKPIを見直したい' }])));
    const s = sentRequest().system;
    expect(s).toContain(EXEC_HEADER);
    expect(s).toContain(PLAN_HEADER);
    expect(s).not.toContain(PROGRESS_HEADER);
  });

  it('進捗の質問では、進捗ログを渡し、実行サマリは渡さない', async () => {
    await POST(req(body([{ role: 'user', content: '進捗が遅れている' }])));
    const s = sentRequest().system;
    expect(s).toContain(PROGRESS_HEADER);
    expect(s).not.toContain(EXEC_HEADER);
    expect(s).not.toContain(PLAN_HEADER);
  });

  it('操作案内の質問は、従来どおり実行情報と進捗ログを渡す', async () => {
    await POST(req({ ...body([{ role: 'user', content: 'この画面では何をすればいい？' }]), screen: { screenId: 'stage1' } }));
    const s = sentRequest().system;
    expect(s).toContain('【操作案内（登録簿に基づく）】');
    expect(s).toContain(EXEC_HEADER);
    expect(s).toContain(PROGRESS_HEADER);
  });

  it.each([
    ['facilitator', { mode: 'facilitator', output: 'text' }],
    ['JSON出力', { output: 'json' }],
    ['自律伴走の助言', { mode: 'facilitator', output: 'text', companion: { milestone: 'ANALYSIS' } }],
  ])('%s の経路は、一般的な相談でも従来どおり実行情報と進捗ログを渡す', async (_label, meta) => {
    await POST(req(body([{ role: 'user', content: Q_PROFIT }], { meta })));
    const s = sentRequest().system;
    expect(s).toContain(EXEC_HEADER);
    expect(s).toContain(PLAN_HEADER);
    expect(s).toContain(PROGRESS_HEADER);
  });
});

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
const STRATEGY_ID = 'strategy-1';
const COMPANY_ID = 'company-1';
const OWN_URL = 'https://example.com/nippon-seikan-ir';
const MARKET_URL = 'https://example.org/can-stat-2025';
const INVENTED_URL = 'https://made-up.example.net/fabricated';
const QUESTION = '美術缶市場の最新動向を教えてください';

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

function nipponSeikan(): Row {
  return {
    id: STRATEGY_ID,
    companyName: '日本製罐株式会社',
    industry: 'manufacturing',
    businessContent: '美術缶を製造・販売',
    businessSegments: [],
    departments: [],
    answers2: [],
    financePL: [],
    financeBS: [],
    fiscalYearEnd: '3',
    simulationResults: [],
    companyTargets: [],
  };
}

function otherCompany(): Row {
  return {
    ...nipponSeikan(),
    companyName: '別会社株式会社',
    industry: 'retail',
    businessContent: '小売店舗を運営',
  };
}

function req(query: string) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_ID,
      companyId: COMPANY_ID,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

async function ask(question: string, row: Row = nipponSeikan()) {
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: row, error: null });
  const res = await POST(req(question));
  const chatArgs = mockChatCreate.mock.calls.at(-1)?.[0];
  const body = await res.json();
  return {
    status: res.status,
    system: (chatArgs?.messages?.[0]?.content as string) ?? '',
    content: body.content as string,
  };
}

/** 行ごとに出典を付けた検索応答を作る（end_index は各行の末尾） */
function searchResponseLines(lines: Array<{ text: string; url: string }>) {
  let text = '';
  const annotations: unknown[] = [];
  lines.forEach((l, i) => {
    if (i > 0) text += '\n';
    const start = text.length;
    text += l.text;
    annotations.push({ type: 'url_citation', url: l.url, title: '出典', start_index: start, end_index: text.length });
  });
  return {
    output: [
      { type: 'web_search_call', id: 'ws1', status: 'completed', action: { type: 'search' } },
      { type: 'message', content: [{ type: 'output_text', text, annotations }] },
    ],
  };
}

const OWN_LINE = '日本製罐の2024年3月期の美術缶売上は前年を上回った。 ｜ 対象期間: 2024年3月期 ｜ 公表日: 2024-05-15 ｜ 種別: 年間統計';
const MARKET_LINE = '美術缶を含む包装産業の2025年の出荷統計は前年比で横ばいだった。 ｜ 対象期間: 2025年 ｜ 公表日: 2026-03-10 ｜ 種別: 年間統計';

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
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
  mockResponsesCreate.mockResolvedValue(
    searchResponseLines([
      { text: OWN_LINE, url: OWN_URL },
      { text: MARKET_LINE, url: MARKET_URL },
    ])
  );
});

describe('外部検索ON：自社と競合の区別', () => {
  beforeEach(() => {
    process.env.CEO_CHAT_WEB_SEARCH_ENABLED = 'true';
  });

  it('選択中企業の公開情報を、競合事例として扱わない', async () => {
    const r = await ask(QUESTION);
    expect(r.status).toBe(200);
    expect(r.system).toContain('当社（選択中企業）の正式名称（内部情報。検索には送信していません）: 日本製罐株式会社');
    expect(r.system).not.toContain('■ 競合企業に関する公開情報');
    const self = r.system.slice(r.system.indexOf('■ 自社に関する公開情報'));
    expect(self.indexOf('日本製罐の2024年3月期')).toBeGreaterThan(-1);
  });

  it('検索用の入力に、選択中企業の名称を含めない', async () => {
    await ask(QUESTION);
    const sent = JSON.stringify(mockResponsesCreate.mock.calls[0][0]);
    expect(sent).not.toContain('日本製罐');
  });

  it('企業を切り替えると、前の企業の自社情報は混ざらない', async () => {
    await ask(QUESTION, nipponSeikan());
    mockResponsesCreate.mockResolvedValue(searchResponseLines([{ text: MARKET_LINE, url: MARKET_URL }]));
    const r = await ask('小売店舗の最新動向を教えてください', otherCompany());
    expect(r.system).not.toContain('日本製罐');
    expect(r.system).not.toContain('■ 自社に関する公開情報');
  });
});

describe('外部検索ON：最新性と日付', () => {
  beforeEach(() => {
    process.env.CEO_CHAT_WEB_SEARCH_ENABLED = 'true';
  });

  it('2025年の年間統計を、対象期間と公表日つきで示す', async () => {
    const r = await ask(QUESTION);
    const line = r.system.split('\n').find((l) => l.includes('包装産業の2025年')) ?? '';
    expect(JSON.parse(line.slice(2))).toMatchObject({ 対象期間: '2025年', 公表日: '2026-03-10', 種別: '年間統計' });
  });

  it('公表日が確認できない事実には、日付を付けない', async () => {
    mockResponsesCreate.mockResolvedValue(
      searchResponseLines([{ text: '美術缶の需要は緩やかに増えたとされる。 ｜ 対象期間: 2025年', url: MARKET_URL }])
    );
    const r = await ask(QUESTION);
    const line = r.system.split('\n').find((l) => l.includes('美術缶の需要')) ?? '';
    expect(JSON.parse(line.slice(2)).公表日).toBe('公表日未確認');
    expect(line.replace(/"確認日":"[^"]*"/, '')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('2025年の年間統計と2026年の月次速報を区別し、直接比較しない注意を出す', async () => {
    mockResponsesCreate.mockResolvedValue(
      searchResponseLines([
        { text: MARKET_LINE, url: MARKET_URL },
        { text: '美術缶を含む出荷は2026年1〜3月に増加した。 ｜ 対象期間: 2026年1〜3月 ｜ 公表日: 2026-04-20 ｜ 種別: 月次速報', url: OWN_URL },
      ])
    );
    const r = await ask(QUESTION);
    expect(r.system).toContain('直接比較しないでください');
    const flashLine = r.system.split('\n').find((l) => l.includes('2026年1〜3月に増加')) ?? '';
    expect(JSON.parse(flashLine.slice(2))['確度・制約']).toContain('速報値');
  });
});

describe('外部検索ON：回答の出典URLの照合', () => {
  beforeEach(() => {
    process.env.CEO_CHAT_WEB_SEARCH_ENABLED = 'true';
  });

  it('検索結果にない出典URLを回答から除き、検索結果のURLは残す', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: `根拠: ${MARKET_URL}\n補足: ${INVENTED_URL}` } }],
    });
    const r = await ask(QUESTION);
    expect(r.content).toContain(MARKET_URL);
    expect(r.content).not.toContain(INVENTED_URL);
    expect(r.content).toContain('（未確認のURLを除外）');
  });

  it('検索が失敗した場合、回答に含まれる外部のURLはすべて除外する', async () => {
    mockResponsesCreate.mockRejectedValue(Object.assign(new Error('rate'), { status: 429 }));
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: `出典: ${MARKET_URL}` } }] });
    const r = await ask(QUESTION);
    expect(r.status).toBe(200);
    expect(r.content).not.toContain(MARKET_URL);
    expect(r.content).toContain('（未確認のURLを除外）');
  });

  it('社内サイトへのリンクは削除しない', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://growth-mvp-ver2-0-live.vercel.app';
    try {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'https://growth-mvp-ver2-0-live.vercel.app/stage2 を参照' } }],
      });
      const r = await ask(QUESTION);
      expect(r.content).toContain('https://growth-mvp-ver2-0-live.vercel.app/stage2');
    } finally {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  it('検索を実行しない質問では、回答のURLを変更しない', async () => {
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: `参考: ${INVENTED_URL}` } }] });
    const r = await ask('営業部門の実行計画を評価して');
    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(r.content).toContain(INVENTED_URL);
  });
});

describe('外部検索OFF：既存の回答経路を変えない', () => {
  it('検索OFFでは、回答のURLを変更せず、検索APIも呼ばない', async () => {
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: `参考: ${INVENTED_URL}` } }] });
    const r = await ask(QUESTION);
    expect(r.status).toBe(200);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(r.content).toContain(INVENTED_URL);
    expect(r.system).not.toContain('【外部情報');
  });
});

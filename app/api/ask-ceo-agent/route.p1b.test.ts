import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockClassifyHeuristic = jest.fn();

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
jest.mock('@/lib/intentRouter', () => ({
  classifyHeuristic: (...args: unknown[]) => mockClassifyHeuristic(...args),
  classifyLLM: jest.fn(async () => {
    throw new Error('LLM 分類は無効');
  }),
  chooseBetter: (a: unknown) => a,
}));
jest.mock('@/lib/facilitatorProtocol', () => ({ buildFacilitatorBlock: () => '' }));
jest.mock('@/lib/facilitatorSchema', () => ({
  buildJSONOutputInstruction: () => '',
  safeParseFacilitatorJSON: () => null,
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => ({}) }));
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
import { MOCK_COMPANY_ROW, MOCK_EMPTY_ROW } from '../../../eval/p1b/mockCompany';
import { POST } from './route';

const USER = 'user-1';
const STRATEGY_OF_A = 'strategy-a';
const COMPANY_A = 'company-a';

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

function req(query: string, screenId: string | null = null) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_OF_A,
      companyId: COMPANY_A,
      messages: [{ role: 'user', content: query }],
      ...(screenId ? { screen: { screenId } } : {}),
    }),
  });
}

function systemPromptOf(): string {
  return mockChatCreate.mock.calls[0][0].messages[0].content;
}

async function ask(query: string, opts: { stage: 'strategy' | 'generic'; row?: Record<string, any>; screenId?: string | null }) {
  mockClassifyHeuristic.mockReturnValue({ stage: opts.stage, confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: opts.row ?? MOCK_COMPANY_ROW, error: null });
  const res = await POST(req(query, opts.screenId ?? null));
  expect(res.status).toBe(200);
  return systemPromptOf();
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

describe('評価ケース（モック企業・実 API なし）', () => {
  it('1. わが社はなぜこの戦略を選んだの？：経営者の意図・確定版ストーリー・12問の回答を参照し、選択記録がないことを示す', async () => {
    const p = await ask('わが社はなぜこの戦略を選んだの？', { stage: 'strategy' });
    expect(p).toContain('経営者の意図（登録済み）: 既存顧客の業務効率を上げ');
    expect(p).toContain('最終ストーリーの状態: 確定版');
    expect(p).toContain('- [ch1-q2・第1章] ');
    expect(p).toContain('この項目には正式な採用記録がありません');
    expect(p).not.toContain('旧版');
  });

  it('1b. 一般論と判定されても、戦略の理由の質問では根拠を外さない', async () => {
    const p = await ask('わが社はなぜこの戦略を選んだの？', { stage: 'generic' });
    expect(p).toContain('【戦略の根拠');
    expect(p).toContain('経営者の意図（登録済み）');
  });

  it('2. 社長が一番重視していること：経営者の意図を参照する', async () => {
    const p = await ask('社長が一番重視していることは何？', { stage: 'strategy' });
    expect(p).toContain('経営者の意図（登録済み）: 既存顧客の業務効率を上げ');
  });

  it('3. 顧客のどんな課題を解決しようとしている？：12問の顧客に関する回答を、質問IDつきで参照する', async () => {
    const p = await ask('顧客のどんな課題を解決しようとしている？', { stage: 'strategy' });
    expect(p).toContain('- [ch1-q1・第1章]');
    expect(p).toContain('回答: 3〜5年後、中小製造業では設備の保守人材が不足');
  });

  it('4. この勝ち筋の根拠は十分なの？：候補の根拠と、回答の充足状況（8/12、未反映の深掘り1件）を示す', async () => {
    const p = await ask('この勝ち筋の根拠は十分なの？', { stage: 'strategy' });
    expect(p).toContain('勝ち筋候補（AI生成、採用記録なし）: 保守の標準化で選ばれる点検サービス');
    expect(p).toContain('生成時の根拠（AIの説明）: 点検の遅れが顧客の困りごと');
    expect(p).toContain('12問の回答あり 8/12件');
    expect(p).toContain('未反映の深掘り 1件');
  });

  it('5. 別の事業の話と混ざっていない？：事業を統合しない指示と、登録事業の名前を示す', async () => {
    const p = await ask('別の事業の話と混ざっていない？', { stage: 'strategy' });
    expect(p).toContain('- 登録事業: 点検サービス、部品販売');
    expect(p).toContain('事業をまたいで統合しない');
  });

  it('6. わが社のROICはどうなの？：一般論と判定されても、5指標を入れ、根拠ブロックは入れない', async () => {
    const p = await ask('わが社のROICはどうなの？', { stage: 'generic' });
    expect(p).toContain('③ ROIC（NOPAT÷投下資本）: 10.6%');
    expect(p).not.toContain('【戦略の根拠');
  });

  it('7. この画面の使い方を教えて：操作案内を示し、企業の根拠は入れない', async () => {
    const p = await ask('この画面の使い方を教えて', { stage: 'generic', screenId: 'stage1' });
    expect(p).toContain('【操作案内（登録簿に基づく）】');
    expect(p).not.toContain('【戦略の根拠');
  });
});

describe('登録情報が不足している場合', () => {
  it('経営者の意図も勝ち筋も無い企業では、理由を作らず「登録なし」と示す', async () => {
    const p = await ask('わが社はなぜこの戦略を選んだの？', { stage: 'strategy', row: MOCK_EMPTY_ROW });
    expect(p).toContain('経営者の意図: 登録なし');
    expect(p).toContain('最終ストーリーの状態: 未作成');
    expect(p).toContain('12問の回答あり 0/12件');
    expect(p).not.toContain('勝ち筋候補（AI生成');
  });
});

describe('不明確な質問', () => {
  it('対象が特定できない質問では、確認の質問を1つだけ求める指示を入れる', async () => {
    const p = await ask('どうなってる？', { stage: 'generic' });
    expect(p).toContain('確認の質問を1つだけ');
    expect(p).not.toContain('【戦略の根拠');
  });
});

describe('回帰テスト（P1-B 品質修正：Q1・Q3・Q6）', () => {
  it('Q1 選択記録なしで「正式に採用した」と読める表示をしない', async () => {
    const p = await ask('わが社はなぜこの戦略を選んだの？', { stage: 'strategy' });
    expect(p).toContain('この項目には正式な採用記録がありません（記録がないことは、未採用が確定していることを意味しない）');
    expect(p).toContain('勝ち筋候補（AI生成、採用記録なし）: 保守の標準化で選ばれる点検サービス');
    expect(p).not.toContain('採用記録（保存済み）');
    expect(p).not.toContain('採用記録あり');
    expect(p).toContain('採用記録がなければ「正式に採用した」と言わない');
    expect(p).toContain('確定ストーリーの確定は、勝ち筋候補のどれかを採用した記録ではない');
  });

  it('Q1 採用記録がある場合のみ、その候補を採用記録として示す', async () => {
    const p = await ask('わが社はなぜこの戦略を選んだの？', {
      stage: 'strategy',
      row: { ...MOCK_COMPANY_ROW, winPatternPrimary: 'wp-1' },
    });
    expect(p).toContain('勝ち筋の採用記録（保存済み）: 保守の標準化で選ばれる点検サービス');
    expect(p).toContain('勝ち筋候補（AI生成、採用記録あり）: 保守の標準化で選ばれる点検サービス');
    expect(p).toContain('勝ち筋候補（AI生成、採用記録なし）: 部品販売の拡大');
  });

  it('Q3 未反映の深掘りを、経営者が確定した事実として扱わない', async () => {
    const p = await ask('顧客のどんな課題を解決しようとしている？', { stage: 'strategy' });
    expect(p).toContain('未反映の深掘り（ch1-q4）');
    expect(p).toContain('経営者が確定した事実ではなく、仮説として扱う');
    expect(p).toContain('深掘り回答や顧客課題の記述は、検証データがない限り仮説として扱い、検証済みの顧客事実として断定しない');
    expect(p).toContain('事実は、ここに保存済みとして書かれた項目だけとする');
  });

  it('Q6 ROICの回答で、対象年度・算式・税率の前提・値の種別を落とさない', async () => {
    const p = await ask('わが社のROICはどうなの？', { stage: 'generic' });
    expect(p).toContain('対象年度: 2021年〜2024年（ROIC・営業利益率は最新年 2024年）');
    expect(p).toContain('③ ROIC（NOPAT÷投下資本）: 10.6%');
    expect(p).toContain('【計算値・2024年】');
    expect(p).toContain('ROICの算式: 営業利益×(1−税率)÷投下資本');
    expect(p).toContain('税率は仮定値30%を使用');
    expect(p).toContain('④ WACC（登録値）: 8.0%【登録値。計算値ではない】');
    expect(p).toContain('値の種別: ①②③は登録データからの計算値、④は登録値、⑤は手入力値');
  });

  it('Q6 業界比較の登録がなければ、業界内の良否を判断しないと明示する', async () => {
    const p = await ask('わが社のROICはどうなの？', { stage: 'generic' });
    expect(p).toContain('業界比較（ROIC）: 登録なし。業界内で良いか悪いかは判断しない');
    expect(p).toContain('業界比較がない場合、「良好」「高い」「低い」などの水準を断定しない');
    expect(p).toContain('「企業価値を創出している」とは断定しない');
  });

  it('Q6 業界比較の登録があれば、その値と期間を示し、差としてだけ述べる', async () => {
    const p = await ask('わが社のROICはどうなの？', {
      stage: 'generic',
      row: {
        ...MOCK_COMPANY_ROW,
        stage1Benchmarks: { waccManual: 8, industryMedian: { period: '2023年度', metrics: { roicPct: 7.2 } } },
      },
    });
    expect(p).toContain('業界比較（ROIC・業界中央値の登録値）: 7.2%（2023年度）。差は述べてよいが、水準の良否は断定しない');
    expect(p).not.toContain('業界比較（ROIC）: 登録なし');
  });

  it('既存の操作案内と5指標は、重要な質問でも残る（Q7・Q6）', async () => {
    const guide = await ask('この画面の使い方を教えて', { stage: 'generic', screenId: 'stage2' });
    expect(guide).toContain('【操作案内（登録簿に基づく）】');
    mockChatCreate.mockClear();
    const roic = await ask('わが社のROICはどうなの？', { stage: 'generic' });
    expect(roic).toContain('【STAGE1 企業価値5指標');
  });
});

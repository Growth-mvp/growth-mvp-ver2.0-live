import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  assertMinRole: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { company_id: 'company-1' }, error: null }),
        }),
      }),
    }),
  }),
}));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => undefined),
  extractAuditMetadata: jest.fn(() => ({})),
}));
jest.mock('@/lib/inputGuardLogger', () => ({
  logInputGuard: jest.fn(),
  checkSuspiciousKeywords: jest.fn(() => []),
}));

const mockChatCreate = jest.fn();
jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } },
  },
}));

import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { POST } from './route';

const CHAPTER_TITLES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう実行に落とすか（実行）',
];

const CEO_INTENT = '自動車向けから成長市場へ軸足を移す';
const MISSION = '人の移動を安全にする';
const VISION = '設計初期から関与する';
const VALUE = '現場起点で判断する';

const CHAPTER2_VALID = `戦略結論：制御設計を成長の中核に据え、低採算の受託を見直す仮説を検証する。
1) 勝ち筋：EV向け制御設計の受託拡大
   狙う価値ドライバー：売上CAGR・営業利益率
   狙う顧客と未解決課題：自動車部品メーカーの制御ソフト人材不足
   提供する新しい価値：設計初期からの制御設計の受託
   自社が選ばれる理由：設計開発力と長期関係（仮説）
   実現の障害・競争リスク：人材不足が制約になる
   経営判断：制御設計への投資配分を増やし、低採算の受託を縮小する
   主要戦略：
   - 重点顧客を3社に絞る
   90日アクション：
   - 投資配分案を経営会議に提出する
   根拠キーワード：EV化 / 設計開発力 / 人材不足
   トレードオフ：小口受託を縮小する
2) 勝ち筋：既存受託の採算改善
   狙う価値ドライバー：営業利益率
   狙う顧客と未解決課題：価格競争で値下げを求められている既存顧客
   提供する新しい価値：仕様確定前の原価提示
   自社が選ばれる理由：長期関係（仮説）
   実現の障害・競争リスク：値上げで失注する可能性
   経営判断：価格基準を改定し、採算割れの案件から撤退する
   主要戦略：
   - 案件別の採算表を導入する
   90日アクション：
   - 撤退候補の案件リストを作る
   根拠キーワード：価格競争 / 長期関係 / 営業利益率
   トレードオフ：売上の一部を失う
3) 勝ち筋：制御設計人材の内製化
   狙う価値ドライバー：ROIC
   狙う顧客と未解決課題：外部委託の品質ばらつき
   提供する新しい価値：社内で完結する設計品質の標準化
   自社が選ばれる理由：設計開発力（仮説）
   実現の障害・競争リスク：採用の遅れ
   経営判断：内製比率の目標を決め、外注先を絞る
   主要戦略：
   - 設計標準を整備する
   90日アクション：
   - 内製化の対象工程を選ぶ
   根拠キーワード：人材不足 / 設計開発力
   トレードオフ：短期の外注コスト増`;

function validStory(chapter2 = CHAPTER2_VALID) {
  return [
    {
      title: CHAPTER_TITLES[0],
      body: `要点：${CEO_INTENT}ことが必要な局面にある。
論点サマリ：
- 論点1：国内受注の伸び悩み（スコープ：全社）｜根拠指標：売上CAGR 1.2%｜要約：主力顧客の更新需要が鈍化
当社の事業と顧客
制御設計は自動車部品メーカーを主要顧客とする。
Mission：${MISSION}。
CEO意図から見た危機・必然性：${CEO_INTENT}。`,
    },
    { title: CHAPTER_TITLES[1], body: chapter2 },
    {
      title: CHAPTER_TITLES[2],
      body: `要点：制御設計が主力になる会社の姿。
Vision：${VISION}ことで、EV向けの制御需要を取り込む。
利用シーン：自動車部品メーカーが駆動制御の設計を必要とする場面で関与する。`,
    },
    {
      title: CHAPTER_TITLES[3],
      body: `要点：最初の90日で重点顧客と投資配分を決める。
Value：${VALUE}ことを行動原則にする。`,
    },
  ];
}

const VALID_WIN_PATTERNS = [
  {
    id: 'wp_1',
    name: 'EV向け制御設計の受託拡大',
    valueDrivers: ['売上CAGR'],
    rationale: '自動車部品メーカーの制御ソフト人材不足に応える',
    tradeoffs: '小口受託を縮小する',
    scope: 'company',
  },
];

function completion(content: string) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function draftResponse(story = validStory(), winPatterns = VALID_WIN_PATTERNS) {
  return completion(JSON.stringify({ storyDraft: story, winPatternsCandidate: winPatterns }));
}

const PAYLOAD = {
  strategyDataId: 'sd-1',
  issueBlocks: [{ title: '国内受注の伸び悩み', summary: '主力顧客の更新需要が鈍化' }],
  metricsSummary: { revenueCagrPct: 1.2, operatingMarginPctLatest: 4.5, roic: 6.1, wacc: 5.0 },
  ceoIntent: CEO_INTENT,
  mvv: { mission: MISSION, vision: VISION, value: VALUE },
  swot: {
    strength: '設計開発力\n顧客との長期関係',
    weakness: '人材不足',
    opportunity: 'EV化による制御需要',
    threat: '価格競争の激化',
  },
  swotSuggestions: { opportunity: ['提案機会A'], threat: [] },
  companyTargets: [],
  businessSegments: [{ name: '制御設計', summary: '制御ソフト受託', keyCustomers: ['自動車部品メーカー'] }],
};

function request(body: unknown = PAYLOAD) {
  return new NextRequest('http://localhost/api/stage2/generate-draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function systemPromptOf(callIndex: number): string {
  const args = mockChatCreate.mock.calls[callIndex][0] as { messages: { role: string; content: string }[] };
  return args.messages.find((m) => m.role === 'system')?.content ?? '';
}

describe('POST /api/stage2/generate-draft', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let consoleSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    mockChatCreate.mockReset();
    jest.clearAllMocks();
    consoleSpies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')].map((spy) =>
      spy.mockImplementation(() => undefined)
    );
    process.env.OPENAI_API_KEY = 'test-key';
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
    (requireMembership as jest.Mock).mockResolvedValue({ role: 'manager' });
    (assertMinRole as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockRestore());
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('認証されていない場合は 401 を返し、OpenAI を呼ばない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValueOnce(null);

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('要件を満たす出力は再生成せず、4章と勝ち筋候補をそのまま返す', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(json.storyDraft.map((c: { title: string }) => c.title)).toEqual(CHAPTER_TITLES);
    expect(json.storyDraft[1].body).toContain('戦略結論：制御設計を成長の中核に据え');
    expect(json.winPatternsCandidate).toEqual(VALID_WIN_PATTERNS);
  });

  it('SWOT判断・事業ポートフォリオ判断がなくても再生成しない（類型への当てはめは必須ではない）', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    await POST(request());

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('プロンプトは成長・収益改善・再構築の固定分類とSWOT類型の強制を含まない', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    await POST(request());

    const system = systemPromptOf(0);
    const user = (mockChatCreate.mock.calls[0][0] as { messages: { content: string }[] }).messages[1].content;

    expect(system).toContain('戦略結論：');
    expect(system).toContain('自社が選ばれる理由：');
    expect(system).toContain('戦略仮説');
    for (const text of [system, user]) {
      expect(text).not.toContain('成長牽引軸');
      expect(text).not.toContain('収益改善軸');
      expect(text).not.toContain('再構築軸');
      expect(text).not.toContain('SWOT判断');
      expect(text).not.toContain('S×O / W×T');
    }
  });

  it('第2章の戦略結論がない場合は修正パスで補い、修正結果を採用する', async () => {
    const withoutConclusion = CHAPTER2_VALID.replace(/^戦略結論：.*\n/, '');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(validStory(withoutConclusion)))
      .mockResolvedValueOnce(draftResponse());

    const res = await POST(request());
    const json = await res.json();

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    expect(json.storyDraft[1].body).toContain('戦略結論：');
  });

  it('一般論の勝ち筋名（収益性の改善）は修正パスの対象になる', async () => {
    const generic = CHAPTER2_VALID.replace('1) 勝ち筋：EV向け制御設計の受託拡大', '1) 勝ち筋：収益性の改善');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(validStory(generic)))
      .mockResolvedValueOnce(draftResponse());

    await POST(request());

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    const repairSystem = systemPromptOf(1);
    expect(repairSystem).toContain('一般語だけの勝ち筋名');
  });

  it('「自社が選ばれる理由」が欠けると修正パスで補う', async () => {
    const missingWhy = CHAPTER2_VALID.replace(/^\s*自社が選ばれる理由：.*\n/gm, '');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(validStory(missingWhy)))
      .mockResolvedValueOnce(draftResponse());

    await POST(request());

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });
});

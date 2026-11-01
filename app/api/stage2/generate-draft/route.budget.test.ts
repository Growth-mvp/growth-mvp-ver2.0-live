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
import { logAuditEvent } from '@/lib/server/auditLog';
import { POST } from './route';

const CHAPTER_TITLES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう実行に落とすか（実行）',
];

const CEO = '自動車向けから成長市場へ軸足を移す';
const MISSION = '人の移動を安全にする';
const VISION = '設計初期から関与する';
const VALUE = '現場起点で判断する';
const SWOT = {
  strength: '設計開発力',
  weakness: '人材不足',
  opportunity: 'EV化による制御需要',
  threat: '価格競争の激化',
};

const CHAPTER2 = `戦略結論：制御設計を成長の中核に据える仮説を検証する。
1) 勝ち筋：EV向け制御設計の受託拡大
   重要課題・機会：自動車部品メーカーの制御ソフト人材不足
   戦略の方向性：設計初期から制御設計を受託する
   成功する根拠：設計開発力（仮説）
   克服すべき障害・リスク：人材不足が制約になる
   狙う価値ドライバー：売上CAGR
   経営判断：制御設計への投資配分を増やす
   主要戦略：
   - 重点顧客を3社に絞る
   90日アクション：
   - 投資配分案を経営会議に提出する
   根拠キーワード：EV化 / 設計開発力
   トレードオフ：小口受託を縮小する`;

const GENERIC_CHAPTER2 = CHAPTER2.replace('EV向け制御設計の受託拡大', '収益性の改善');

const WINS = [
  {
    id: 'wp_1',
    name: 'EV向け制御設計の受託拡大',
    valueDrivers: ['売上CAGR'],
    rationale: '人材不足に応える',
    tradeoffs: '小口受託を縮小する',
    scope: 'company',
  },
];

function story(opts: { ch1?: string; chapter2?: string; ch4?: string } = {}) {
  return [
    {
      title: CHAPTER_TITLES[0],
      body:
        opts.ch1 ??
        `要点：${CEO}必要がある。
当社の事業と顧客
Mission：${MISSION}。
${CEO}`,
    },
    { title: CHAPTER_TITLES[1], body: opts.chapter2 ?? CHAPTER2 },
    {
      title: CHAPTER_TITLES[2],
      body: `要点：制御設計が主力になる会社の姿。
Vision：${VISION}ことで需要を取り込む。`,
    },
    { title: CHAPTER_TITLES[3], body: opts.ch4 ?? `要点：最初の90日で重点顧客を決める。
Value：${VALUE}ことを行動原則にする。` },
  ];
}

function draftJson(s = story(), w = WINS): string {
  return JSON.stringify({ storyDraft: s, winPatternsCandidate: w });
}

type Step = (opts: { signal?: AbortSignal; timeout?: number; maxRetries?: number }) => unknown;

function reply(ms: number, content: string): Step {
  return () => {
    clock += ms;
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  };
}

function fail(ms: number, err: unknown): Step {
  return () => {
    clock += ms;
    throw err;
  };
}

const serverError = () => Object.assign(new Error('server error'), { status: 500 });
const unavailable = () => Object.assign(new Error('unavailable'), { status: 503 });
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const connectionTimeout = () => Object.assign(new Error('timed out'), { name: 'APIConnectionTimeoutError' });

let clock = 0;
let steps: Step[] = [];

function payload(overrides: Record<string, unknown> = {}) {
  return {
    strategyDataId: 'sd-1',
    issueBlocks: [{ title: '国内受注の伸び悩み', summary: '主力顧客の更新需要が鈍化' }],
    metricsSummary: { revenueCagrPct: 1.2, operatingMarginPctLatest: 4.5, roic: 6.1, wacc: 5.0 },
    ceoIntent: CEO,
    mvv: { mission: MISSION, vision: VISION, value: VALUE },
    swot: SWOT,
    swotSuggestions: { opportunity: [], threat: [] },
    companyTargets: [],
    businessSegments: [],
    ...overrides,
  };
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/stage2/generate-draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function optionsOf(callIndex: number): { timeout?: number; maxRetries?: number; signal?: AbortSignal } {
  return mockChatCreate.mock.calls[callIndex][1];
}

function userPromptOf(callIndex: number): string {
  const args = mockChatCreate.mock.calls[callIndex][0] as { messages: { role: string; content: string }[] };
  return args.messages.find((m) => m.role === 'user')?.content ?? '';
}

describe('generate-draft の時間予算・再試行・Repair・出力検証（OpenAIモック）', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let consoleSpies: jest.SpyInstance[] = [];
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    mockChatCreate.mockReset();
    jest.clearAllMocks();
    clock = 1_000_000;
    steps = [];
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    mockChatCreate.mockImplementation(async (_params: unknown, opts: unknown) => {
      const step = steps.shift();
      if (!step) throw new Error('予期しない追加の OpenAI 呼び出し');
      return step(opts as Parameters<Step>[0]);
    });
    consoleSpies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')].map((spy) =>
      spy.mockImplementation(() => undefined)
    );
    process.env.OPENAI_API_KEY = 'test-key';
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
    (requireMembership as jest.Mock).mockResolvedValue({ role: 'manager' });
    (assertMinRole as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    consoleSpies.forEach((spy) => spy.mockRestore());
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  describe('時間予算と再試行', () => {
    it('初回は残り時間から安全余裕を引いた上限で呼び、SDK の自動再試行を無効化する', async () => {
      steps = [reply(5_000, draftJson())];

      const res = await POST(request(payload()));

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(optionsOf(0).timeout).toBe(48_000);
      expect(optionsOf(0).maxRetries).toBe(0);
    });

    it('タイムアウト（AbortError）の後は再試行せず、504 のアプリ応答を返す', async () => {
      steps = [fail(40_000, abortError())];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(504);
      expect(json.stage).toBe('openai-timeout');
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
    });

    it('一時的な障害は残り時間が十分なら1回だけ再試行し、再試行の上限は残りから決める', async () => {
      steps = [fail(5_000, serverError()), reply(5_000, draftJson())];

      const res = await POST(request(payload()));

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(2);
      expect(optionsOf(1).timeout).toBe(43_000);
      expect(optionsOf(1).maxRetries).toBe(0);
    });

    it('残り時間が再試行の最小値未満なら、一時的な障害でも再試行しない', async () => {
      steps = [fail(35_000, unavailable())];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.stage).toBe('openai-failed');
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
    });

    it('再試行も失敗すれば 502 を返し、3回目は呼ばない', async () => {
      steps = [fail(5_000, serverError()), fail(5_000, unavailable())];

      const res = await POST(request(payload()));

      expect(res.status).toBe(502);
      expect(mockChatCreate).toHaveBeenCalledTimes(2);
    });

    it('初回後に残り時間が十分なら Repair を行い、上限は35秒でキャップする', async () => {
      steps = [reply(10_000, draftJson(story({ chapter2: GENERIC_CHAPTER2 }))), reply(5_000, draftJson())];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(2);
      expect(optionsOf(1).timeout).toBe(35_000);
      expect(optionsOf(1).maxRetries).toBe(0);
      expect(json.storyDraft[1].body).toContain('EV向け制御設計の受託拡大');
    });

    it('残り時間が Repair の最小値未満なら Repair を省き、初回結果を返す', async () => {
      steps = [reply(40_000, draftJson(story({ chapter2: GENERIC_CHAPTER2 })))];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(json.storyDraft[1].body).toContain('勝ち筋：収益性の改善');
    });

    it('Repair の呼び出しが失敗しても、初回結果を返す', async () => {
      steps = [reply(5_000, draftJson(story({ chapter2: GENERIC_CHAPTER2 }))), fail(5_000, connectionTimeout())];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(2);
      expect(json.storyDraft[1].body).toContain('勝ち筋：収益性の改善');
    });

    it('Repair の結果が不完全なら採用せず、初回結果を返す', async () => {
      steps = [
        reply(5_000, draftJson(story({ chapter2: GENERIC_CHAPTER2 }))),
        reply(5_000, draftJson(story().slice(0, 3))),
      ];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.storyDraft).toHaveLength(4);
      expect(json.storyDraft[1].body).toContain('勝ち筋：収益性の改善');
    });
  });

  describe('出力検証', () => {
    it('章が欠けた出力は成功扱いせず 502 を返し、再試行・Repair はしない', async () => {
      steps = [reply(5_000, draftJson(story().slice(0, 3)))];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.stage).toBe('invalid-output');
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
    });

    it('勝ち筋候補が空の出力は成功扱いしない', async () => {
      steps = [reply(5_000, draftJson(story(), []))];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.stage).toBe('invalid-output');
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
    });

    it('章の本文が空なら成功扱いしない', async () => {
      steps = [reply(5_000, draftJson(story({ ch4: '' })))];

      const res = await POST(request(payload()));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.stage).toBe('invalid-output');
    });
  });

  describe('CEO意図の判定', () => {
    const LONG_CEO = '自動車向けの制御設計から成長市場の受託へ軸足を移す、低採算の既存受託を見直す方針を定める';
    const PHRASE_IN = '低採算の既存受託を見直す方針を定める';

    it('40字を超えるCEO意図は、句の一つが含まれていれば Repair しない', async () => {
      steps = [
        reply(
          5_000,
          draftJson(
            story({
              ch1: `要点：${PHRASE_IN}必要がある。
当社の事業と顧客
Mission：${MISSION}。
${PHRASE_IN}`,
            })
          )
        ),
      ];

      const res = await POST(request(payload({ ceoIntent: LONG_CEO })));

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
    });

    it('CEO意図の句が一つも含まれなければ、Repair の対象になる', async () => {
      steps = [
        reply(
          5_000,
          draftJson(
            story({
              ch1: `要点：成長の必要がある。
当社の事業と顧客
Mission：${MISSION}。
別の表現で述べる`,
            })
          )
        ),
        reply(5_000, draftJson()),
      ];

      const res = await POST(request(payload({ ceoIntent: LONG_CEO })));

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('応答直前の監査ログ', () => {
    it('監査ログの書き込みが終わらなくても、待ち時間の上限後に応答する', async () => {
      steps = [reply(5_000, draftJson())];
      (logAuditEvent as jest.Mock).mockImplementationOnce(() => new Promise(() => undefined));

      const res = await POST(request(payload()));

      expect(res.status).toBe(200);
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
    }, 10_000);
  });

  describe('SWOT入力の情報量', () => {
    it('確定SWOTの機会は先頭数件に切り詰めず、6件目もプロンプトに含める', async () => {
      const opportunity = [1, 2, 3, 4, 5, 6].map((n) => `O項目${n}`).join('\n');
      steps = [reply(5_000, draftJson())];

      const res = await POST(request(payload({ swot: { ...SWOT, opportunity } })));

      expect(res.status).toBe(200);
      const user = userPromptOf(0);
      expect(user).toContain('O項目6');
      expect(user).not.toContain('ほか');
    });

    it('40件の長い機会も文字数上限内なら省略しない', async () => {
      const opportunity = Array.from({ length: 40 }, (_, i) => `O項目${i + 1}：${'制御需要の変化を取り込む'.repeat(5)}`).join(
        '\n'
      );
      steps = [reply(5_000, draftJson())];

      const res = await POST(request(payload({ swot: { ...SWOT, opportunity } })));

      expect(res.status).toBe(200);
      expect(userPromptOf(0)).toContain('O項目40：');
      expect(userPromptOf(0)).not.toContain('文字数上限のため省略');
    });
  });
});

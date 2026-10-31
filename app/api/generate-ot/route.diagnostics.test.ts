import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));

const mockResponsesCreate = jest.fn();
const mockChatCreate = jest.fn();
jest.mock('@/lib/openai', () => ({
  openai: {
    responses: { create: (...args: unknown[]) => mockResponsesCreate(...args) },
    chat: { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } },
  },
}));

import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { POST } from './route';

const SECRET = 'SECRET-DIAG-9911';
const URL_A = 'https://example.com/can-market';
const URL_B = 'https://example.com/leasing-market';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/generate-ot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });
}

/** 市場名を行頭に付けた検索結果（実 API と同じ構造: 注釈は行ごとに付く） */
function searchLines(lines: Array<{ text: string; url: string }>) {
  const text = lines.map((l) => l.text).join('\n');
  return {
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        id: 'ws',
        action: { type: 'search', query: 'q', sources: lines.map((l) => ({ type: 'url', url: l.url })) },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text,
            annotations: lines.map((l) => {
              const start = text.indexOf(l.text);
              return { type: 'url_citation', url: l.url, title: 'Source', start_index: start, end_index: start + l.text.length };
            }),
          },
        ],
      },
    ],
  };
}

function analysisJson(opp: Array<{ text: string; basis: string; sourceIndex: number | null }>, thr: Array<{ text: string; basis: string; sourceIndex: number | null }>) {
  const fill = (xs: typeof opp, p: string) => {
    const out = [...xs];
    while (out.length < 5) out.push({ text: `${p}補足${out.length + 1}`, basis: 'hypothesis', sourceIndex: null });
    return out.map((x) => ({ ...x, evidence: '前提' }));
  };
  return {
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: JSON.stringify({ opportunities: fill(opp, '機会'), threats: fill(thr, '脅威') }), annotations: [] },
        ],
      },
    ],
  };
}

const body = (businessSegments: unknown[], businessContent = '金属缶の製造・販売') => ({
  industry: 'manufacturing',
  location: '',
  employees: '',
  businessContent,
  mission: '',
  vision: '',
  value: '',
  ceoIntent: '',
  strength: '',
  weakness: '',
  businessSegments,
  financeRows: [],
});

beforeEach(() => {
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('u');
  (requireMembership as jest.Mock).mockResolvedValue({ userId: 'u', companyId: 'c', role: 'member', departmentId: null });
  mockResponsesCreate.mockReset();
  mockChatCreate.mockReset();
  process.env.OT_WEB_SEARCH_ENABLED = 'true';
});

describe('事業別の診断と検索テーマ（モック）', () => {
  it('美術缶と18L缶・不動産賃貸は別の市場として検索され、事業別の採否が診断に出る（秘密の語は送らない・出さない）', async () => {
    const segments = [
      {
        name: '金属缶製造販売事業',
        summary: `18L缶と美術缶を製造 ${SECRET}`,
        mainProductsServices: ['18L缶', '美術缶'],
        keyCustomers: ['塗料メーカー'],
        revenue: 11278,
      },
      { name: '不動産賃貸事業', summary: '賃貸物件の運営', mainProductsServices: ['賃貸物件'], keyCustomers: ['入居者'], revenue: 163 },
    ];
    mockResponsesCreate
      .mockResolvedValueOnce(
        searchLines([{ text: '18リットル缶（一斗缶）: 出荷数量は2025年度に前年度を下回った。', url: URL_A }])
      )
      .mockResolvedValueOnce(searchLines([{ text: '代替品・新用途: 樹脂容器の用途が広がっている。', url: URL_A }]))
      .mockResolvedValueOnce(
        analysisJson([{ text: '18リットル缶の出荷数量の減少が販売に影響する可能性がある。', basis: 'hypothesis', sourceIndex: 1 }], [])
      );

    const res = await POST(req(body(segments)));
    const json = await res.json();

    expect(res.status).toBe(200);
    const s1 = mockResponsesCreate.mock.calls[0][0].input as string;
    expect(s1).toContain('- 18リットル缶（一斗缶）: ');
    expect(s1).toContain('- 美術缶（装飾缶）: ');
    expect(s1).toContain('- 不動産賃貸（オフィス・住宅・店舗の賃貸）: ');
    expect(s1).not.toContain(SECRET);

    const diag = json.meta.diagnostics;
    expect(diag.segments).toHaveLength(2);
    expect(diag.segments[0]).toMatchObject({ rank: 1, classified: true, reason: 'adopted' });
    expect(diag.segments[1]).toMatchObject({ rank: 2, classified: true, reason: 'no_market_info' });
    expect(diag.calls[0]).toMatchObject({ id: 'product_customer', status: 'ok' });
    expect(JSON.stringify(diag)).not.toContain(SECRET);
    expect(JSON.stringify(diag)).not.toContain('塗料メーカー');
    expect(JSON.stringify(diag)).not.toContain('金属缶製造販売事業');
  });

  it('小規模な別市場の事業も、大きい事業が上限を使い切っても検索に入る', async () => {
    const segments = [
      { name: '金属缶事業', summary: '金属缶', mainProductsServices: ['金属缶', '18L缶', '美術缶'], keyCustomers: ['塗料メーカー', '食品メーカー', '化学品メーカー'], revenue: 9000 },
      { name: '建設事業', summary: '設備工事', mainProductsServices: ['設備工事', '店舗販売', '物流'], keyCustomers: [], revenue: 5000 },
      { name: '不動産賃貸事業', summary: '不動産賃貸', mainProductsServices: ['不動産賃貸'], keyCustomers: [], revenue: 100 },
    ];
    mockResponsesCreate
      .mockResolvedValueOnce(searchLines([{ text: '金属缶・金属容器: 出荷数量は前年並みだった。', url: URL_A }]))
      .mockResolvedValueOnce(searchLines([{ text: '代替品・新用途: 樹脂容器が広がる。', url: URL_A }]))
      .mockResolvedValueOnce(analysisJson([], []));

    const res = await POST(req(body(segments)));
    const json = await res.json();

    const s1 = mockResponsesCreate.mock.calls[0][0].input as string;
    expect(s1).toContain('事業3の製品市場（公開分類）: 不動産賃貸（オフィス・住宅・店舗の賃貸）');
    expect(json.meta.diagnostics.segments[2]).toMatchObject({ rank: 3, classified: true });
    expect(json.meta.webSearch.droppedCategories).toBeGreaterThan(0);
  });

  it('予測だけの出典を根拠にした「事実」は、仮説として返す（実績と予測を混同しない）', async () => {
    mockResponsesCreate
      .mockResolvedValueOnce(
        searchLines([{ text: '塗料: 2026年度の塗料需要は前年度比1.1%増になる見通しだ。', url: URL_A }])
      )
      .mockResolvedValueOnce(searchLines([{ text: '代替品・新用途: 樹脂容器が広がる。', url: URL_B }]))
      .mockResolvedValueOnce(
        analysisJson([{ text: '塗料需要は2026年度に118万7千tとなる見通しである。', basis: 'fact', sourceIndex: 1 }], [])
      );

    const json = await (await POST(req(body([{ name: '金属缶事業', summary: '金属缶', mainProductsServices: ['金属缶'], keyCustomers: ['塗料メーカー'], revenue: 1 }])))).json();

    expect(json.insights.opportunity[0].basis).toBe('hypothesis');
    expect(json.meta.quality.forecastFactCorrected).toBe(1);
    expect(json.sources.every((s: { contentVerified?: boolean }) => s.contentVerified === false)).toBe(true);
  });

  it('検索が失敗しても分析は続き、診断に呼び出しごとの失敗理由が残る', async () => {
    const apiError = Object.assign(new Error('bad'), { status: 400 });
    mockResponsesCreate
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce(analysisJson([], []));

    const res = await POST(req(body([{ name: '金属缶事業', summary: '金属缶', mainProductsServices: ['金属缶'], keyCustomers: ['塗料メーカー'], revenue: 1 }])));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.diagnostics.calls.every((c: { status: string }) => c.status === 'failed')).toBe(true);
    expect(json.meta.diagnostics.calls[0].errorCode).toBe('bad_request');
    expect(json.meta.analysisMode).toBe('internal_only');
  });
});

describe('不動産賃貸の候補（日本製罐の再現）と計測', () => {
  const realEstateBody = () =>
    body([
      {
        name: '不動産賃貸事業',
        summary: '賃貸物件の運営',
        mainProductsServices: ['賃貸物件'],
        keyCustomers: ['入居者'],
        revenue: 3000,
      },
    ], '不動産賃貸業');
  const LEASING_LINE = { text: '不動産賃貸（オフィス・住宅・店舗の賃貸）: 賃貸物件の空室率は都心部で低下した。', url: URL_B };

  it('表示された不動産候補の出典紐づけが外れても、not_selected と誤判定せず、紐づけの喪失を診断に残す', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce(searchLines([LEASING_LINE]))
      .mockResolvedValueOnce(
        analysisJson([{ text: 'オフィス需要の変化が収益に影響する可能性がある。', basis: 'hypothesis', sourceIndex: 1 }], [])
      );

    const res = await POST(req(realEstateBody()));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.insights.opportunity[0]).toMatchObject({ text: 'オフィス需要の変化が収益に影響する可能性がある。', sourceIndex: null });
    expect(json.meta.diagnostics.segments[0]).toMatchObject({ rank: 1, classified: true, reason: 'adopted', unlinkedAdoptions: 1 });
    expect(json.meta.diagnostics.adoption).toMatchObject({ unlinked: 1, linked: 0 });
    expect(json.meta.quality.unlinkedCitations).toBe(1);
  });

  it('検索の再試行は検索リクエスト数に含め、Web検索ツールの実行回数とは分けて記録する。トークンは報告された分だけ合計する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429 }))
      .mockResolvedValueOnce({
        ...searchLines([LEASING_LINE]),
        usage: { input_tokens: 1200, output_tokens: 300, output_tokens_details: { reasoning_tokens: 180 } },
      })
      .mockResolvedValueOnce({
        ...analysisJson([], []),
        usage: { input_tokens: 900, output_tokens: 400, output_tokens_details: { reasoning_tokens: 0 } },
      });

    const json = await (await POST(req(realEstateBody()))).json();

    expect(json.meta.webSearch).toMatchObject({ searchRequests: 2, searchCalls: 1 });
    expect(json.meta.diagnostics.searchRequests).toBe(2);
    expect(json.meta.diagnostics.tokens).toEqual({ input: 2100, output: 700, reasoning: 180, reportedCalls: 2, llmCalls: 3 });
  });
});

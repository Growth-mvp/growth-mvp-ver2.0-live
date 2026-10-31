import { NextRequest } from 'next/server';
import { APIConnectionTimeoutError } from 'openai';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/lib/swot/sourceBody', () => ({
  checkSourceBodies: async ({ sources }: { sources: Array<Record<string, unknown>> }) => ({
    sources: sources.map((s) => ({ ...s, contentVerified: false, bodyCheck: 'unavailable' })),
    stats: { attempted: 0, matched: 0, notMatched: 0, unavailable: sources.length },
  }),
}));

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

const SENTINEL_SEGMENT = 'SEGMENT-SENTINEL-7781';
const SENTINEL_MVV = 'MVV-SENTINEL-4412';
const SENTINEL_FINANCE = 'SALES-SENTINEL-99';
const SENTINEL_ANSWER = 'ANSWER-SENTINEL-5520';
const SOURCE_URL = 'https://example.com/industry-report';

const five = (p: string) => Array.from({ length: 5 }, (_, i) => `${p}${i + 1}`);
const item = (text: string, basis = 'hypothesis', sourceIndex: number | null = null) => ({
  text,
  basis,
  evidence: 'テスト根拠',
  sourceIndex,
});

function analysisResponse(opp = five('機会'), thr = five('脅威')) {
  return {
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              opportunities: opp.map((t) => item(t)),
              threats: thr.map((t) => item(t)),
            }),
            annotations: [],
          },
        ],
      },
    ],
  };
}

function messageWithText(text: string) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [] }] }] };
}

function rolesResponse(roles: unknown[] = [{ role: 'direct_customer', basis: 'input', label: '塗料メーカー', evidence: '主要顧客' }]) {
  return messageWithText(JSON.stringify({ roles }));
}

function analysisWithNeeds(needs: unknown[]) {
  return messageWithText(
    JSON.stringify({
      opportunities: five('機会').map((t) => item(t)),
      threats: five('脅威').map((t) => item(t)),
      customerNeedOpportunities: needs,
    })
  );
}

/** 実 API と同じ構造: web_search_call（action.sources 付き）と、注釈付きの message */
function searchResponse(statement = '新制度が2027年に施行される。') {
  const text = `規制・社会構造の変化: ${statement}`;
  return {
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        id: 'ws1',
        action: { type: 'search', query: 'q', sources: [{ type: 'url', url: SOURCE_URL }] },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text,
            annotations: [
              {
                type: 'url_citation',
                url: SOURCE_URL,
                title: 'Industry Report',
                start_index: text.indexOf(statement),
                end_index: text.length,
              },
            ],
          },
        ],
      },
    ],
  };
}

function apiError(status: number) {
  return Object.assign(new Error(`api error ${status}`), { status });
}

function req(body: unknown, auth = true) {
  return new NextRequest('http://localhost/api/generate-ot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer t' } : {}) },
    body: JSON.stringify(body),
  });
}

const SENTINELS = {
  vision: 'VISION-SENTINEL-1101',
  value: 'VALUE-SENTINEL-1102',
  ceoIntent: 'INTENT-SENTINEL-1103',
  strength: 'STRENGTH-SENTINEL-1104',
  weakness: 'WEAKNESS-SENTINEL-1105',
  segmentSummary: 'SEGSUMMARY-SENTINEL-1106',
  customer: 'CUSTOMER-SENTINEL-1107',
  revenueText: '100億円',
  employeesText: '300名',
};

const baseBody = {
  industry: 'manufacturing',
  revenue: SENTINELS.revenueText,
  employees: SENTINELS.employeesText,
  businessContent: '産業用装置の製造',
  mission: SENTINEL_MVV,
  vision: SENTINELS.vision,
  value: SENTINELS.value,
  ceoIntent: SENTINELS.ceoIntent,
  strength: SENTINELS.strength,
  weakness: SENTINELS.weakness,
  businessSegments: [
    {
      name: SENTINEL_SEGMENT,
      summary: SENTINELS.segmentSummary,
      keyCustomers: [SENTINELS.customer],
      revenue: 1200,
      profit: 150,
    },
  ],
  financeRows: [{ year: 2025, '売上高(円)': 5_000_000_000 }],
  answers12: [{ id: 'ch0-q1', answer: SENTINEL_ANSWER }],
};

const allText = (args: unknown) => JSON.stringify(args);

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.OT_WEB_SEARCH_ENABLED;
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
  (requireMembership as jest.Mock).mockResolvedValue({ company_id: 'c1', role: 'admin' });
});

describe('POST /api/generate-ot', () => {
  it('認証が無ければ 401 で、AI を呼ばない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
    const res = await POST(req(baseBody, false));
    expect(res.status).toBe(401);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it('入力が上限を超えても生成は止めず、長さを切り詰めて渡す', async () => {
    mockResponsesCreate.mockResolvedValueOnce(analysisResponse());
    const res = await POST(req({ ...baseBody, businessContent: 'Q'.repeat(3000) }));

    expect(res.status).toBe(200);
    const sent = allText(mockResponsesCreate.mock.calls[0][0]);
    expect(sent).toContain('Q'.repeat(2000));
    expect(sent).not.toContain('Q'.repeat(2001));
  });

  it('形式が不正な入力（文字列でない値）は 400', async () => {
    const res = await POST(req({ industry: 12345 }));
    expect(res.status).toBe(400);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it('既定（Web 検索無効）では Luna の分析を1回だけ呼び、既存の応答形式を返す', async () => {
    mockResponsesCreate.mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(baseBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate).not.toHaveBeenCalled();

    const args = mockResponsesCreate.mock.calls[0][0];
    expect(args.model).toBe('gpt-5.6-luna');
    expect(args.reasoning).toEqual({ effort: 'low' });
    expect(args.store).toBe(false);
    expect(args.tools).toBeUndefined();
    expect(args.text.format).toMatchObject({ type: 'json_schema', strict: true });

    expect(body.opportunity).toEqual(five('機会'));
    expect(body.threat).toEqual(five('脅威'));
    expect(body.result).toContain('■ Opportunity（機会）');
    expect(body.sources).toEqual([]);
    expect(body.meta).toMatchObject({
      model: 'gpt-5.6-luna',
      usedFallback: false,
      webSearch: { enabled: false, status: 'disabled', searchCalls: 0 },
      llmCalls: 1,
    });
  });

  it('12問の回答は AI に渡さず、MVV・事業区分・財務は分析に渡す', async () => {
    mockResponsesCreate.mockResolvedValueOnce(analysisResponse());
    await POST(req(baseBody));

    const sent = allText(mockResponsesCreate.mock.calls[0][0]);
    expect(sent).not.toContain(SENTINEL_ANSWER);
    expect(sent).toContain(SENTINEL_MVV);
    expect(sent).toContain(SENTINEL_SEGMENT);
    expect(sent).toContain('2025年: 売上高 5000.0百万円');
  });

  it('Web 検索を有効にすると、公開情報のみで検索し、社内情報は含めない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(baseBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);

    const [searchArgs, analysisArgs] = mockResponsesCreate.mock.calls.map((c) => c[0]);
    expect(searchArgs.tools).toEqual([{ type: 'web_search' }]);
    expect(searchArgs.tool_choice).toBe('required');
    expect(searchArgs.include).toEqual(['web_search_call.action.sources']);
    expect(searchArgs.text).toBeUndefined();
    expect(analysisArgs.tools).toBeUndefined();

    const searchText = allText(searchArgs);
    const internalValues = [
      SENTINEL_MVV,
      SENTINEL_SEGMENT,
      SENTINEL_ANSWER,
      SENTINELS.vision,
      SENTINELS.value,
      SENTINELS.ceoIntent,
      SENTINELS.strength,
      SENTINELS.weakness,
      SENTINELS.segmentSummary,
      SENTINELS.customer,
      SENTINELS.revenueText,
      SENTINELS.employeesText,
      '2025',
      '5000',
      '1200',
    ];
    for (const secret of internalValues) {
      expect(searchText).not.toContain(secret);
    }
    expect(searchText).toContain('製造');

    expect(allText(analysisArgs)).toContain(`[1] (規制・社会構造の変化) 新制度が2027年に施行される`);
    expect(body.sources).toEqual([
      expect.objectContaining({ index: 1, url: SOURCE_URL, title: 'Industry Report' }),
    ]);
    expect(body.sources[0].retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.meta).toMatchObject({
      webSearch: { enabled: true, status: 'completed', searchCalls: 1 },
      llmCalls: 2,
    });
  });

  it('本社所在地は分析にだけ渡し、Web 検索には含めない（市場地域と混同しない）', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const LOCATION = 'HQ-LOCATION-SENTINEL-8802';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    await POST(req({ ...baseBody, location: LOCATION, employees: '20〜49' }));

    expect(allText(mockResponsesCreate.mock.calls[0][0])).not.toContain(LOCATION);
    const analysisText = allText(mockResponsesCreate.mock.calls[1][0]);
    expect(analysisText).toContain(`【本社所在地（市場地域ではない）】${LOCATION}`);
    expect(analysisText).toContain('【従業員数】20〜49名');
  });

  it('検索が失敗しても LUNA 単独で分析し、Web 未取得を明示する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockRejectedValueOnce(apiError(400))
      .mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(baseBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.webSearch).toMatchObject({ status: 'failed', searchCalls: 0 });
    expect(body.sources).toEqual([]);
    expect(allText(mockResponsesCreate.mock.calls[1][0])).toContain('取得できませんでした（状態: failed）');
  });

  it('検索が行われなかった場合は no_search として記録する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce({ output: [] })
      .mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(baseBody));
    const body = await res.json();
    expect(body.meta.webSearch.status).toBe('no_search');
  });

  it('LUNA の分析が失敗したら旧モデルへ fallback し、meta に明示する', async () => {
    mockResponsesCreate.mockRejectedValueOnce(apiError(400));
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ opportunities: [item('機会A')], threats: [item('脅威A')] }) } }],
    });

    const res = await POST(req(baseBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].model).toBe('gpt-4o');
    expect(body.opportunity).toEqual(['機会A']);
    expect(body.meta).toMatchObject({ model: 'gpt-4o', usedFallback: true });
    expect(body.meta.fallbackCode).toBe('bad_request');
  });

  it('LUNA が不正な JSON を返したら分析失敗として fallback する', async () => {
    mockResponsesCreate.mockResolvedValueOnce({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '不正', annotations: [] }] }],
    });
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ opportunities: [item('機会B')], threats: [item('脅威B')] }) } }],
    });

    const res = await POST(req(baseBody));
    const body = await res.json();
    expect(body.meta.usedFallback).toBe(true);
    expect(body.meta.fallbackCode).toBe('invalid_output');
  });

  it('再試行は上限回数で止まり、両方失敗したら 502 を返す', async () => {
    mockResponsesCreate.mockRejectedValue(apiError(500));
    mockChatCreate.mockRejectedValue(apiError(500));

    const res = await POST(req(baseBody));

    expect(res.status).toBe(502);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('LUNA の分析が 429 で尽きた場合は 429 を返す', async () => {
    mockResponsesCreate.mockRejectedValue(apiError(429));
    mockChatCreate.mockRejectedValue(apiError(429));

    const res = await POST(req(baseBody));
    expect(res.status).toBe(429);
  });
});

describe('POST /api/generate-ot 検索の状態と失敗理由', () => {
  const PROVIDER_DETAIL = 'PROVIDER-DETAIL-SECRET-6601';
  const FINDING_TEXT = 'FINDING-STATEMENT-SECRET-6602';
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('既定（未設定）は検索 OFF。meta から分析モードとモデルが分かる', async () => {
    mockResponsesCreate.mockResolvedValueOnce(analysisResponse());
    const body = await (await POST(req(baseBody))).json();

    expect(body.meta).toMatchObject({
      model: 'gpt-5.6-luna',
      usedFallback: false,
      fallbackCode: null,
      analysisMode: 'internal_only',
      webSearch: { enabled: false, status: 'disabled', searchCalls: 0, model: null, errorCode: null },
    });
    expect(typeof body.meta.elapsedMs).toBe('number');
  });

  it('フラグは厳密に "true" のときだけ ON（TRUE・1 は OFF のまま）', async () => {
    for (const value of ['TRUE', '1', 'yes', '']) {
      jest.clearAllMocks();
      process.env.OT_WEB_SEARCH_ENABLED = value;
      mockResponsesCreate.mockResolvedValueOnce(analysisResponse());

      const body = await (await POST(req(baseBody))).json();

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(body.meta.webSearch.enabled).toBe(false);
    }
  });

  it('検索成功時は with_web と検索モデル・処理時間を返す', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(analysisResponse());

    const body = await (await POST(req(baseBody))).json();

    expect(body.meta.analysisMode).toBe('with_web');
    expect(body.meta.webSearch).toMatchObject({
      enabled: true,
      status: 'completed',
      searchCalls: 1,
      model: 'gpt-5.6-luna',
      errorCode: null,
    });
    expect(typeof body.meta.webSearch.elapsedMs).toBe('number');
  });

  it('検索の API 失敗は分類コードだけを返し、プロバイダの詳細は出さない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockRejectedValueOnce(Object.assign(new Error(PROVIDER_DETAIL), { status: 400 }))
      .mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(baseBody));
    const text = JSON.stringify(await res.json()) + logged.join('\n');

    expect(res.status).toBe(200);
    expect(text).not.toContain(PROVIDER_DETAIL);
    expect(text).toContain('"errorCode":"bad_request"');
  });

  it('検索のタイムアウトは timeout として分類する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const timeoutErr = new APIConnectionTimeoutError({ message: 'Request timed out.' });
    mockResponsesCreate
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce(analysisResponse());

    const body = await (await POST(req(baseBody))).json();

    expect(body.meta.webSearch).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(body.meta.analysisMode).toBe('internal_only');
  });

  it('検索結果の本文はログに出さず、件数などの統計のみ出す', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const response = searchResponse(FINDING_TEXT);
    mockResponsesCreate.mockResolvedValueOnce(response).mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(baseBody));
    const text = JSON.stringify(await res.json()) + logged.join('\n');

    expect(res.status).toBe(200);
    expect(logged.join('\n')).toContain('"webSearch"');
    expect(logged.join('\n')).not.toContain(FINDING_TEXT);
  });

  it('LUNA 分析の失敗は分類コードで fallback を記録し、詳細は出さない', async () => {
    mockResponsesCreate.mockRejectedValueOnce(
      Object.assign(new Error(PROVIDER_DETAIL), { status: 400 })
    );
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ opportunities: [item('機会C')], threats: [item('脅威C')] }) } }],
    });

    const res = await POST(req(baseBody));
    const text = JSON.stringify(await res.json()) + logged.join('\n');

    expect(res.status).toBe(200);
    expect(text).not.toContain(PROVIDER_DETAIL);
    expect(text).toContain('"fallbackCode":"bad_request"');
  });

  it('検索結果が分析へ渡り、出典と診断件数が応答に入る（実応答の構造）', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    const body = await (await POST(req(baseBody))).json();

    const analysisInput = JSON.stringify(mockResponsesCreate.mock.calls[1][0].input);
    expect(analysisInput).toContain('[1] (規制・社会構造の変化) 新制度が2027年に施行される');
    expect(analysisInput).toContain(SOURCE_URL);
    expect(body.sources).toEqual([expect.objectContaining({ index: 1, url: SOURCE_URL })]);
    expect(body.meta.webSearch.diagnostics).toEqual({
      webSearchCalls: 1,
      toolSources: 1,
      annotations: 1,
      lines: 1,
      attributedLines: 1,
      rejectedLines: 0,
      unattributedLines: 0,
      duplicateLines: 0,
      droppedByLimit: 0,
      findings: 1,
      byCategory: { _general: { findings: 1, dropped: 0 } },
    });
  });

  it('出典の注釈が無い検索結果は no_citations で失敗し、LUNA 単独で分析する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const response = searchResponse();
    (response.output[1] as any).content[0].annotations = [];
    mockResponsesCreate.mockResolvedValueOnce(response).mockResolvedValueOnce(analysisResponse());

    const body = await (await POST(req(baseBody))).json();

    expect(body.meta).toMatchObject({ analysisMode: 'internal_only', usedFallback: false });
    expect(body.meta.webSearch).toMatchObject({ status: 'failed', errorCode: 'no_citations' });
    expect(body.sources).toEqual([]);
  });

  it('事業ごとの3択と補足だけを検索に渡し、概要・顧客・事業名などの社内情報は渡さない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    await POST(
      req({
        ...baseBody,
        businessSegments: [
          {
            name: SENTINEL_SEGMENT,
            scope: 'SCOPE-SENTINEL-AREA',
            summary: SENTINELS.segmentSummary,
            keyCustomers: [SENTINELS.customer],
            revenue: 1200,
            profit: 150,
            expansionScope: 'both',
            overseasRegions: ['東南アジア', '中国'],
          },
        ],
      })
    );

    const searchText = allText(mockResponsesCreate.mock.calls[0][0]);
    expect(searchText).toContain('現在の事業展開地域（参考。探索対象を限定しない）: 日本国内、海外（東南アジア、中国）');
    expect(searchText).not.toContain(SENTINELS.segmentSummary);
    expect(searchText).not.toContain(SENTINEL_SEGMENT);
    expect(searchText).not.toContain('SCOPE-SENTINEL-AREA');
    expect(searchText).not.toContain(SENTINELS.customer);
    expect(allText(mockResponsesCreate.mock.calls[1][0])).toContain('現在の事業展開地域: 国内・海外の両方（東南アジア、中国）');
  });

  it('許可リスト外の国・地域名と旧自由入力は、検索にも分析にも渡らない（サーバー側の検証）', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    await POST(
      req({
        ...baseBody,
        businessSegments: [
          {
            name: '海外事業',
            expansionScope: 'overseas',
            overseasRegions: ['FREE-TEXT-COUNTRY-9001', '中国'],
            overseasRegionsNote: 'LEGACY-NOTE-SECRET-9002',
          },
        ],
      })
    );

    const searchText = allText(mockResponsesCreate.mock.calls[0][0]);
    const analysisText = allText(mockResponsesCreate.mock.calls[1][0]);
    expect(searchText).toContain('海外（中国）');
    for (const leaked of ['FREE-TEXT-COUNTRY-9001', 'LEGACY-NOTE-SECRET-9002']) {
      expect(searchText).not.toContain(leaked);
      expect(analysisText).not.toContain(leaked);
    }
  });

  it('業種が「その他」でも、エラーなく生成し、業種として「その他」を渡す', async () => {
    mockResponsesCreate.mockResolvedValueOnce(analysisResponse());

    const res = await POST(req({ ...baseBody, industry: 'other' }));

    expect(res.status).toBe(200);
    expect(allText(mockResponsesCreate.mock.calls[0][0])).toContain('【業種】その他');
  });

  it('業種が「その他」なら業種名だけでは Web 検索せず、分析は続け、出典は付けない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(analysisResponse());

    const res = await POST(req({ ...baseBody, industry: 'other' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockResponsesCreate.mock.calls[0][0].tools).toBeUndefined();
    expect(body.sources).toEqual([]);
    expect(body.meta).toMatchObject({
      analysisMode: 'internal_only',
      usedFallback: false,
      llmCalls: 1,
      webSearch: { enabled: true, status: 'skipped_unspecified_industry', searchCalls: 0, model: null },
    });
    expect(allText(mockResponsesCreate.mock.calls[0][0])).toContain('取得できませんでした（状態: skipped_unspecified_industry）');
  });

  it('業種名が許可されたコードでない自由記述は、Web 検索には渡さず、社内分析にだけ渡す', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const FREE_TEXT = 'INDUSTRY-FREE-TEXT-SECRET-7701 株式会社甲 年商12億円';
    mockResponsesCreate.mockResolvedValueOnce(analysisResponse());

    const res = await POST(
      req({
        ...baseBody,
        industry: FREE_TEXT,
        businessSegments: [{ name: SENTINEL_SEGMENT, summary: SENTINELS.segmentSummary, keyCustomers: [SENTINELS.customer], revenue: 1200 }],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockResponsesCreate.mock.calls[0][0].tools).toBeUndefined();
    expect(json.meta.webSearch).toMatchObject({ status: 'skipped_no_industry', searchCalls: 0, industrySource: 'unrecognized' });
    expect(allText(mockResponsesCreate.mock.calls[0][0])).toContain('INDUSTRY-FREE-TEXT-SECRET-7701');
    expect(JSON.stringify(json)).not.toContain('INDUSTRY-FREE-TEXT-SECRET-7701');
  });

  it('業種が分からなくても、公開分類に一致する事業があれば、業界の行を出さずに分類ベースで検索する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce(searchResponse('金属缶の需要が増える。'))
      .mockResolvedValueOnce(searchResponse('樹脂容器が普及する。'))
      .mockResolvedValueOnce(analysisResponse());

    const res = await POST(
      req({
        ...baseBody,
        industry: 'UNRECOGNIZED-INDUSTRY-9911',
        businessContent: '金属缶の製造・販売',
        businessSegments: [
          { name: '金属缶製造販売事業', summary: '18L缶を製造', mainProductsServices: ['18L缶'], keyCustomers: ['塗料メーカー'], revenue: 11278 },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    const searchInput = mockResponsesCreate.mock.calls[0][0].input as string;
    expect(searchInput).not.toContain('業界:');
    expect(searchInput).not.toContain('UNRECOGNIZED-INDUSTRY-9911');
    expect(json.meta.webSearch).toMatchObject({ status: 'completed', classification: 'matched', industrySource: 'unrecognized' });
  });

  it('海外中心で国・地域が未指定なら、検索に米国を補わない（本社所在地も検索に入れない）', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    await POST(
      req({
        ...baseBody,
        location: 'LOCATION-SENTINEL-9911',
        businessSegments: [{ name: '海外事業', expansionScope: 'overseas' }],
      })
    );

    const searchText = allText(mockResponsesCreate.mock.calls[0][0]);
    expect(searchText).toContain('現在の事業展開地域（参考。探索対象を限定しない）: 海外（国・地域は未指定）');
    expect(searchText).not.toContain('現在の事業展開地域（参考。探索対象を限定しない）: 米国');
    expect(searchText).not.toContain('LOCATION-SENTINEL-9911');
  });

  it('地域の指定が無ければ、検索は未指定として行い特定の国を前提にしない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    await POST(req(baseBody));

    const searchText = allText(mockResponsesCreate.mock.calls[0][0]);
    expect(searchText).toContain('現在の事業展開地域: 未入力（探索対象を限定しない）');
    expect(searchText).not.toContain('現在の事業展開地域（参考。探索対象を限定しない）: 日本国内');
    expect(searchText).not.toContain('日本国内');
  });

  it('エラーページの疑いがある出典は根拠にせず、分析へ渡さない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const response = searchResponse();
    (response.output[1] as any).content[0].annotations[0].url = 'https://example.com/404';
    mockResponsesCreate.mockResolvedValueOnce(response).mockResolvedValueOnce(analysisResponse());

    const body = await (await POST(req(baseBody))).json();

    expect(body.meta.webSearch).toMatchObject({ status: 'failed', errorCode: 'no_attributed_citation' });
    expect(body.sources).toEqual([]);
    expect(body.meta.webSearch.diagnostics.rejectedLines).toBe(1);
    expect(allText(mockResponsesCreate.mock.calls[1][0])).not.toContain('example.com/404');
  });

  it('追跡パラメータ付きの出典 URL は除去して返す', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const response = searchResponse();
    (response.output[1] as any).content[0].annotations[0].url = `${SOURCE_URL}?utm_source=openai`;
    mockResponsesCreate.mockResolvedValueOnce(response).mockResolvedValueOnce(analysisResponse());

    const body = await (await POST(req(baseBody))).json();

    expect(body.sources).toEqual([expect.objectContaining({ index: 1, url: SOURCE_URL })]);
  });

  it('注釈があっても行に対応しない検索結果は no_attributed_citation で失敗する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    const response = searchResponse();
    (response.output[1] as any).content[0].annotations[0].start_index = -1;
    mockResponsesCreate.mockResolvedValueOnce(response).mockResolvedValueOnce(analysisResponse());

    const body = await (await POST(req(baseBody))).json();

    expect(body.meta.webSearch).toMatchObject({ status: 'failed', errorCode: 'no_attributed_citation' });
    expect(body.meta.analysisMode).toBe('internal_only');
  });
});

describe('製品・顧客市場に基づく検索（層ごと）と品質検査', () => {
  const body = (over: Record<string, unknown>) => ({ ...baseBody, ...over });
  const NIHON_SEIKAN = body({
    industry: 'manufacturing',
    businessContent: '金属缶の製造・販売',
    businessSegments: [
      {
        name: '金属缶製造販売事業',
        summary: '18L缶と美術缶を製造',
        mainProductsServices: ['18L缶', '美術缶'],
        keyCustomers: ['塗料メーカー', '化学品メーカー', '食品メーカー'],
        revenue: 11278,
      },
    ],
  });

  it('日本製罐: 製品・顧客を1回目、代替品・新用途を2回目に検索し、非公開の語は検索に入れない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce(searchResponse('金属缶の需要が増える。'))
      .mockResolvedValueOnce(searchResponse('樹脂容器が普及する。'))
      .mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(NIHON_SEIKAN));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);
    const [s1, s2, analysis] = mockResponsesCreate.mock.calls.map((c) => c[0]);
    expect(s1.input).toContain('製品市場（公開分類）: 金属缶・金属容器、18リットル缶（一斗缶）、美術缶（装飾缶）');
    expect(s1.input).toContain('顧客業界（公開分類）: 塗料・化学品メーカー、食品・飲料メーカー');
    expect(s2.input).toContain('代替品・新用途（公開分類）: 樹脂容器・プラスチック容器');
    expect(s2.input).toContain('購買基準の変化（公開分類）: 環境性能・リサイクル性（購買基準の変化）');
    expect(s2.input).not.toContain('紙容器');
    for (const secret of ['金属缶製造販売事業', '18L缶と美術缶を製造', '塗料メーカー', '11278']) {
      expect(s1.input).not.toContain(secret);
      expect(s2.input).not.toContain(secret);
    }
    expect(json.meta.webSearch).toMatchObject({
      status: 'completed',
      classification: 'matched',
      searchCalls: 2,
      calls: [
        {
          id: 'product_customer',
          categoryIds: ['p_metal_can', 'p_can_18l', 'p_art_can', 'c_paint_chemical', 'c_food_maker'],
        },
        { id: 'substitute', categoryIds: ['s_plastic_container', 'k_environment'] },
      ],
    });
    expect(json.meta.analysisMode).toBe('with_web');
    expect(json.sources).toHaveLength(1);
    expect(allText(analysis)).toContain('[1] (製品・顧客市場・規制・社会構造の変化) 金属缶の需要が増える。');
    expect(allText(analysis)).toContain('[1] (代替・新用途・規制・社会構造の変化) 樹脂容器が普及する。');
    expect(json.meta.quality).toMatchObject({ opportunityCount: 5, threatCount: 5 });
  });

  it('顧客課題の探索は既定で OFF。ON のときだけ、固定テーマと公開分類で3回目の検索を行う', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(analysisResponse());
    const off = await (await POST(req(NIHON_SEIKAN))).json();
    expect(off.meta.webSearch.customerNeedDiscovery).toBe(false);
    expect(off.meta.webSearch.calls.map((c: { id: string }) => c.id)).toEqual(['product_customer', 'substitute']);
    expect(allText(mockResponsesCreate.mock.calls.map((c) => c[0]))).not.toContain('利用者の不満が小さい');
  });

  it('顧客課題の探索を ON にすると、固定テーマだけで検索し、社内の文言は検索に入れない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    process.env.OT_CUSTOMER_NEED_DISCOVERY = 'true';
    try {
      mockResponsesCreate
        .mockResolvedValueOnce(rolesResponse())
        .mockResolvedValueOnce(searchResponse())
        .mockResolvedValueOnce(searchResponse())
        .mockResolvedValueOnce(searchResponse('利用者の負担が増えている。'))
        .mockResolvedValueOnce(analysisResponse());
      const json = await (
        await POST(
          req({
            ...NIHON_SEIKAN,
            businessSegments: [{ ...(NIHON_SEIKAN.businessSegments[0] as object), summary: 'SECRET-NEED-SUMMARY-9301 18L缶と美術缶を製造' }],
          })
        )
      ).json();

      expect(json.meta.webSearch).toMatchObject({ customerNeedDiscovery: true, searchCalls: 3 });
      expect(json.meta.webSearch.calls.map((c: { id: string }) => c.id)).toEqual(['product_customer', 'substitute', 'customer_need']);
      const roleCall = mockResponsesCreate.mock.calls[0][0];
      expect(roleCall.text.format.name).toBe('customer_roles');
      expect(roleCall.tools).toBeUndefined();
      const needInput = mockResponsesCreate.mock.calls[3][0].input as string;
      expect(needInput).toContain('利用者の不満が小さい');
      expect(needInput).toContain('製品・顧客市場（公開分類）');
      expect(needInput).not.toContain('SECRET-NEED-SUMMARY-9301');
      expect(needInput).not.toContain('塗料メーカー');
      const analysisCall = mockResponsesCreate.mock.calls[4][0];
      expect(analysisCall.text.format.schema.properties).toHaveProperty('customerNeedOpportunities');
      expect(analysisCall.input).toContain('<customer_roles>');
      expect(allText(analysisCall)).toContain('顧客の未充足ニーズ');
    } finally {
      delete process.env.OT_CUSTOMER_NEED_DISCOVERY;
    }
  });

  it('顧客課題の機会は、役割にある主体だけを残し、仮説として機会の一覧に加える', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    process.env.OT_CUSTOMER_NEED_DISCOVERY = 'true';
    try {
      const supported = {
        who: 'direct_customer',
        problem: '塗料工場で空になった缶の回収と廃棄に手間がかかっている',
        desiredOutcome: null,
        whyCurrentFails: null,
        payer: 'direct_customer',
        companyLink: '18L缶の製造ノウハウ',
        breadth: 'partial',
        opportunity: '塗料工場の空缶の回収・廃棄の省力化需要が拡大する可能性がある。',
        basis: 'hypothesis',
        evidence: '',
        sourceIndex: null,
      };
      const unsupported = { ...supported, who: 'end_beneficiary', opportunity: '最終利用者の需要が拡大する可能性がある。' };
      mockResponsesCreate
        .mockResolvedValueOnce(rolesResponse())
        .mockResolvedValueOnce(searchResponse())
        .mockResolvedValueOnce(searchResponse())
        .mockResolvedValueOnce(searchResponse('利用者の負担が増えている。'))
        .mockResolvedValueOnce(analysisWithNeeds([supported, unsupported]));
      const json = await (await POST(req(NIHON_SEIKAN))).json();

      expect(json.opportunity).toHaveLength(6);
      expect(json.opportunity).toContain(supported.opportunity);
      expect(json.opportunity).not.toContain(unsupported.opportunity);
      const added = json.insights.opportunity.find((i: { text: string }) => i.text === supported.opportunity);
      expect(added).toMatchObject({
        basis: 'hypothesis',
        need: { discoveryPath: 'customer_need', who: 'direct_customer', grade: 'hypothesis', breadth: 'partial' },
      });
      expect(added.need.gradeReasons).toContain('課題の広がりを示す公開情報が未確認');
    } finally {
      delete process.env.OT_CUSTOMER_NEED_DISCOVERY;
    }
  });

  it('美術缶の事業では、役割が確認した顧客業界だけで顧客課題を探索し、同じ事業の別の顧客（塗料・化学品）を混ぜない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    process.env.OT_CUSTOMER_NEED_DISCOVERY = 'true';
    try {
      mockResponsesCreate
        .mockResolvedValueOnce(
          rolesResponse([
            { role: 'direct_customer', basis: 'input', label: '食品メーカー', evidence: '主要顧客', categoryIds: ['c_food_maker'] },
          ])
        )
        .mockResolvedValueOnce(searchResponse())
        .mockResolvedValueOnce(searchResponse())
        .mockResolvedValueOnce(searchResponse())
        .mockResolvedValueOnce(analysisResponse());
      await POST(
        req({
          ...NIHON_SEIKAN,
          businessSegments: [
            {
              name: '美術缶事業',
              summary: '美術缶を製造',
              mainProductsServices: ['美術缶'],
              keyCustomers: ['塗料メーカー', '食品メーカー'],
              revenue: 11278,
            },
          ],
        })
      );
      const needCall = mockResponsesCreate.mock.calls
        .map((c) => c[0])
        .find((p) => typeof p.input === 'string' && p.input.includes('次の観点で、上の市場の利用者'));
      expect(needCall.input).toContain('食品・飲料メーカー');
      expect(needCall.input).not.toContain('塗料・化学品メーカー');
    } finally {
      delete process.env.OT_CUSTOMER_NEED_DISCOVERY;
    }
  });

  it('店舗内装の事業は、分類表で一致し、顧客課題の探索が実際に走る（分類表外で探索ゼロにしない）', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    process.env.OT_CUSTOMER_NEED_DISCOVERY = 'true';
    try {
      mockResponsesCreate.mockImplementation(async (params: { text?: { format?: { name?: string } }; tools?: unknown }) => {
        if (params.text?.format?.name === 'customer_roles') {
          return rolesResponse([
            { role: 'direct_customer', basis: 'input', label: '店舗経営者', evidence: '主要顧客', categoryIds: ['c_store_operator'] },
          ]);
        }
        if (params.tools) return searchResponse();
        return analysisResponse();
      });
      const json = await (
        await POST(
          req(
            body({
              industry: 'service',
              businessContent: '店舗の内装工事',
              businessSegments: [
                {
                  name: '店舗内装事業',
                  summary: '飲食店・小売店の内装工事',
                  mainProductsServices: ['店舗内装工事'],
                  keyCustomers: ['店舗経営者'],
                  revenue: 3000,
                },
              ],
            })
          )
        )
      ).json();
      expect(json.meta.diagnostics.customerNeeds).toMatchObject({ active: true });
      expect(json.meta.diagnostics.customerNeeds.segments[0]).toMatchObject({ plan: 'categories', customerConfirmed: true });
      const needCall = mockResponsesCreate.mock.calls
        .map((c) => c[0])
        .find((p) => typeof p.input === 'string' && p.input.includes('次の観点で、上の市場の利用者'));
      expect(needCall.input).toContain('店舗・商業施設の内装（設計・施工・改装）');
    } finally {
      delete process.env.OT_CUSTOMER_NEED_DISCOVERY;
      mockResponsesCreate.mockReset();
    }
  });

  it('初回の応答は、追加探索に渡す根拠（出典と根拠文）を含み、機会にグループを付ける', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockImplementation(async (params: { tools?: unknown }) => (params.tools ? searchResponse() : analysisResponse()));
    const json = await (await POST(req(body({ industry: 'manufacturing', businessContent: '金属缶の製造' })))).json();
    mockResponsesCreate.mockReset();

    expect(json.meta.evidence.sources[0]).toMatchObject({ index: 1, url: SOURCE_URL });
    expect(json.meta.evidence.findings[0]).toMatchObject({ sourceIndex: 1 });
    expect(json.insights.opportunity[0].group).toBe('existing_market');
  });

  it('追加探索は Web 検索をやり直さず、既存と重複しない候補だけを返す', async () => {
    mockResponsesCreate.mockResolvedValueOnce(
      messageWithText(
        JSON.stringify({
          opportunities: [
            { text: '既存の機会。', group: 'existing_market', basis: 'hypothesis', evidence: '', sourceIndex: null },
            { text: '新しい地域の機会が広がる可能性がある。', group: 'new_region', basis: 'hypothesis', evidence: '', sourceIndex: null },
            { text: '新しい用途の機会が広がる可能性がある。', group: 'new_customer_use', basis: 'fact', evidence: '[1]', sourceIndex: 1 },
          ],
        })
      )
    );
    const res = await POST(
      req({
        ...body({ industry: 'manufacturing', businessContent: '金属缶の製造' }),
        mode: 'extend',
        evidence: {
          findings: [{ theme: '市場', statement: '出荷が増えた。', sourceIndex: 1 }],
          sources: [{ index: 1, url: SOURCE_URL, title: 'Report', retrievedAt: '2026-10-31T00:00:00.000Z', contentVerified: false, bodyCheck: 'unavailable' }],
        },
        existing: [{ text: '既存の機会。', group: 'existing_market' }],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    const call = mockResponsesCreate.mock.calls[0][0];
    expect(call.tools).toBeUndefined();
    expect(call.text.format.name).toBe('ot_expansion');
    expect(call.instructions).toContain('既存の候補（これらと重複させない）');
    expect(json.opportunity).toEqual(['新しい地域の機会が広がる可能性がある。', '新しい用途の機会が広がる可能性がある。']);
    expect(json.insights.opportunity[1]).toMatchObject({ group: 'new_customer_use', basis: 'hypothesis', sourceIndex: 1, origin: 'extension' });
    expect(json.meta).toMatchObject({ mode: 'extend', added: 2, duplicates: 1, searchCalls: 0 });
  });

  it.each(['member', 'manager', 'viewer'])('STAGE2 の編集は管理者のみ：%s の権限では初回生成も追加探索も実行できず、AI も呼ばない', async (role) => {
    (requireMembership as jest.Mock).mockResolvedValue({ company_id: 'c1', role });
    const first = await POST(req(body({ industry: 'manufacturing', businessContent: '金属缶の製造' })));
    const extend = await POST(
      req({ ...body({ industry: 'manufacturing', businessContent: '金属缶の製造' }), mode: 'extend', existing: [] })
    );
    expect(first.status).toBe(403);
    expect(extend.status).toBe(403);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it('管理者は、外部の根拠がなくても追加探索でき、結果は探索仮説（出典なし）として返る', async () => {
    mockResponsesCreate.mockResolvedValueOnce(
      messageWithText(
        JSON.stringify({
          opportunities: [
            { text: '社内の強みから見た新しい用途の機会が広がる可能性がある。', group: 'new_customer_use', basis: 'fact', evidence: '', sourceIndex: 3 },
          ],
        })
      )
    );
    const res = await POST(
      req({ ...body({ industry: 'manufacturing', businessContent: '金属缶の製造' }), mode: 'extend', existing: [{ text: '既存の機会。', group: 'existing_market' }] })
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(mockResponsesCreate.mock.calls[0][0].tools).toBeUndefined();
    expect(mockResponsesCreate.mock.calls[0][0].instructions).toContain('sourceIndex を null');
    expect(json.insights.opportunity[0]).toMatchObject({ basis: 'hypothesis', sourceIndex: null, origin: 'extension' });
  });

  it('閲覧のみの権限では追加探索を実行できず、AI も呼ばない', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({ company_id: 'c1', role: 'viewer' });
    const res = await POST(
      req({
        ...body({ industry: 'manufacturing', businessContent: '金属缶の製造' }),
        mode: 'extend',
        evidence: { findings: [], sources: [] },
        existing: [],
      })
    );
    expect(res.status).toBe(403);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it('追加探索の根拠に https 以外の出典が含まれれば、受け付けず、AI も呼ばない', async () => {
    const res = await POST(
      req({
        ...body({ industry: 'manufacturing', businessContent: '金属缶の製造' }),
        mode: 'extend',
        evidence: { findings: [], sources: [{ index: 1, url: 'http://example.com/a', title: 't', retrievedAt: '2026-10-31T00:00:00.000Z' }] },
        existing: [],
      })
    );
    expect(res.status).toBe(400);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: '建設業',
      industry: 'construction',
      businessContent: '電気設備工事・空調設備の施工',
      segment: {
        name: '設備工事事業',
        summary: 'SECRET-CONSTR-5501 空調設備の施工',
        mainProductsServices: ['空調設備の施工'],
        keyCustomers: ['ゼネコン', '不動産オーナー'],
      },
      expectLabel: '建設工事・設備工事',
      secret: 'SECRET-CONSTR-5501',
    },
    {
      name: 'IT（SaaS）',
      industry: 'it',
      businessContent: '中小企業向けの業務用SaaS',
      segment: {
        name: 'SaaS事業',
        summary: 'SECRET-IT-5502 勤怠管理のクラウドサービス',
        mainProductsServices: ['勤怠管理SaaS'],
        keyCustomers: ['企業向けの人事部門'],
      },
      expectLabel: '業務用ソフトウェア・SaaS',
      secret: 'SECRET-IT-5502',
    },
    {
      name: '小売業',
      industry: 'retail',
      businessContent: '食品の小売店舗',
      segment: {
        name: '店舗事業',
        summary: 'SECRET-RETAIL-5503 ネット通販も運営',
        mainProductsServices: ['食品の店頭販売'],
        keyCustomers: ['一般消費者'],
      },
      expectLabel: '小売店舗・ECによる販売',
      secret: 'SECRET-RETAIL-5503',
    },
  ])('架空企業（$name）: 業種に合う公開分類で検索し、非公開の語は送らない', async ({ industry, businessContent, segment, expectLabel, secret }) => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(analysisResponse());

    const json = await (await POST(req(body({ industry, businessContent, businessSegments: [segment] })))).json();

    const [s1, s2] = mockResponsesCreate.mock.calls.map((c) => c[0]);
    expect(s1.input).toContain(expectLabel);
    expect(s1.input).not.toContain(secret);
    expect(s2.input).not.toContain(secret);
    expect(json.meta.webSearch.classification).toBe('matched');
    expect(json.meta.webSearch.calls.map((c: { id: string }) => c.id)).toEqual(['product_customer', 'substitute']);
  });

  it('IT・SaaS: 法人向けのIT市場を顧客市場として検索する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    await POST(
      req(
        body({
          industry: 'it',
          businessContent: '中小企業向けの業務用SaaS',
          businessSegments: [{ name: 'SaaS事業', summary: '勤怠管理のクラウドサービス', mainProductsServices: ['勤怠管理SaaS'], keyCustomers: ['法人のお客様'], revenue: 800 }],
        })
      )
    );

    expect(mockResponsesCreate.mock.calls[0][0].input).toContain('顧客業界（公開分類）: 法人（企業の情報システム部門など）');
  });

  it('法人の顧客があっても、IT文脈が無ければ IT 市場として検索しない（日本製罐の再現）', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    await POST(
      req(
        body({
          industry: 'manufacturing',
          businessContent: '金属缶の製造',
          businessSegments: [{ name: '金属缶製造販売事業', summary: '18L缶を製造', mainProductsServices: ['18L缶'], keyCustomers: ['法人のお客様'], revenue: 11278 }],
        })
      )
    );

    const s1 = mockResponsesCreate.mock.calls[0][0].input;
    expect(s1).toContain('製品市場（公開分類）: 金属缶・金属容器、18リットル缶（一斗缶）');
    expect(s1).not.toContain('法人（企業の情報システム部門など）');
  });

  it.each([
    { name: '施工', word: '施工不要の省力化装置を製造', label: '建設工事・設備工事' },
    { name: '店舗', word: '店舗向けの什器を製造', label: '小売店舗・ECによる販売' },
  ])('製造業で「$name」を含む事業説明でも、$label の市場として検索しない', async ({ word, label }) => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    const json = await (
      await POST(
        req(
          body({
            industry: 'manufacturing',
            businessContent: '産業用装置の製造',
            businessSegments: [{ name: '装置事業', summary: word, mainProductsServices: ['装置'], keyCustomers: ['社内の設備担当'], revenue: 1200 }],
          })
        )
      )
    ).json();

    expect(mockResponsesCreate.mock.calls[0][0].input).not.toContain(label);
    expect(json.meta.webSearch.classification).toBe('unmatched');
  });

  it('複数事業: 不動産賃貸事業を別の製品市場として検索し、非公開の語は送らない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());
    const secret = 'SECRET-REALESTATE-6601';

    const json = await (
      await POST(
        req(
          body({
            industry: 'manufacturing',
            businessContent: '金属缶の製造・販売',
            businessSegments: [
              { name: '金属缶製造販売事業', summary: '18L缶を製造', mainProductsServices: ['18L缶'], keyCustomers: ['塗料メーカー'], revenue: 11278 },
              { name: '不動産賃貸事業', summary: `${secret} 賃貸物件の運営`, mainProductsServices: ['賃貸物件'], keyCustomers: ['入居者'], revenue: 3000 },
            ],
          })
        )
      )
    ).json();

    const [s1, s2] = mockResponsesCreate.mock.calls.map((c) => c[0]);
    expect(s1.input).toContain('事業1の製品市場（公開分類）: 金属缶・金属容器、18リットル缶（一斗缶）');
    expect(s1.input).toContain('事業2の製品市場（公開分類）: 不動産賃貸（オフィス・住宅・店舗の賃貸）');
    expect(s1.input).toContain('事業2の顧客業界（公開分類）: テナント・入居者');
    expect(s1.input).not.toContain(secret);
    expect(s2.input).not.toContain(secret);
    expect(json.meta.webSearch).toMatchObject({ classification: 'matched', searchCalls: 2 });
  });

  it('分類できない事業が残る場合は partial と記録し、一致した事業の検索は行う', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    const json = await (
      await POST(
        req(
          body({
            industry: 'manufacturing',
            businessContent: '金属缶の製造',
            businessSegments: [
              { name: '金属缶製造販売事業', summary: '18L缶を製造', mainProductsServices: ['18L缶'], keyCustomers: ['塗料メーカー'], revenue: 11278 },
              { name: '研修事業', summary: '社員研修の企画', mainProductsServices: ['研修'], keyCustomers: ['社内の人事担当'], revenue: 500 },
            ],
          })
        )
      )
    ).json();

    expect(json.meta.webSearch).toMatchObject({ classification: 'partial', searchCalls: 2 });
  });

  it('分類できない企業は推測せず、業種レベルの検索を1回だけ行う', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockResolvedValueOnce(searchResponse()).mockResolvedValueOnce(analysisResponse());

    const json = await (
      await POST(
        req(
          body({
            industry: 'service',
            businessContent: '地域の相談窓口を運営',
            businessSegments: [{ name: '相談事業', summary: '相談サービス', mainProductsServices: ['相談サービス'], keyCustomers: ['地域住民'] }],
          })
        )
      )
    ).json();

    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
    expect(mockResponsesCreate.mock.calls[0][0].input).toContain('業界: その他サービス業');
    expect(json.meta.webSearch).toMatchObject({ classification: 'unmatched', calls: [{ id: 'industry', categoryIds: [] }] });
  });

  it('1回の検索が失敗しても、残りの結果で続行する', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockRejectedValueOnce(apiError(400))
      .mockResolvedValueOnce(searchResponse('金属缶の需要が増える。'))
      .mockResolvedValueOnce(analysisResponse());

    const json = await (await POST(req(NIHON_SEIKAN))).json();

    expect(json.meta.webSearch).toMatchObject({ status: 'completed', searchCalls: 1, errorCode: null });
    expect(json.meta.analysisMode).toBe('with_web');
    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);
  });

  it('すべての検索が失敗したら、分析は内部情報だけで続け、出典は付けない', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate
      .mockRejectedValueOnce(apiError(400))
      .mockRejectedValueOnce(apiError(400))
      .mockResolvedValueOnce(analysisResponse());

    const res = await POST(req(NIHON_SEIKAN));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.webSearch).toMatchObject({ status: 'failed', errorCode: 'bad_request', searchCalls: 0 });
    expect(json.meta.analysisMode).toBe('internal_only');
    expect(json.sources).toEqual([]);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);
  });

  it('事実として書かれた将来の影響は、仮説に補正して表示する', async () => {
    const ot = {
      opportunities: [
        { text: '需要が拡大する可能性がある。', basis: 'fact', evidence: '入力の強み', sourceIndex: null },
        ...five('機会').slice(1).map((t) => item(t)),
      ],
      threats: five('脅威').map((t) => item(t)),
    };
    mockResponsesCreate.mockResolvedValueOnce({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(ot), annotations: [] }] }],
    });

    const json = await (await POST(req(baseBody))).json();

    expect(json.insights.opportunity[0].basis).toBe('hypothesis');
    expect(json.meta.quality.basisCorrected).toBe(1);
  });
});

import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/lib/swot/sourceBody', () => ({
  checkSourceBodies: jest.fn(async ({ sources }: { sources: Array<Record<string, unknown>> }) => ({
    sources: sources.map((s) => ({ ...s, contentVerified: false, bodyCheck: 'unavailable' })),
    stats: { attempted: 0, matched: 0, notMatched: 0, unavailable: sources.length },
  })),
}));

const mockResponsesCreate = jest.fn();
jest.mock('@/lib/openai', () => ({
  openai: {
    responses: { create: (...args: unknown[]) => mockResponsesCreate(...args) },
    chat: { completions: { create: jest.fn() } },
  },
}));

import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { checkSourceBodies } from '@/lib/swot/sourceBody';
import { POST } from './route';

const SOURCE_URL = 'https://example.com/report';

const messageWithText = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [] }] }] });
const item = (text: string) => ({ text, basis: 'hypothesis', evidence: 'テスト根拠', sourceIndex: null });
const five = (p: string) => Array.from({ length: 5 }, (_, i) => `${p}${i + 1}`);

const analysis = () =>
  messageWithText(JSON.stringify({ opportunities: five('機会').map(item), threats: five('脅威').map(item) }));

const searchResponse = () => ({
  output: [
    { type: 'web_search_call', status: 'completed', id: 'ws1', action: { type: 'search', query: 'q', sources: [{ type: 'url', url: SOURCE_URL }] } },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: '規制・社会構造の変化: 新制度が2027年に施行される。',
          annotations: [{ type: 'url_citation', url: SOURCE_URL, title: 'Report', start_index: 0, end_index: 10 }],
        },
      ],
    },
  ],
});

/** 新方式の課題（購入者の番号と文章） */
const DISCOVERY_PROBLEMS = [
  { buyer_ref: 1, subject: 'buyer', text: '商業施設を運営する経営者が、テナントの売上低下に気づくのが遅れ、対策の判断に迷っている。', why_unsolved: '不明' },
  { buyer_ref: 2, subject: 'buyer', text: 'チェーン本部の店舗開発担当が、出店候補地の収益性を見通せずに判断を先送りしている。', why_unsolved: 'データが分散している' },
];

type Mode = {
  needs?: unknown[];
  discovery?: unknown;
  search?: boolean;
  marketOpp?: Array<{ text: string; viewpoint?: string }>;
  expansion?: unknown;
};

/** 呼び出しの内容で応答を返す（順番に依存しない） */
function respond(mode: Mode) {
  return async (params: { tools?: unknown; text?: { format?: { name?: string } } }) => {
    if (params.tools) return searchResponse();
    if (params.text?.format?.name === 'customer_roles') return messageWithText(JSON.stringify({ roles: [{ role: 'direct_customer', basis: 'input', label: '塗料メーカー', evidence: '主要顧客' }] }));
    if (params.text?.format?.name === 'ot_customer_needs') return messageWithText(JSON.stringify({ customerNeedOpportunities: mode.needs ?? [] }));
    if (params.text?.format?.name === 'ot_customer_discovery') {
      return messageWithText(typeof mode.discovery === 'string' ? mode.discovery : JSON.stringify(mode.discovery ?? { problems: DISCOVERY_PROBLEMS }));
    }
    if (params.text?.format?.name === 'ot_expansion') return messageWithText(JSON.stringify(mode.expansion ?? { opportunities: [] }));
    if (mode.marketOpp) {
      return messageWithText(
        JSON.stringify({
          opportunities: mode.marketOpp.map((o) => ({ ...item(o.text), ...(o.viewpoint ? { viewpoint: o.viewpoint } : {}) })),
          threats: five('脅威').map(item),
        })
      );
    }
    return analysis();
  };
}

const SEGMENTS = [
  {
    name: '商業その他施設事業',
    summary: '商業施設の企画・設計・施工',
    mainProductsServices: ['展示設計'],
    keyCustomers: ['商業施設事業者、ホテル・不動産事業者、エンターテインメント事業者'],
    revenue: 72154,
    profit: 6808,
  },
  {
    name: 'チェーンストア事業',
    summary: 'チェーン店舗の企画・施工',
    mainProductsServices: ['新店・改装'],
    keyCustomers: ['外食チェーン、アパレルチェーン、コンビニエンスストア、食品スーパー、生活雑貨、スポーツ・アウトドア等の多店舗企業'],
    revenue: 25619,
    profit: 1984,
  },
  {
    name: '文化施設事業',
    summary: '博物館の企画・展示制作',
    mainProductsServices: ['展示制作'],
    keyCustomers: ['国・地方自治体、博物館・美術館等の運営主体、教育・文化関連団体、企業'],
    revenue: 8929,
    profit: -616,
  },
  { name: 'その他', summary: 'グループ関連サービス', mainProductsServices: ['労働者派遣'], keyCustomers: ['丹青社グループ、法人顧客等'], revenue: 519, profit: 174 },
];

function body(over: Record<string, unknown> = {}) {
  return {
    industry: 'other',
    location: '',
    employees: '',
    businessContent: '展示空間の企画と施工',
    mission: '',
    vision: '',
    value: '',
    ceoIntent: '',
    strength: '',
    weakness: '',
    companyName: '株式会社　丹青社',
    businessSegments: SEGMENTS,
    financeRows: [],
    ...over,
  };
}

const req = (b: unknown) =>
  new NextRequest('http://localhost/api/generate-ot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify(b),
  });

const callsNamed = (name: string) => mockResponsesCreate.mock.calls.filter((c) => c[0].text?.format?.name === name);
const searchCalls = () => mockResponsesCreate.mock.calls.filter((c) => c[0].tools);

function setFlags(legacy: boolean, v2: boolean, web = false) {
  if (legacy) process.env.OT_CUSTOMER_NEED_DISCOVERY = 'true';
  if (v2) process.env.OT_CUSTOMER_DISCOVERY_V2 = 'true';
  if (web) process.env.OT_WEB_SEARCH_ENABLED = 'true';
}

describe('新方式フラグと旧方式フラグの組み合わせ（応答と呼び出し）', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.OT_CUSTOMER_NEED_DISCOVERY;
    delete process.env.OT_CUSTOMER_DISCOVERY_V2;
    delete process.env.OT_WEB_SEARCH_ENABLED;
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
    (requireMembership as jest.Mock).mockResolvedValue({ company_id: 'c1', role: 'admin' });
    (checkSourceBodies as jest.Mock).mockClear();
  });

  it('(1) 両方OFF: 既定どおり。役割・課題・新方式の呼び出しは行わず、機会は探索Aだけ', async () => {
    mockResponsesCreate.mockImplementation(respond({}));
    const json = await (await POST(req(body()))).json();
    expect(callsNamed('customer_roles')).toHaveLength(0);
    expect(callsNamed('ot_customer_needs')).toHaveLength(0);
    expect(callsNamed('ot_customer_discovery')).toHaveLength(0);
    expect(json.opportunity).toEqual(five('機会'));
    expect(json.customerNeedMode).toBeUndefined();
    expect(json.customerDiscovery).toMatchObject({ enabled: false, status: null });
  });

  it('(2) 旧方式ONのみ: 旧方式の役割と顧客課題は従来どおり。新方式の呼び出しは行わない', async () => {
    setFlags(true, false);
    mockResponsesCreate.mockImplementation(respond({ needs: [] }));
    const json = await (await POST(req(body()))).json();
    expect(callsNamed('customer_roles').length).toBeGreaterThan(0);
    expect(callsNamed('ot_customer_needs')).toHaveLength(1);
    expect(callsNamed('ot_customer_discovery')).toHaveLength(0);
    expect(json.customerNeedMode).toBeUndefined();
    expect(json.insights.opportunity.every((i: { discoveryPath?: string }) => i.discoveryPath === 'market')).toBe(true);
  });

  it('(3) 新方式ONのみ: 課題生成は1回。役割と旧方式の課題は行わず、課題を機会②の先頭に置く', async () => {
    setFlags(false, true);
    mockResponsesCreate.mockImplementation(respond({}));
    const json = await (await POST(req(body()))).json();
    expect(callsNamed('customer_roles')).toHaveLength(0);
    expect(callsNamed('ot_customer_needs')).toHaveLength(0);
    expect(callsNamed('ot_customer_discovery')).toHaveLength(1);
    expect(json.customerNeedMode).toBe('v2');
    expect(json.opportunity.slice(0, 2)).toEqual([DISCOVERY_PROBLEMS[0].text, DISCOVERY_PROBLEMS[1].text]);
    expect(json.opportunity.slice(2)).toEqual(five('機会'));
    expect(json.insights.opportunity[0]).toMatchObject({ viewpoint: 'customer_need', basis: 'hypothesis', sourceIndex: null });
    expect(json.insights.opportunity[0].need).toMatchObject({ discoveryPath: 'customer_need' });
    expect(json.insights.opportunity.slice(2).every((i: { discoveryPath?: string }) => i.discoveryPath === undefined)).toBe(true);
    expect(json.customerDiscovery).toMatchObject({ enabled: true, status: 'ok', buyers: 12, problems: 2 });
  });

  it('(3b) 新方式の課題生成の入力に、社内の製品名・強みを含めない（購入者の番号と名称だけ）', async () => {
    setFlags(false, true);
    mockResponsesCreate.mockImplementation(respond({}));
    await POST(req(body()));
    const input = String(callsNamed('ot_customer_discovery')[0][0].input);
    expect(input).toContain('商業施設事業者');
    expect(input).toContain('国・地方自治体');
    expect(input).not.toContain('展示設計');
    expect(input).not.toContain('丹青社');
    expect(input).not.toContain('グループ');
  });

  it('(4) 両方ON: 課題は新方式の1回だけ。旧方式の経路（役割推定を含む）は止め、探索Aの発見経路の表示は旧方式フラグの値のまま', async () => {
    setFlags(true, true);
    mockResponsesCreate.mockImplementation(respond({ needs: [] }));
    const json = await (await POST(req(body()))).json();
    expect(callsNamed('customer_roles')).toHaveLength(0);
    expect(callsNamed('ot_customer_needs')).toHaveLength(0);
    expect(callsNamed('ot_customer_discovery')).toHaveLength(1);
    expect(json.customerNeedMode).toBe('v2');
    expect(json.insights.opportunity.slice(2).every((i: { discoveryPath?: string }) => i.discoveryPath === 'market')).toBe(true);
  });

  it('(5) 新方式ONで会社名が無ければ、課題は作らず既定の応答に戻る（購入者を推定しない）', async () => {
    setFlags(false, true);
    mockResponsesCreate.mockImplementation(respond({}));
    const json = await (await POST(req(body({ companyName: '' })))).json();
    expect(callsNamed('ot_customer_discovery')).toHaveLength(0);
    expect(json.customerNeedMode).toBeUndefined();
    expect(json.customerDiscovery).toMatchObject({ enabled: true, status: 'no_company_name' });
    expect(json.opportunity).toEqual(five('機会'));
  });

  it('(6) 課題の出力が壊れていれば、課題は0件として既定の応答に戻る（機会②を空にしない）', async () => {
    setFlags(false, true);
    mockResponsesCreate.mockImplementation(respond({ discovery: 'これは JSON ではありません' }));
    const json = await (await POST(req(body()))).json();
    expect(callsNamed('ot_customer_discovery')).toHaveLength(1);
    expect(json.customerNeedMode).toBeUndefined();
    expect(json.opportunity).toEqual(five('機会'));
  });

  it('(7) 新方式ONは探索Aの検索回数を変えない（検索の追加なし）', async () => {
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    mockResponsesCreate.mockImplementation(respond({}));
    await POST(req(body()));
    const off = searchCalls().length;

    mockResponsesCreate.mockReset();
    jest.clearAllMocks();
    setFlags(false, true, true);
    mockResponsesCreate.mockImplementation(respond({}));
    await POST(req(body()));
    const v2 = searchCalls().length;

    mockResponsesCreate.mockReset();
    setFlags(true, false, true);
    mockResponsesCreate.mockImplementation(respond({ needs: [] }));
    await POST(req(body()));
    const legacy = searchCalls().length;

    expect(v2).toBe(off);
    expect(legacy).toBeGreaterThanOrEqual(off);
  });

  it('(8) 本文確認は、旧方式フラグの値だけで決まる（新方式ONでは実行されない）', async () => {
    setFlags(false, true, true);
    mockResponsesCreate.mockImplementation(respond({}));
    await POST(req(body()));
    expect(checkSourceBodies).not.toHaveBeenCalled();

    (checkSourceBodies as jest.Mock).mockClear();
    mockResponsesCreate.mockReset();
    jest.clearAllMocks();
    delete process.env.OT_CUSTOMER_DISCOVERY_V2;
    setFlags(true, false, true);
    mockResponsesCreate.mockImplementation(respond({ needs: [] }));
    await POST(req(body()));
    expect(checkSourceBodies).toHaveBeenCalled();
  });
});

describe('機会②の整合性（新方式ON）: 探索Aの顧客関連の項目と追加探索', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.OT_CUSTOMER_NEED_DISCOVERY;
    delete process.env.OT_CUSTOMER_DISCOVERY_V2;
    delete process.env.OT_WEB_SEARCH_ENABLED;
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
    (requireMembership as jest.Mock).mockResolvedValue({ company_id: 'c1', role: 'admin' });
  });

  it('(9) 新方式ON: 探索Aの顧客関連の項目は候補の一覧から外すが、探索Aの元データ（insights）には残す', async () => {
    setFlags(false, true);
    mockResponsesCreate.mockImplementation(
      respond({
        marketOpp: [
          { text: '市場の変化A', viewpoint: 'world_change' },
          { text: '市場の顧客課題B', viewpoint: 'customer_need' },
          { text: '業界の変化C', viewpoint: 'industry_competition' },
        ],
      })
    );
    const json = await (await POST(req(body()))).json();
    expect(json.opportunity).toEqual([DISCOVERY_PROBLEMS[0].text, DISCOVERY_PROBLEMS[1].text, '市場の変化A', '業界の変化C']);
    expect(json.opportunity).not.toContain('市場の顧客課題B');
    const raw = json.insights.opportunity.map((i: { text: string }) => i.text);
    expect(raw).toContain('市場の顧客課題B');
    expect(json.threat).toEqual(five('脅威'));
  });

  it('(9b) 新方式OFF: 探索Aの顧客関連の項目も、従来どおり候補の一覧に残る', async () => {
    mockResponsesCreate.mockImplementation(respond({ marketOpp: [{ text: '市場の顧客課題B', viewpoint: 'customer_need' }] }));
    const json = await (await POST(req(body()))).json();
    expect(json.opportunity).toEqual(['市場の顧客課題B']);
    expect(json.customerNeedMode).toBeUndefined();
  });

  it('(10) 追加探索（新方式の応答）は、顧客関連の項目を候補に入れない', async () => {
    mockResponsesCreate.mockImplementation(
      respond({
        expansion: {
          opportunities: [
            { text: '追加の顧客課題D', group: 'existing_market', viewpoint: 'customer_need', basis: 'hypothesis', evidence: '', sourceIndex: null },
            { text: '追加の世の中の変化E', group: 'new_region', viewpoint: 'world_change', basis: 'hypothesis', evidence: '', sourceIndex: null },
          ],
        },
      })
    );
    const json = await (await POST(req(body({ mode: 'extend', customerNeedMode: 'v2', existing: [] })))).json();
    expect(json.opportunity).toEqual(['追加の世の中の変化E']);
  });

  it('(10b) 追加探索（新方式OFF）は、従来どおり顧客関連の項目も候補に入れる', async () => {
    mockResponsesCreate.mockImplementation(
      respond({
        expansion: {
          opportunities: [
            { text: '追加の顧客課題D', group: 'existing_market', viewpoint: 'customer_need', basis: 'hypothesis', evidence: '', sourceIndex: null },
          ],
        },
      })
    );
    const json = await (await POST(req(body({ mode: 'extend', existing: [] })))).json();
    expect(json.opportunity).toEqual(['追加の顧客課題D']);
  });
});

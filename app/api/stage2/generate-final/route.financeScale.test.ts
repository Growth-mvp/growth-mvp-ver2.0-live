import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  assertMinRole: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/inputGuardLogger', () => ({
  checkSuspiciousKeywords: () => ({ autoMotive: false, exhaust: false, ceramic: false, oem: false }),
  logInputGuard: jest.fn(async () => true),
}));
jest.mock('@/lib/modelConfig', () => ({
  AI_MODELS: { reasoning: 'test-model', lightweight: 'test-model' },
  MODEL_CONFIGURATIONS: {},
  getOpenAIModelParamsForProcess: () => ({ model: 'test-model' }),
  getTokenLimitParam: () => ({}),
  getTemperatureParam: () => ({}),
  getPenaltyParams: () => ({}),
}));
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } };
  },
}));

import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: (req: NextRequest) => Promise<Response>;
beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  // route は読み込み時に OPENAI_API_KEY を検査するため、設定後に読み込む
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  POST = require('./route').POST;
});

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '99999999-9999-4999-8999-999999999999';
const STRATEGY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function salesInPrompt(messages: Array<{ content?: unknown }>): number | null {
  const text = messages.map((m) => String(m.content ?? '')).join('\n');
  const m = text.match(/"sales":(-?[\d.]+)/);
  return m ? Number(m[1]) : null;
}

function fakeAdmin() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { company_id: COMPANY }, error: null }),
        }),
      }),
    }),
  };
}

async function runWithFinance(csvFinanceData: unknown): Promise<number | null> {
  mockCreate.mockReset();
  mockCreate.mockRejectedValue(new Error('stop after prompt capture'));
  const req = new NextRequest('http://localhost/api/stage2/generate-final', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      strategyDataId: STRATEGY,
      industry: '製造業',
      revenue: 100,
      employees: 50,
      csvFinanceData,
      mvv: { thought: '思い', mission: 'ミッション', vision: 'ビジョン', value: '価値' },
      swot: { strength: '強み', weakness: '弱み', opportunity: '機会', threat: '脅威' },
    }),
  });
  await POST(req);
  for (const call of mockCreate.mock.calls) {
    const v = salesInPrompt((call[0] as { messages: Array<{ content?: unknown }> }).messages);
    if (v !== null) return v;
  }
  return null;
}

function finMiniFromPrompt(messages: Array<{ content?: unknown }>): { sales: number | null; opm: number | null } {
  const text = messages.map((m) => String(m.content ?? '')).join('\n');
  const pick = (name: string): number | null => {
    const m = text.match(new RegExp('"' + name + '":(-?[\\d.]+|null)'));
    return m && m[1] !== 'null' ? Number(m[1]) : null;
  };
  return { sales: pick('sales'), opm: pick('opm') };
}

async function runFinanceSummary(csvFinanceData: unknown): Promise<{ sales: number | null; opm: number | null }> {
  mockCreate.mockReset();
  mockCreate.mockRejectedValue(new Error('stop after prompt capture'));
  const req = new NextRequest('http://localhost/api/stage2/generate-final', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      strategyDataId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      industry: '製造業',
      revenue: 100,
      employees: 50,
      csvFinanceData,
      mvv: { thought: '思い', mission: 'ミッション', vision: 'ビジョン', value: '価値' },
      swot: { strength: '強み', weakness: '弱み', opportunity: '機会', threat: '脅威' },
    }),
  });
  await POST(req);
  for (const call of mockCreate.mock.calls) {
    const r = finMiniFromPrompt((call[0] as { messages: Array<{ content?: unknown }> }).messages);
    if (r.sales !== null || r.opm !== null) return r;
  }
  return { sales: null, opm: null };
}

describe('stage2/generate-final: 売上高(万円)の百万円換算', () => {
  beforeEach(() => {
    (getSupabaseAdmin as jest.Mock).mockReturnValue(fakeAdmin());
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    (requireMembership as jest.Mock).mockResolvedValue({ companyId: COMPANY, role: 'admin', userId: USER });
  });

  it('売上高(万円)=500 は 5 百万円としてAIへ渡される（500万円 = 5百万円）', async () => {
    const sales = await runWithFinance([{ year: 2024, '売上高(万円)': 500 }]);
    expect(sales).toBe(5);
  });

  it('売上(百万円)の値は換算されずそのまま渡される', async () => {
    const sales = await runWithFinance([{ year: 2024, '売上(百万円)': 5 }]);
    expect(sales).toBe(5);
  });

  it('百万円列と万円列が併存する場合は、従来どおり百万円列を使う', async () => {
    const sales = await runWithFinance([{ year: 2024, '売上(百万円)': 5, '売上高(万円)': 700 }]);
    expect(sales).toBe(5);
  });

  it('千万円など未対応の単位の列は、誤った百万円値として渡さない', async () => {
    const sales = await runWithFinance([{ year: 2024, '売上(千万円)': 3 }]);
    expect(sales).toBeNull();
  });

  describe('Phase 2B-1 追加: 明示された単位の列選択', () => {
    it('売上高(千円)=5000 は 5 百万円として渡される', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上高(千円)': 5000 }])).sales).toBe(5);
    });
    it('売上(千円)=5000 は 5 百万円として渡される', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上(千円)': 5000 }])).sales).toBe(5);
    });
    it('売上高(円)=5000000 は 5 百万円として渡される', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上高(円)': 5000000 }])).sales).toBe(5);
    });
    it('円・千円・万円・百万円の同額（5百万円）は同じ売上になる', async () => {
      const yen = (await runFinanceSummary([{ year: 2024, '売上高(円)': 5000000 }])).sales;
      const thousand = (await runFinanceSummary([{ year: 2024, '売上高(千円)': 5000 }])).sales;
      const man = (await runFinanceSummary([{ year: 2024, '売上高(万円)': 500 }])).sales;
      const million = (await runFinanceSummary([{ year: 2024, '売上高(百万円)': 5 }])).sales;
      expect([yen, thousand, man, million]).toEqual([5, 5, 5, 5]);
    });
    it('売上原価(百万円)しかない行を売上高として扱わない', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上原価(百万円)': 100 }])).sales).toBeNull();
    });
    it('営業利益(千円)=2000 は 2 百万円として営業利益率に使われる（売上10百万円なら20%）', async () => {
      const r = await runFinanceSummary([{ year: 2024, '売上高(百万円)': 10, '営業利益(千円)': 2000 }]);
      expect(r.opm).toBe(20);
    });
    it('営業利益(万円)=200 は 2 百万円として営業利益率に使われる（売上10百万円なら20%）', async () => {
      const r = await runFinanceSummary([{ year: 2024, '売上高(百万円)': 10, '営業利益(万円)': 200 }]);
      expect(r.opm).toBe(20);
    });
    it('営業利益(百万円)=2 は従来どおり 2 百万円として使われる', async () => {
      const r = await runFinanceSummary([{ year: 2024, '売上高(百万円)': 10, '営業利益(百万円)': 2 }]);
      expect(r.opm).toBe(20);
    });
    it('売上高(千円)と売上高(百万円)が併存する場合は、明示された百万円列を優先する', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上高(千円)': 5000, '売上高(百万円)': 5 }])).sales).toBe(5);
    });
    it('単位なしの列と明示単位の列が併存する場合は、明示単位の列を優先する', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上高': 999, '売上高(千円)': 5000 }])).sales).toBe(5);
    });
    it('未対応単位（億円）の列は金額にしない', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上(億円)': 1 }])).sales).toBeNull();
    });
    it('千万円の列と百万円の列が併存する場合は、千万円を誤って使わず百万円列を使う', async () => {
      expect((await runFinanceSummary([{ year: 2024, '売上(千万円)': 3, '売上高(百万円)': 5 }])).sales).toBe(5);
    });
  });
});

describe('単位なしの財務列は円として百万円へ換算してAIへ渡す（GROWTH SHIFTの円統一データ）', () => {
  beforeEach(() => {
    (getSupabaseAdmin as jest.Mock).mockReturnValue(fakeAdmin());
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    (requireMembership as jest.Mock).mockResolvedValue({ companyId: COMPANY, role: 'admin', userId: USER });
  });

  async function promptTextWith(csvFinanceData: unknown): Promise<string> {
    mockCreate.mockReset();
    mockCreate.mockRejectedValue(new Error('stop after prompt capture'));
    const req = new NextRequest('http://localhost/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      body: JSON.stringify({
        strategyDataId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        industry: '製造業',
        revenue: 100,
        employees: 50,
        csvFinanceData,
        mvv: { thought: '思い', mission: 'ミッション', vision: 'ビジョン', value: '価値' },
        swot: { strength: '強み', weakness: '弱み', opportunity: '機会', threat: '脅威' },
      }),
    });
    await POST(req);
    return mockCreate.mock.calls
      .map((c) => (c[0] as { messages: Array<{ content?: unknown }> }).messages.map((m) => String(m.content ?? '')).join('\n'))
      .join('\n');
  }

  it('円単位の売上12億円（単位なし列）は 1200 としてAIへ渡され、JSON に単位「百万円」が付く', async () => {
    expect((await runFinanceSummary([{ year: 2024, '売上高': 1_200_000_000 }])).sales).toBe(1200);
    expect(await promptTextWith([{ year: 2024, '売上高': 1_200_000_000 }])).toContain('"sales":1200,"sales_unit":"百万円"');
  });

  it('円単位の営業利益50万円（単位なし列）は 0.5 百万円として営業利益率に使われる（売上12億円なら約0.0417%）', async () => {
    const r = await runFinanceSummary([{ year: 2024, '売上高': 1_200_000_000, '営業利益': 500_000 }]);
    expect(r.opm).toBeCloseTo(0.0417, 4);
  });

  it('売上0円は 0 として渡し、欠損は金額にしない', async () => {
    expect((await runFinanceSummary([{ year: 2024, '売上高': 0 }])).sales).toBe(0);
    expect((await runFinanceSummary([{ year: 2024, '売上高': null }])).sales).toBeNull();
  });
});

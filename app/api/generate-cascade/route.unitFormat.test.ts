/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => 'user-1'),
  requireMembership: jest.fn(async () => ({ role: 'ADMIN', company_id: 'company-1' })),
  assertMinRole: jest.fn(async () => undefined),
}));

/** どのクエリを投げても空の結果を返すモック（ルートが読む補助データは不要） */
function chainable(): any {
  const target: any = function () {};
  return new Proxy(target, {
    get: (_t, prop) =>
      prop === 'then' ? (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }) : chainable(),
    apply: () => chainable(),
  });
}
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => chainable() }));

const mockCreate = jest.fn();
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } } },
}));

let POST: (req: NextRequest) => Promise<Response>;
beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  POST = require('./route').POST;
});

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }], usage: {} });
});

/** 部門生成に渡る FactPack（[FACTPACK] ブロック）の全文を、AI呼び出しから取り出す */
function promptsSent(): string {
  return JSON.stringify(mockCreate.mock.calls);
}

function requestBody(segments: any[], financeUnitConfirmed: unknown) {
  return {
    industry: '製造業',
    strategySummary: '部門別の財務単位の検証',
    departments: [{ name: 'A事業', answers: [] }, { name: 'B事業', answers: [] }],
    businessSegments: segments,
    csvFinanceData: {},
    financeUnitConfirmed,
  };
}

async function runWith(body: unknown): Promise<string> {
  const req = new NextRequest('http://localhost/api/generate-cascade', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
  await POST(req);
  return promptsSent();
}

const SEG_A = {
  id: 'seg-a',
  name: 'A事業',
  pl: [
    { year: 2024, revenue: 4_000_000, operatingIncome: 200_000 },
    { year: 2025, revenue: 5_000_000, operatingIncome: 250_000 },
  ],
  bs: [{ year: 2025, inventory: 40_000_000 }],
};
const SEG_B = {
  id: 'seg-b',
  name: 'B事業',
  pl: [
    { year: 2024, revenue: 400_000_000, operatingIncome: 20_000_000 },
    { year: 2025, revenue: 500_000_000, operatingIncome: 25_000_000 },
  ],
};

describe('STAGE3 の財務単位（AIプロンプト）', () => {
  it('セグメントの単位が確定していれば、売上・営業利益を単位つきで渡す（円の少額は100万倍しない）', async () => {
    const text = await runWith(requestBody([SEG_A, SEG_B], { segmentPL: ['seg-a', 'seg-b'], segmentBS: ['seg-a', 'seg-b'] }));

    expect(text).toContain('売上は25.0%成長（2025年5百万円）');
    expect(text).toContain('営業利益は250000円、営業利益率は約5.0%（2025年）');
    expect(text).not.toContain('5000000百万円');
    expect(text).not.toContain('250000百万円');
  });

  it('高額な円の売上・営業利益も百万円へ正しく換算する', async () => {
    const text = await runWith(requestBody([SEG_B], { segmentPL: ['seg-b'] }));

    expect(text).toContain('売上は25.0%成長（2025年500百万円）');
    expect(text).toContain('営業利益は25百万円、営業利益率は約5.0%（2025年）');
  });

  it('確定済みのBS（在庫）は、明示された単位で渡す', async () => {
    const text = await runWith(requestBody([SEG_A], { segmentPL: ['seg-a'], segmentBS: ['seg-a'] }));
    expect(text).toContain('在庫は40百万円（2025年）');
  });

  it('単位が未確定のセグメントは、数値を推測せず単位未確認と記載する', async () => {
    const text = await runWith(requestBody([SEG_A, SEG_B], undefined));

    expect(text).toContain('単位未確認');
    expect(text).not.toContain('5百万円');
    expect(text).not.toContain('500百万円');
    expect(text).not.toContain('在庫は40');
  });

  it('1セグメントだけ確定していれば、確定したセグメントの金額だけを渡す', async () => {
    const text = await runWith(requestBody([SEG_A, SEG_B], { segmentPL: ['seg-a'] }));

    expect(text).toContain('売上は25.0%成長（2025年5百万円）');
    expect(text).not.toContain('500百万円');
    expect(text).not.toContain('25百万円');
  });

  it('旧形式の共通フラグ true は、どのセグメントの確定にもならない', async () => {
    const text = await runWith(requestBody([SEG_A, SEG_B], { segmentPL: true, segmentBS: true }));

    expect(text).toContain('単位未確認');
    expect(text).not.toContain('5百万円');
    expect(text).not.toContain('在庫は40');
  });

  it('会社PLが円で確定していても、セグメントの単位は確定しない', async () => {
    const text = await runWith(requestBody([SEG_A], { pl: [2025] }));

    expect(text).toContain('単位未確認');
    expect(text).not.toContain('5百万円');
    expect(text).not.toContain('営業利益は250000円');
  });

  it('セグメントPLが確定していても、未確定のBSの金額は出さない', async () => {
    const text = await runWith(requestBody([SEG_A], { segmentPL: ['seg-a'], segmentBS: [] }));

    expect(text).toContain('売上は25.0%成長（2025年5百万円）');
    expect(text).not.toContain('在庫は40百万円');
  });
});

describe('STAGE3 の財務抜粋（csvFinanceData）の単位', () => {
  const SEG_A_ONLY = [{ id: 'seg-a', name: 'A事業' }];

  async function runWithCsv(csvFinanceData: unknown, financeUnitConfirmed: unknown): Promise<string> {
    return runWith({
      industry: '製造業',
      strategySummary: '部門別の財務単位の検証',
      departments: [{ name: 'A事業', answers: [] }],
      businessSegments: SEG_A_ONLY,
      csvFinanceData,
      financeUnitConfirmed,
    });
  }

  it('セグメントの単位が確定していれば、抜粋の金額は百万円へ換算して渡す', async () => {
    const text = await runWithCsv({ segmentPL: { 'A事業': [{ year: 2025, revenue: 5_000_000 }] } }, { segmentPL: ['seg-a'] });
    expect(text).toContain('5百万円');
    expect(text).not.toContain('5000000');
  });

  it('セグメントの単位が未確定なら、抜粋の金額を出さず単位未確認と記載する', async () => {
    const text = await runWithCsv({ segmentPL: { 'A事業': [{ year: 2025, revenue: 5_000_000 }] } }, undefined);
    expect(text).toContain('単位未確認');
    expect(text).not.toContain('5000000');
    expect(text).not.toContain('5百万円');
  });

  it('会社BSの単位は会社BSの確定だけで判定し、セグメントの確定には従わない', async () => {
    const csv = { financeBS: [{ year: 2025, ar: 123_456_789 }] };
    const unconfirmed = await runWithCsv(csv, { segmentPL: ['seg-a'], segmentBS: ['seg-a'] });
    expect(unconfirmed).not.toContain('123456789');

    const confirmed = await runWithCsv(csv, { bs: true });
    expect(confirmed).toContain('123.5百万円');
  });
});

describe('STAGE1手入力の事業別売上・利益（BusinessSegment.revenue / profit、単位：百万円）', () => {
  it('セグメントPLがない場合は、手入力の売上・利益を百万円と明示して渡す', async () => {
    const seg = { id: 'seg-a', name: 'A事業', revenue: 500, profit: 25 };
    const text = await runWith(requestBody([seg], undefined));

    expect(text).toContain('売上500百万円 利益25百万円（STAGE1手入力・単位：百万円）');
  });

  it('確定したセグメントPLの金額がある場合は、同じ売上・利益を手入力側で重複して出さない', async () => {
    const seg = { ...SEG_A, revenue: 500, profit: 25 };
    const text = await runWith(requestBody([seg], { segmentPL: ['seg-a'] }));

    expect(text).toContain('売上は25.0%成長（2025年5百万円）');
    expect(text).not.toContain('売上500百万円');
    expect(text).not.toContain('利益25百万円（STAGE1手入力');
  });

  it('セグメントPLが未確定でも、手入力の売上・利益は使い、PLの数値は出さない', async () => {
    const seg = { ...SEG_A, revenue: 500, profit: 25 };
    const text = await runWith(requestBody([seg], undefined));

    expect(text).toContain('売上500百万円 利益25百万円（STAGE1手入力・単位：百万円）');
    expect(text).not.toContain('売上5百万円');
  });

  it('手入力の売上・利益の確定は、セグメントPLの確定に影響されない', async () => {
    const seg = { id: 'seg-a', name: 'A事業', revenue: 500 };
    const text = await runWith(requestBody([seg], { segmentPL: [], segmentBS: [] }));

    expect(text).toContain('売上500百万円（STAGE1手入力・単位：百万円）');
  });
});

describe('STAGE1手入力の売上・利益と、確定したセグメントPLの重複', () => {
  const CSV_PL_A = {
    segmentPL: {
      'A事業': [
        { year: 2024, revenue: 4_000_000, operatingIncome: 200_000 },
        { year: 2025, revenue: 5_000_000, operatingIncome: 250_000 },
      ],
    },
  };

  it('業務セグメントに財務データが無く、csvのセグメントPLが確定していれば、手入力の売上は出さない', async () => {
    const seg = { id: 'seg-a', name: 'A事業', revenue: 500, profit: 25 };
    const text = await runWithCsvSegments(CSV_PL_A, [seg], { segmentPL: ['seg-a'] });

    expect(text).toContain('5百万円');
    expect(text).not.toContain('売上500百万円');
  });

  it('csvのセグメントPLが未確定なら、PLの数値は出さず、手入力の売上・利益を使う', async () => {
    const seg = { id: 'seg-a', name: 'A事業', revenue: 500, profit: 25 };
    const text = await runWithCsvSegments(CSV_PL_A, [seg], undefined);

    expect(text).toContain('売上500百万円 利益25百万円（STAGE1手入力・単位：百万円）');
    expect(text).not.toContain('売上は25.0%成長（2025年5百万円）');
  });
});

async function runWithCsvSegments(csvFinanceData: unknown, segments: unknown[], financeUnitConfirmed: unknown): Promise<string> {
  return runWith({
    industry: '製造業',
    strategySummary: '部門別の財務単位の検証',
    departments: [{ name: 'A事業', answers: [] }],
    businessSegments: segments,
    csvFinanceData,
    financeUnitConfirmed,
  });
}

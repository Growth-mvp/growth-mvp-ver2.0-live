/* AI呼び出しは偽物に置き換える（実OpenAI APIは呼ばない）。プロンプトの組立と返却値の検査だけを確認する。 */
const mockCreate = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => 'user-1'),
  requireMembership: jest.fn(async () => ({ role: 'MEMBER' })),
}));
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } };
  },
}));

import { NextRequest } from 'next/server';
import { POST } from './route';

const keep = process.env.OPENAI_API_KEY;
beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key-not-used';
});
afterAll(() => {
  process.env.OPENAI_API_KEY = keep;
});

const modelReply = {
  objective: '既存配送先の単価を回復する',
  role: 'REVENUE',
  impact: {
    revenueMJPY: 120,
    opIncomeMJPY: null,
    investmentMJPY: null,
    rationale: '根拠は仮説',
    assumptions: { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 },
  },
  causalChain: { customer: '既存の配送先', problem: '単価の下落', whyUs: '実績', outcome: '単価回復', verifyNumbers: '過去12か月の商談数' },
  assumptionBasis: { targetCustomers: 'HYPOTHESIS', conversionRatePct: 'BOGUS' },
  verificationItems: ['過去12か月の商談数', '受注率'],
  kpis: [],
  steps: [],
};

function reply(content: unknown) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/stage4/generate-execution-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      body: JSON.stringify(body),
    }),
  );
}

const deliveryCase = {
  projectTitle: '法人顧客の新規獲得',
  departmentName: '物流営業部',
  role: 'REVENUE',
  sourceKpis: ['法人顧客の契約数'],
  companyContext: {
    department: { name: '物流営業部', strategicRole: '法人顧客の新規獲得', keyIssues: ['既存配送先の単価'], interDeptCollab: [], alignmentRisks: [] },
    priorityThemes: ['配送の法人比率を上げる'],
    latestFinance: { year: 2025, revenueMJPY: 1000, operatingIncomeMJPY: 50, operatingMarginPct: 5 },
  },
};

const fitnessCase = {
  projectTitle: '会員の継続率の改善',
  departmentName: 'スポーツ事業部',
  role: 'REVENUE',
  companyContext: {
    department: { name: 'スポーツ事業部', strategicRole: '会員の継続率を高める', keyIssues: ['退会率の上昇'], interDeptCollab: [], alignmentRisks: [] },
    priorityThemes: [],
  },
};

const manufacturingCase = {
  projectTitle: '新用途の部品開拓',
  departmentName: 'ものづくり事業部',
  role: 'REVENUE',
  companyContext: {
    department: { name: 'ものづくり事業部', strategicRole: '新しい用途の部品を開拓する', keyIssues: ['主力部品の原価上昇'], interDeptCollab: [], alignmentRisks: ['新用途の試作の優先順位'] },
    priorityThemes: [],
  },
};

describe('STAGE4 実行計画の生成：プロンプト組立（AIは呼ばない）', () => {
  beforeEach(() => mockCreate.mockReset());

  it('会社情報・因果関係・根拠区分の指示を、AIに渡す文面へ入れる', async () => {
    reply(modelReply);
    const res = await post(deliveryCase);
    expect(res.status).toBe(200);
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('【会社の現状（登録済みの情報のみ。');
    expect(prompt).toContain('物流営業部');
    expect(prompt).toContain('既存配送先の単価');
    expect(prompt).toContain('直近の財務実績（2025年度）：売上 1000百万円、営業利益 50百万円（営業利益率 5%）');
    expect(prompt).toContain('どの顧客のどの課題を解決するのか');
    expect(prompt).toContain('assumptionBasis');
    expect(prompt).toContain('"verificationItems"');
  });

  it('ケース1（配送）：法人顧客の依頼に、フィットネス・製造の情報を混ぜない', async () => {
    reply(modelReply);
    await post(deliveryCase);
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain('スポーツ事業部');
    expect(prompt).not.toContain('退会率の上昇');
    expect(prompt).not.toContain('ものづくり事業部');
  });

  it('ケース2（フィットネス）：会員・継続課金の算定方式を案内し、会社の実績がない退会率を実績として書かせない', async () => {
    reply(modelReply);
    await post(fitnessCase);
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('会員・継続課金：既存会員数、新規加入数、退会率・継続率、月額単価（FUNNELに無理に変換しない）');
    expect(prompt).toContain('退会率の上昇');
    expect(prompt).not.toContain('直近の財務実績');
    expect(prompt).toContain('会社の実績が無い数値を、実績らしく書いてはいけません');
  });

  it('ケース3（製造業）：市場の話だけで売上を確定させず、原価と顧客課題の確認項目を求める', async () => {
    reply(modelReply);
    await post(manufacturingCase);
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('新用途の試作の優先順位');
    expect(prompt).toContain('新規事業・新用途開拓：顧客候補、利用意向、採算条件を確認項目にし、数値は未確定のまま出す');
    expect(prompt).toContain('主力部品の原価上昇');
  });

  it('AIの返却値：根拠区分の不正な値と型の違う項目を捨て、残りを返す（数値は変えない）', async () => {
    reply(modelReply);
    const res = await post(deliveryCase);
    const json = await res.json();
    expect(json.draft.assumptionBasis).toEqual({ targetCustomers: 'HYPOTHESIS' });
    expect(json.draft.verificationItems).toEqual(['過去12か月の商談数', '受注率']);
    expect(json.draft.causalChain).toMatchObject({ customer: '既存の配送先', verifyNumbers: '過去12か月の商談数' });
    expect(json.draft.impact.assumptions).toEqual({ targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 });
  });

  it('AI呼び出しが1回だけで、実際の外部APIへの接続は行わない（偽物のみ）', async () => {
    reply(modelReply);
    await post(fitnessCase);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

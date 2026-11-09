/* AI呼び出しは偽物に置き換える（実OpenAI APIは呼ばない）。DBは架空の表をメモリに置いたモックで置き換える。
 * 確かめること：認証・所属・戦略・プロジェクトの照合が通った後にだけAIを呼ぶこと、他社の情報を混ぜないこと、
 * 保存処理（insert/update/upsert/delete）を一度も呼ばないこと、エラー時に内部の情報を返さないこと。 */
const mockCreate = jest.fn();
const writes: string[] = [];
let tables: Record<string, Array<Record<string, unknown>>> = {};
let failTable: string | null = null;

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => 'user-1'),
}));
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } };
  },
}));

import { NextRequest } from 'next/server';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { POST } from './route';

type FakeQuery = {
  select(): FakeQuery;
  eq(c: string, v: unknown): FakeQuery;
  in(c: string, vs: unknown[]): FakeQuery;
  insert(): FakeQuery;
  update(): FakeQuery;
  upsert(): FakeQuery;
  delete(): FakeQuery;
  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown): Promise<unknown>;
};

function fakeAdmin() {
  return {
    from(table: string): FakeQuery {
      const rows = tables[table] ?? [];
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const q: FakeQuery = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters.push((r) => r[c] === v);
          return q;
        },
        in: (c: string, vs: unknown[]) => {
          filters.push((r) => vs.includes(r[c]));
          return q;
        },
        insert: () => (writes.push(`${table}.insert`), q),
        update: () => (writes.push(`${table}.update`), q),
        upsert: () => (writes.push(`${table}.upsert`), q),
        delete: () => (writes.push(`${table}.delete`), q),
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          if (failTable === table) {
            return Promise.resolve({ data: null, error: { message: 'connection refused at db.internal:5432 (secret)' } }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const keep = process.env.OPENAI_API_KEY;
beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key-not-used';
});
afterAll(() => {
  process.env.OPENAI_API_KEY = keep;
});

const COMPANY_A = 'co-a';
const COMPANY_B = 'co-b';

const projectA = {
  title: '法人顧客の新規獲得',
  hypothesis: '既存の配送先の単価を上げる',
  role: 'REVENUE',
  okrs: [{ due: '2027-04', owner: '田中 一郎' }],
  okrsV2: [
    { id: 'k-confirmed', label: '法人顧客の契約数', target: 10, unit: '件', due: '2027-04', owner: '田中 一郎', targetBasis: 'USER_CONFIRMED' },
    { id: 'k-unknown', label: '既存配送先の単価', target: 0, unit: '%', due: '2027-05', owner: null },
    { id: 'k-ai', label: '商談の件数', target: 5, unit: '件', due: '2027-06', owner: null, targetBasis: 'AI_PROVISIONAL' },
  ],
};

const strategyA = {
  id: 'st-a',
  company_id: COMPANY_A,
  departments: [
    { name: '物流営業部', strategicRole: '法人顧客を増やす', keyIssues: ['既存配送先の単価'], projects: [projectA] },
    { name: 'スポーツ事業部', projects: [{ title: '会員の継続率の改善', okrsV2: [] }] },
    { name: 'ものづくり事業部', projects: [{ title: '新用途の部品開拓', okrsV2: [] }] },
  ],
};

const strategyB = {
  id: 'st-b',
  company_id: COMPANY_B,
  departments: [
    {
      name: '物流営業部',
      projects: [
        {
          title: '他社だけの案件',
          okrsV2: [{ id: 'b-1', label: '他社の秘密のKPI', target: 99, unit: '件', due: '2027-01', owner: null, targetBasis: 'USER_CONFIRMED' }],
        },
      ],
    },
  ],
};

const memberOfA = { company_id: COMPANY_A, user_id: 'user-1', role: 'member' };

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

function post(body: unknown, headers: Record<string, string> = { authorization: 'Bearer t' }) {
  return POST(
    new NextRequest('http://localhost/api/stage4/generate-execution-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const deliveryBody = {
  projectTitle: '法人顧客の新規獲得',
  departmentName: '物流営業部',
  role: 'REVENUE',
  companyContext: {
    department: { name: '物流営業部', strategicRole: '法人顧客を増やす', keyIssues: ['既存配送先の単価'], interDeptCollab: [], alignmentRisks: [] },
    priorityThemes: ['配送の法人比率を上げる'],
    latestFinance: { year: 2025, revenueMJPY: 1000, operatingIncomeMJPY: 50, operatingMarginPct: 5 },
  },
};

beforeEach(() => {
  mockCreate.mockReset();
  writes.length = 0;
  failTable = null;
  tables = {
    company_members: [memberOfA],
    strategy_data: [strategyA, strategyB],
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fakeAdmin());
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
});

describe('STAGE4 実行計画の生成API：認証・スコープ・権限', () => {
  it('正常な組み合わせ：所属企業の戦略のプロジェクトだけを使い、AIを1回呼ぶ', async () => {
    reply(modelReply);
    const res = await post({ ...deliveryBody, sourceKpis: ['他社の秘密のKPI'] });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.draft.assumptionBasis).toEqual({ targetCustomers: 'HYPOTHESIS' });
  });

  it('確定KPIと印の無いKPIは「変更不可」の側に、AI仮提案は別の側に入る。画面からのKPI指定は使わない', async () => {
    reply(modelReply);
    await post({ ...deliveryBody, sourceKpis: ['他社の秘密のKPI'] });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    const lockedAt = prompt.indexOf('【既存のKPI（変更不可）】');
    const proposalAt = prompt.indexOf('【以前にAIが仮に置いた目標');
    expect(lockedAt).toBeGreaterThan(-1);
    expect(proposalAt).toBeGreaterThan(lockedAt);
    expect(prompt.indexOf('法人顧客の契約数')).toBeGreaterThan(lockedAt);
    expect(prompt.indexOf('既存配送先の単価')).toBeGreaterThan(lockedAt);
    expect(prompt.indexOf('商談の件数')).toBeGreaterThan(proposalAt);
    expect(prompt).not.toContain('他社の秘密のKPI');
  });

  it('旧来の置き場（okrs[0].keyResults）のKPIも、変更不可の側に入る', async () => {
    tables.strategy_data = [
      {
        ...strategyA,
        departments: [
          {
            name: '物流営業部',
            projects: [{ title: '法人顧客の新規獲得', okrs: [{ keyResults: ['旧来のKPI'] }], okrsV2: [] }],
          },
        ],
      },
    ];
    reply(modelReply);
    await post(deliveryBody);
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt.indexOf('旧来のKPI')).toBeGreaterThan(prompt.indexOf('【既存のKPI（変更不可）】'));
  });

  it('他社の戦略IDを指定すると拒否し、AIを呼ばない。相手の戦略の情報も返さない', async () => {
    const res = await post({ ...deliveryBody, strategyId: 'st-b' });
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain('st-b');
  });

  it('所属していない企業を指定すると拒否し、AIを呼ばない', async () => {
    const res = await post({ ...deliveryBody, companyId: COMPANY_B });
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('他社にしかないプロジェクトは、自社の戦略から見つからず、AIを呼ばない', async () => {
    const res = await post({ ...deliveryBody, projectTitle: '他社だけの案件' });
    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('プロジェクトIDを指定したが、戦略にそのIDのプロジェクトがなければ拒否する', async () => {
    const res = await post({ ...deliveryBody, projectId: 'some-other-project' });
    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('同じ名前のプロジェクトが複数あれば、対象を決めずに拒否する', async () => {
    tables.strategy_data = [
      {
        ...strategyA,
        departments: [
          { name: '物流営業部', projects: [projectA] },
          { name: '別の部門', projects: [projectA] },
        ],
      },
    ];
    const res = await post({ projectTitle: '法人顧客の新規獲得' });
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('権限がない（所属していない・許されていない役割）と拒否し、AIを呼ばない', async () => {
    tables.company_members = [];
    expect((await post(deliveryBody)).status).toBe(403);
    tables.company_members = [{ ...memberOfA, role: 'viewer' }];
    expect((await post(deliveryBody)).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('認証がなければ401。DBも見ず、AIも呼ばない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValueOnce(null);
    const res = await post(deliveryBody);
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('所属を確かめる段階で失敗しても、AIを呼ばず、内部の情報を返さない', async () => {
    failTable = 'company_members';
    const res = await post(deliveryBody);
    expect(res.status).toBe(500);
    expect(mockCreate).not.toHaveBeenCalled();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('db.internal');
    expect(text).not.toContain('secret');
  });
});

describe('STAGE4 実行計画の生成API：エラー時の応答', () => {
  it('AIの呼び出しが失敗しても、内部のメッセージを返さない', async () => {
    mockCreate.mockRejectedValueOnce(new Error('upstream secret token sk-test-123 leaked'));
    const res = await post(deliveryBody);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/secret|sk-test|debugInfo|errorStack/);
  });

  it('AIの出力が読めなくても、詳細は返さない', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json at all' } }] });
    const res = await post(deliveryBody);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('JSON not found');
  });
});

describe('STAGE4 実行計画の生成API：保存処理は呼ばれない', () => {
  it('成功しても、保存（insert/update/upsert/delete）は一度も呼ばれない', async () => {
    reply(modelReply);
    await post(deliveryBody);
    expect(writes).toEqual([]);
  });

  it('拒否された場合も、保存は呼ばれない', async () => {
    await post({ ...deliveryBody, strategyId: 'st-b' });
    expect(writes).toEqual([]);
  });
});

describe('STAGE4 実行計画の生成API：プロンプトの組立（AIは呼ばない）', () => {
  it('会社情報・因果関係・根拠区分の指示を、AIに渡す文面へ入れる', async () => {
    reply(modelReply);
    const res = await post(deliveryBody);
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

  it('法人顧客の依頼に、フィットネス・製造の情報を混ぜない', async () => {
    reply(modelReply);
    await post(deliveryBody);
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain('スポーツ事業部');
    expect(prompt).not.toContain('ものづくり事業部');
  });

  it('フィットネスの依頼：会員・継続課金の算定方式を案内し、会社の実績がない退会率を実績として書かせない', async () => {
    reply(modelReply);
    await post({
      projectTitle: '会員の継続率の改善',
      departmentName: 'スポーツ事業部',
      role: 'REVENUE',
      companyContext: {
        department: { name: 'スポーツ事業部', strategicRole: '会員の継続率を高める', keyIssues: ['退会率の上昇'], interDeptCollab: [], alignmentRisks: [] },
        priorityThemes: [],
      },
    });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('会員・継続課金：既存会員数、新規加入数、退会率・継続率、月額単価（FUNNELに無理に変換しない）');
    expect(prompt).toContain('退会率の上昇');
    expect(prompt).not.toContain('直近の財務実績');
    expect(prompt).toContain('会社の実績が無い数値を、実績らしく書いてはいけません');
  });

  it('AIの返却値：根拠区分の不正な値と型の違う項目を捨て、残りを返す（数値は変えない）', async () => {
    reply(modelReply);
    const res = await post(deliveryBody);
    const json = await res.json();
    expect(json.draft.assumptionBasis).toEqual({ targetCustomers: 'HYPOTHESIS' });
    expect(json.draft.verificationItems).toEqual(['過去12か月の商談数', '受注率']);
    expect(json.draft.causalChain).toMatchObject({ customer: '既存の配送先', verifyNumbers: '過去12か月の商談数' });
    expect(json.draft.impact.assumptions).toEqual({ targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 });
  });
});

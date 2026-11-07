/* 既存行の revision が不明な保存を拒否し、revision が分かる保存・新規作成・従来互換の動作を検証する。
 * Supabase は、書き込みの記録と revision 条件（.eq('revision', n)）の判定だけを行うフェイクで置き換える。 */

export {};

type Row = Record<string, any>;
type Op = { table: string; op: 'select' | 'update' | 'insert'; eqs: Array<[string, unknown]>; payload?: Row };

const mockDb: { row: Row | null; ops: Op[] } = { row: null, ops: [] };
const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = 'a1000000-0000-4000-8000-000000000001';
const OTHER_COMPANY = 'b1000000-0000-4000-8000-000000000002';

function builderFor(op: Op): any {
  const resolve = () => {
    if (op.op === 'update') {
      const cas = op.eqs.find(([col]) => col === 'revision');
      if (!mockDb.row || (cas && cas[1] !== mockDb.row.revision)) return { data: null, error: null };
      const hasRevision = Object.prototype.hasOwnProperty.call(mockDb.row, 'revision');
      mockDb.row = {
        ...mockDb.row,
        ...op.payload,
        ...(hasRevision ? { revision: mockDb.row.revision + 1 } : {}),
      };
      return { data: mockDb.row, error: null };
    }
    if (op.op === 'insert') {
      mockDb.row = { ...op.payload, id: 'S-NEW', revision: 0 };
      return { data: mockDb.row, error: null };
    }
    return { data: mockDb.row, error: null };
  };
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'maybeSingle' || prop === 'single') return async () => resolve();
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(resolve()).then(res, rej);
        if (prop === 'update') {
          return (payload: Row) => {
            op.op = 'update';
            op.payload = payload;
            return builder;
          };
        }
        if (prop === 'insert') {
          return (payload: Row) => {
            op.op = 'insert';
            op.payload = payload;
            return builder;
          };
        }
        if (prop === 'eq') {
          return (col: string, value: unknown) => {
            op.eqs.push([col, value]);
            return builder;
          };
        }
        return () => builder;
      },
    },
  );
  return builder;
}

const fakeSupabase: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const op: Op = { table, op: 'select', eqs: [] };
          mockDb.ops.push(op);
          return builderFor(op);
        };
      }
      if (prop === 'auth') return { getUser: async () => ({ data: { user: { id: USER } }, error: null }) };
      return () => builderFor({ table: '_unused', op: 'select', eqs: [] });
    },
  },
);

jest.mock('@/utils/supabase/client', () => ({
  supabase: fakeSupabase,
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
}));

jest.mock('@/utils/supabase/membership', () => ({
  getMembership: async () => null,
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { saveStrategyData } = require('@/utils/supabase/strategy');
/* eslint-enable @typescript-eslint/no-require-imports */

const payload = (extra: Row = {}): any => ({
  companyName: 'テスト株式会社',
  departments: [{ name: '営業部', projects: [] }],
  ...extra,
});

const writes = () => mockDb.ops.filter((o) => o.op !== 'select');

describe('既存行の revision 不明な保存は、UPDATE せず拒否する', () => {
  beforeEach(() => {
    mockDb.ops = [];
    mockDb.row = { id: 'S-1', company_id: COMPANY, user_id: USER, revision: 5, departments: [] };
  });

  it('revision 列がある既存行で、呼び出し元の revision が不明なら REVISION_UNKNOWN を返し、書き込まない', async () => {
    const result: any = await saveStrategyData(payload(), USER, COMPANY, undefined);

    expect(result.data).toBeNull();
    expect(result.error.code).toBe('REVISION_UNKNOWN');
    expect(writes()).toEqual([]);
    expect(mockDb.row?.revision).toBe(5);
  });

  it('revision の型が数値でない（文字列）場合も拒否する', async () => {
    const result: any = await saveStrategyData(payload(), USER, COMPANY, '5' as unknown as number);

    expect(result.error.code).toBe('REVISION_UNKNOWN');
    expect(writes()).toEqual([]);
  });

  it('拒否時は、STAGE2 の回答（answers2）も strategy_data 以外へは書かない', async () => {
    const answers2 = [{ chapterTitle: '会社の歩み', steps: [{ stepNumber: 1, question: 'q', answer: 'a' }] }];

    const result: any = await saveStrategyData(payload({ answers2 }), USER, COMPANY, undefined);

    expect(result.error.code).toBe('REVISION_UNKNOWN');
    expect(mockDb.ops.every((o) => o.table === 'strategy_data' && o.op === 'select')).toBe(true);
  });

  it('DB の現行 revision を期待値として代用しない（UPDATE の条件に DB 値が入らない）', async () => {
    await saveStrategyData(payload(), USER, COMPANY, undefined);

    expect(writes().some((o) => o.eqs.some(([col, v]) => col === 'revision' && v === 5))).toBe(false);
  });
});

describe('revision が分かる既存行の保存は、従来どおり正常に保存される', () => {
  beforeEach(() => {
    mockDb.ops = [];
    mockDb.row = { id: 'S-1', company_id: COMPANY, user_id: USER, revision: 5, departments: [] };
  });

  it('一致する revision を条件に UPDATE し、revision は 1 進む', async () => {
    const result: any = await saveStrategyData(payload(), USER, COMPANY, 5);

    expect(result.error).toBeNull();
    const update = writes().find((o) => o.op === 'update');
    expect(update?.eqs).toContainEqual(['revision', 5]);
    expect(mockDb.row?.revision).toBe(6);
  });

  it('古い revision（4）は REVISION_CONFLICT で拒否し、DB を変えない（競合検知は従来どおり）', async () => {
    const result: any = await saveStrategyData(payload(), USER, COMPANY, 4);

    expect(result.error.code).toBe('REVISION_CONFLICT');
    expect(mockDb.row?.revision).toBe(5);
  });
});

describe('新規作成は、revision が不明でも従来どおり許可する', () => {
  beforeEach(() => {
    mockDb.ops = [];
    mockDb.row = null;
  });

  it('既存行がなければ revision 不明でも INSERT で作成できる', async () => {
    const result: any = await saveStrategyData(payload(), USER, COMPANY, undefined);

    expect(result.error).toBeNull();
    expect(writes().map((o) => o.op)).toEqual(['insert']);
    expect(mockDb.row?.company_id).toBe(COMPANY);
  });
});

describe('revision 列のない既存行（従来互換）', () => {
  beforeEach(() => {
    mockDb.ops = [];
    mockDb.row = { id: 'S-1', company_id: COMPANY, user_id: USER, departments: [] };
  });

  it('列がない行は、revision 不明でも従来どおり更新する（この経路だけは拒否しない）', async () => {
    const result: any = await saveStrategyData(payload(), USER, COMPANY, undefined);

    expect(result.error).toBeNull();
    const update = writes().find((o) => o.op === 'update');
    expect(update).toBeDefined();
    expect(update?.eqs.some(([col]) => col === 'revision')).toBe(false);
  });
});

describe('企業スコープ（従来どおり）', () => {
  beforeEach(() => {
    mockDb.ops = [];
    mockDb.row = { id: 'S-1', company_id: COMPANY, user_id: USER, revision: 5, departments: [] };
  });

  it('payload の企業IDが保存先と違えば、revision に関係なく書き込まず拒否する', async () => {
    const result: any = await saveStrategyData(payload({ company_id: OTHER_COMPANY }), USER, COMPANY, 5);

    expect(result.error.code).toBe('SAVE_SCOPE_MISMATCH');
    expect(writes()).toEqual([]);
  });
});

describe('戻り値の契約（親の存在判定に使う data の有無）', () => {
  beforeEach(() => {
    mockDb.ops = [];
    mockDb.row = null;
  });

  it('新規作成（INSERT）の成功は data を返す', async () => {
    const result: any = await saveStrategyData(payload(), USER, COMPANY, undefined);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
  });

  it('既存行の更新（UPDATE）の成功は data を返す', async () => {
    mockDb.row = { id: 'S-1', company_id: COMPANY, user_id: USER, revision: 5, departments: [] };

    const result: any = await saveStrategyData(payload(), USER, COMPANY, 5);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
  });

  it('保存がスキップされる内容（最終ストーリーだけ）で行が無い場合は、data null・error 無しを返し、書き込まない', async () => {
    const result: any = await saveStrategyData(
      { finalStory: [{ id: 'c1', title: '最終', body: '本文' }] } as any,
      USER,
      COMPANY,
      undefined,
    );

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(writes()).toEqual([]);
  });
});

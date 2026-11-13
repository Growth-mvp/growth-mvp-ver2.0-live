jest.mock('server-only', () => ({}));

import { findProjectReferences } from './stage3ProjectReferences';

type Row = Record<string, unknown>;

const PROJECT_A = 'p-1';
const PROJECT_B = 'p-2';
const STAGE6_REASON = '業績影響（STAGE6）で使われています';

const departments = () => [
  {
    id: 'd-sales',
    name: '営業部',
    projects: [
      { id: PROJECT_A, projectUid: 'uid-a', title: '既存顧客の再受注施策' },
      { id: PROJECT_B, title: '新規開拓の施策' },
    ],
  },
];

function fakeAdmin(tables: Record<string, Row[]>, failingTables: string[] = []) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const result = () => {
        if (failingTables.includes(table)) return { data: null, error: { code: '500', message: 'simulated' } };
        return { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null };
      };
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          filters.push((r) => r[column] === value);
          return q;
        },
        in(column: string, values: unknown[]) {
          filters.push((r) => values.includes(r[column]));
          return q;
        },
        maybeSingle: async () => {
          const r = result();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const args = { companyId: 'c-1', strategyId: 's-1', projectIds: [PROJECT_A, PROJECT_B] };

const strategyWith = (projectTargetImpacts: Row[]) => ({
  id: 's-1',
  company_id: 'c-1',
  departments: departments(),
  project_target_impacts: projectTargetImpacts,
});

describe('findProjectReferences（削除前の参照確認）', () => {
  it('STAGE6の業績影響（施策のUIDで指す行）から使われている施策は、参照として返す', async () => {
    const admin = fakeAdmin({
      strategy_data: [strategyWith([{ projectId: 'uid-a', targetId: 't-1', delta: 100 }])],
    });
    const result = await findProjectReferences(admin as any, args);
    expect(result).toEqual({ ok: true, references: { [PROJECT_A]: [STAGE6_REASON] } });
  });

  it('旧形式の施策キー（部門名::施策名::添字）の行も、同じ施策の参照として返す', async () => {
    const admin = fakeAdmin({
      strategy_data: [strategyWith([{ projectId: '営業部::新規開拓の施策::1', targetId: 't-1', delta: 50 }])],
    });
    const result = await findProjectReferences(admin as any, args);
    expect(result).toEqual({ ok: true, references: { [PROJECT_B]: [STAGE6_REASON] } });
  });

  it('業績影響が無い施策は、参照として返さない', async () => {
    const admin = fakeAdmin({ strategy_data: [strategyWith([])] });
    const result = await findProjectReferences(admin as any, args);
    expect(result).toEqual({ ok: true, references: {} });
  });

  it('業績影響の照会に失敗したら、参照なしとせず失敗を返す', async () => {
    const admin = fakeAdmin({ strategy_data: [strategyWith([])] }, ['strategy_data']);
    const result = await findProjectReferences(admin as any, args);
    expect(result).toEqual({ ok: false, error: 'reference_check_failed' });
  });
});

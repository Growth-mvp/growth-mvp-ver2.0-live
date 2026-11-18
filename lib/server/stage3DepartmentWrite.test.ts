jest.mock('server-only', () => ({}));

import { writeDepartmentGuarded } from './stage3DepartmentWrite';

const COMPANY = 'c1';
const STRATEGY = 's1';

function fakeAdmin(updateError?: string) {
  const departments = [{ name: '営業部', projects: [{ id: 'p1' }] }];
  const updated = { id: STRATEGY, revision: 4, departments: [{ name: '営業部', projects: [{ id: 'p1', lifecycle: { status: 'EXCLUDED' } }] }] };
  return {
    from(table: string) {
      if (table === 'company_members') {
        const api: any = { select: () => api, eq: () => api, limit: async () => ({ data: [{ role: 'manager' }], error: null }) };
        return api;
      }
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: { id: STRATEGY, company_id: COMPANY, revision: 3, departments }, error: null }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: async () =>
                  updateError ? { data: null, error: { message: updateError } } : { data: [updated], error: null },
              }),
            }),
          }),
        }),
      };
      return api;
    },
  };
}

const args = (admin: unknown) => ({
  admin: admin as any,
  userId: 'u1',
  companyId: COMPANY,
  strategyId: STRATEGY,
  expectedRevision: 3,
  departmentName: '営業部',
  apply: (target: Record<string, unknown>) => ({ ok: true as const, target }),
});

const EXCLUDE = (target: Record<string, unknown>) => ({
  ok: true as const,
  target: { ...target, projects: [{ id: 'p1', lifecycle: { status: 'EXCLUDED' } }] },
});

describe('writeDepartmentGuarded', () => {
  it('書き込みの戻り値から、保存後の版と部門を返す（再読込は不要）', async () => {
    const out = await writeDepartmentGuarded({ ...args(fakeAdmin()), apply: EXCLUDE });
    expect(out).toMatchObject({ ok: true, revision: 4 });
    if (!out.ok) return;
    expect(out.departments[0].projects).toEqual([{ id: 'p1', lifecycle: { status: 'EXCLUDED' } }]);
  });

  it('呼び出し元が読んだ行（同じ版）を使うときは、戦略の再読込をしない', async () => {
    const admin = fakeAdmin();
    const from = admin.from;
    admin.from = (table: string) => {
      const api = from(table);
      if (table === 'strategy_data') {
        api.maybeSingle = async () => {
          throw new Error('strategy_data must not be re-read');
        };
      }
      return api;
    };
    const departments = [{ name: '営業部', projects: [{ id: 'p1' }] }];
    const out = await writeDepartmentGuarded({
      ...args(admin),
      apply: EXCLUDE,
      loaded: { revision: 3, departments },
    });
    expect(out).toMatchObject({ ok: true, revision: 4 });
  });

  it('呼び出し元が読んだ版が期待と違えば、書き込まず版の変更として返す', async () => {
    const out = await writeDepartmentGuarded({
      ...args(fakeAdmin()),
      apply: EXCLUDE,
      loaded: { revision: 2, departments: [] },
    });
    expect(out).toEqual({ ok: false, status: 409, error: 'revision_changed' });
  });

  it('DBが除外・中止の条件違反を返したら、409 と理由を返す', async () => {
    const out = await writeDepartmentGuarded(args(fakeAdmin('stage4_lifecycle_conflict:EXECUTING')));
    expect(out).toEqual({ ok: false, status: 409, error: 'executing' });
  });

  it('それ以外の書き込み失敗は保存失敗として扱う', async () => {
    const out = await writeDepartmentGuarded(args(fakeAdmin('connection reset')));
    expect(out).toEqual({ ok: false, status: 500, error: 'save_failed' });
  });
});

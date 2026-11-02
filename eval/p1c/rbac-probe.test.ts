/* P1-C 権限の読み取り確認（モック）。実 DB には接続しない。DB の返却順はモックの配列順で代用する。 */
jest.mock('server-only', () => ({}));

import { requireMembership, assertMinRole } from '@/lib/server/rbacGuard';

type Row = { user_id: string; company_id: string; role: 'admin' | 'manager' | 'member'; department_id?: string | null };

function fakeAdmin(rows: Row[]) {
  const builder = (filters: Array<[string, string]>, limit?: number) => {
    const applied = () => rows.filter((r) => filters.every(([k, v]) => (r as any)[k] === v));
    const api: any = {
      select: () => api,
      eq: (k: string, v: string) => builder([...filters, [k, v]], limit),
      limit: (n: number) => builder(filters, n),
      maybeSingle: async () => {
        const hit = applied();
        const data = hit.slice(0, limit ?? hit.length)[0] ?? null;
        return { data, error: null };
      },
    };
    return api;
  };
  return { from: () => builder([]) } as any;
}

const USER = 'user-multi';
const MULTI: Row[] = [
  { user_id: USER, company_id: 'company-a', role: 'member' },
  { user_id: USER, company_id: 'company-b', role: 'admin' },
];

describe('会社IDなしの requireMembership（モック）', () => {
  it('会社IDなしでは、DBが最初に返した所属をそのまま使う（並び順は指定されていない）', async () => {
    const m = await requireMembership(fakeAdmin(MULTI), USER);
    expect(m?.companyId).toBe('company-a');
    expect(m?.role).toBe('member');

    const reordered = [...MULTI].reverse();
    const m2 = await requireMembership(fakeAdmin(reordered), USER);
    expect(m2?.companyId).toBe('company-b');
  });

  it('会社IDありでは、その会社の所属だけを返し、他社の権限は使わない', async () => {
    const m = await requireMembership(fakeAdmin(MULTI), USER, 'company-b');
    expect(m).toMatchObject({ companyId: 'company-b', role: 'admin' });
    expect(await requireMembership(fakeAdmin(MULTI), USER, 'company-x')).toBeNull();
  });

  it('所属がなければ null', async () => {
    expect(await requireMembership(fakeAdmin(MULTI), 'stranger')).toBeNull();
  });
});

describe('役割の判定（assertMinRole）', () => {
  const member = { userId: USER, companyId: 'company-a', role: 'member' as const, departmentId: null };
  const manager = { ...member, role: 'manager' as const };

  it('一般社員は manager 以上を要する処理で拒否される', async () => {
    await expect(assertMinRole(member, 'manager')).rejects.toThrow('forbidden');
  });

  it('管理職は manager の処理を通過し、admin の処理は拒否される', async () => {
    await expect(assertMinRole(manager, 'manager')).resolves.toBeUndefined();
    await expect(assertMinRole(manager, 'admin')).rejects.toThrow('forbidden');
  });
});

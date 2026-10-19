/* eslint-disable @typescript-eslint/no-explicit-any -- クライアントモックの型は意図的に緩く定義している */
const mockState: { rows: any[]; cookie: string | null } = { rows: [], cookie: null };

jest.mock('./client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: mockState.rows, error: null }),
      }),
    }),
  },
  isValidUUID: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v),
  setCompanyIdCookie: jest.fn(),
  getCompanyIdFromCookie: () => mockState.cookie,
}));

import { getMembership } from './membership';

const A = 'a1000000-0000-4000-8000-000000000001';
const B = 'b1000000-0000-4000-8000-000000000002';
const C = 'c1000000-0000-4000-8000-000000000003';

describe('getMembership（所属の既定選択）', () => {
  beforeEach(() => {
    mockState.cookie = null;
  });

  it('所属がなければ companyId は null', async () => {
    mockState.rows = [];
    const m = await getMembership('u');
    expect(m).toEqual({ companyId: null, departmentId: null, role: null });
  });

  it('未選択なら作成日時の新しい所属を選ぶ（役割より作成日時を優先）', async () => {
    mockState.rows = [
      { company_id: A, role: 'admin', created_at: '2026-10-17T00:00:00Z' },
      { company_id: B, role: 'member', created_at: '2026-10-18T00:00:00Z' },
    ];
    const m = await getMembership('u');
    expect(m.companyId).toBe(B);
    expect(m.role).toBe('member');
  });

  it('選択中の会社が所属に有効であれば、その会社を優先する', async () => {
    mockState.rows = [
      { company_id: A, role: 'admin', created_at: '2026-10-17T00:00:00Z' },
      { company_id: B, role: 'member', created_at: '2026-10-18T00:00:00Z' },
    ];
    mockState.cookie = A;
    const m = await getMembership('u');
    expect(m.companyId).toBe(A);
    expect(m.role).toBe('admin');
  });

  it('選択中の会社が所属に無ければ、作成日時の新しい所属を選ぶ', async () => {
    mockState.rows = [
      { company_id: A, role: 'admin', created_at: '2026-10-17T00:00:00Z' },
      { company_id: B, role: 'member', created_at: '2026-10-18T00:00:00Z' },
    ];
    mockState.cookie = C;
    const m = await getMembership('u');
    expect(m.companyId).toBe(B);
  });
});

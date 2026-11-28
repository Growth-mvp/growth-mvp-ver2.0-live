export {};
/* AI操作の承認API。認証・所属・操作ごとの役割・戦略の所属の判定を確認する（DB・監査は差し替え） */
jest.mock('server-only', () => ({}));

const mockGetUserId = jest.fn<Promise<string | null>, unknown[]>();
const mockRequireMembership = jest.fn<Promise<{ companyId: string; role: string } | null>, unknown[]>();
const mockAssertScope = jest.fn<Promise<string>, unknown[]>();
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: (...a: unknown[]) => mockGetUserId(...a),
  requireMembership: (...a: unknown[]) => mockRequireMembership(...a),
  assertCompanyScopeByStrategyId: (...a: unknown[]) => mockAssertScope(...a),
  assertMinRole: async (membership: { role: string }, min: 'admin' | 'manager' | 'member') => {
    const w: Record<string, number> = { member: 1, manager: 2, admin: 3 };
    if ((w[membership.role] ?? 0) < (w[min] ?? 0)) throw new Error('forbidden');
  },
}));

const mockAudit = jest.fn<Promise<boolean>, unknown[]>(async () => true);
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: (...a: unknown[]) => mockAudit(...a),
}));

const admin = {
  from: () => ({
    select: () => ({
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { revision: 7 } }) }) }),
    }),
  }),
};
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => admin }));

import { POST } from './route';

const IDS = { companyId: 'c1', strategyId: 's1' };

function request(body: unknown, token: string | null = 'token') {
  return new Request('http://localhost/api/ai-operations/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserId.mockResolvedValue('u1');
  mockRequireMembership.mockResolvedValue({ companyId: 'c1', role: 'admin' });
  mockAssertScope.mockResolvedValue('c1');
});

describe('AI操作の承認API：認証と所属', () => {
  it('ログインしていなければ 401', async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = await POST(request({ ...IDS, operation: 'stage2.ceoIntent' }));
    expect(res.status).toBe(401);
  });

  it('所属していない会社は 403（操作は記録しない）', async () => {
    mockRequireMembership.mockResolvedValue({ companyId: 'other', role: 'admin' });
    const res = await POST(request({ ...IDS, operation: 'stage2.ceoIntent' }));
    expect(res.status).toBe(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('戦略が別の会社のものなら 403', async () => {
    mockAssertScope.mockRejectedValue(new Error('forbidden'));
    const res = await POST(request({ ...IDS, operation: 'stage1.revenue', year: 2025 }));
    expect(res.status).toBe(403);
  });

  it('形式が不正なら 400', async () => {
    const res = await POST(request({ ...IDS, operation: 'unknown.op' }));
    expect(res.status).toBe(400);
  });
});

describe('AI操作の承認API：操作ごとの役割', () => {
  it.each([
    ['member', 'stage2.ceoIntent', 403],
    ['manager', 'stage2.ceoIntent', 403],
    ['admin', 'stage2.ceoIntent', 200],
    ['member', 'stage1.revenue', 403],
    ['manager', 'stage1.revenue', 200],
    ['member', 'stage3.question', 403],
    ['manager', 'stage3.question', 200],
    ['member', 'stage4.plan', 403],
    ['manager', 'stage4.plan', 200],
  ])('役割 %s が %s を承認すると %d', async (role, operation, status) => {
    mockRequireMembership.mockResolvedValue({ companyId: 'c1', role });
    const res = await POST(request({ ...IDS, operation, year: 2025 }));
    expect(res.status).toBe(status);
    if (status === 200) {
      expect(await res.json()).toEqual({ ok: true, revision: 7 });
      expect(mockAudit).toHaveBeenCalledTimes(1);
    } else {
      expect(mockAudit).not.toHaveBeenCalled();
    }
  });
});

describe('AI操作の承認API：経営課題の追加（STAGE1）', () => {
  it('管理職以上は、経営課題の承認を受け付ける（保存はしない・監査に残す）', async () => {
    mockRequireMembership.mockResolvedValue({ companyId: 'c1', role: 'manager' });
    const res = await POST(request({ ...IDS, operation: 'stage1.issue' }));
    expect(res.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'AI_OPERATION_APPROVED', metadata: { operation: 'stage1.issue' } }));
  });

  it('一般の利用者は、経営課題の承認を拒否する（403）', async () => {
    mockRequireMembership.mockResolvedValue({ companyId: 'c1', role: 'member' });
    const res = await POST(request({ ...IDS, operation: 'stage1.issue' }));
    expect(res.status).toBe(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

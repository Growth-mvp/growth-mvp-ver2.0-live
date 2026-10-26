/* eslint-disable @typescript-eslint/no-explicit-any -- モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/lib/server/rbacGuard', () => ({
  ...jest.requireActual('@/lib/server/rbacGuard'),
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));

import { POST } from './route';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';

function req(body: unknown) {
  return new Request('http://localhost/api/generate-question', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any;
}

describe('POST /api/generate-question', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  });

  it('認証なしは 401', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
    const res = await POST(req({ chapterIndex: 0, stepNumber: 1 }));
    expect(res.status).toBe(401);
  });

  it('member 権限は 403 になる（manager 以上が必要）', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'member', departmentId: null });
    const res = await POST(req({ chapterIndex: 0, stepNumber: 1 }));
    expect(res.status).toBe(403);
  });

  it('manager 権限は権限チェックを通過する', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'manager', departmentId: null });
    const res = await POST(req({ chapterIndex: 0, stepNumber: 1 }));
    expect(res.status).not.toBe(403);
  });
});

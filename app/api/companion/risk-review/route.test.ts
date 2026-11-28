const mockGetAuthUserIdFromBearer = jest.fn();
const mockGetSupabaseAdmin = jest.fn(() => ({}));

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => mockGetSupabaseAdmin() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: (...args: unknown[]) => mockGetAuthUserIdFromBearer(...args),
  requireMembership: jest.fn(async () => ({ companyId: 'co-a' })),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/openai', () => ({ openai: { chat: { completions: { create: jest.fn() } } } }));
jest.mock('@/lib/modelConfig', () => ({ getOpenAIModelParamsForProcess: () => ({ model: 'm' }) }));
jest.mock('@/utils/supabase/strategy', () => ({ getFullStrategyDataByStrategyId: jest.fn(async () => ({ data: null, error: null })) }));
jest.mock('@/utils/supabase/normalize', () => ({ normalizeStrategyData: (x: unknown) => x }));
jest.mock('@/lib/cascade/projectLifecycle', () => ({ stage6PlanDepartments: (x: unknown) => x }));
jest.mock('@/lib/companion/companionRiskSource', () => ({ riskInputsOf: () => ({ facts: [], coverage: [] }) }));

import { requireMembership } from '@/lib/server/rbacGuard';
import { getFullStrategyDataByStrategyId } from '@/utils/supabase/strategy';
import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/companion/risk-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });
}

describe('経営点検の停止（自律伴走だけを止める設定）', () => {
  const original = process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED;

  beforeEach(() => {
    mockGetAuthUserIdFromBearer.mockReset();
    mockGetSupabaseAdmin.mockClear();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED;
    else process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED = original;
  });

  it('停止の設定が有効なら、503を返し、データにも認証にも触れない', async () => {
    process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED = 'true';
    const res = await POST(req({ companyId: 'co-a', strategyId: 'st-a' }));
    expect(res.status).toBe(503);
    expect(mockGetSupabaseAdmin).not.toHaveBeenCalled();
    expect(mockGetAuthUserIdFromBearer).not.toHaveBeenCalled();
  });

  it('所属していない会社の戦略は読まず、403を返す（他社の情報を参照しない）', async () => {
    delete process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED;
    mockGetAuthUserIdFromBearer.mockResolvedValue('user-x');
    (requireMembership as unknown as jest.Mock).mockResolvedValueOnce(null);
    const read = getFullStrategyDataByStrategyId as unknown as jest.Mock;
    read.mockClear();
    const res = await POST(req({ companyId: 'co-b', strategyId: 'st-b' }));
    expect(res.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it('戦略は、リクエストで指定された会社の範囲でだけ読む', async () => {
    delete process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED;
    mockGetAuthUserIdFromBearer.mockResolvedValue('user-a');
    const read = getFullStrategyDataByStrategyId as unknown as jest.Mock;
    read.mockClear();
    await POST(req({ companyId: 'co-a', strategyId: 'st-a' }));
    expect(read).toHaveBeenCalledWith('st-a', 'co-a', expect.anything());
  });

  it('停止の設定が無ければ、従来どおり認証を確認する（認証なしは401）', async () => {
    delete process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED;
    mockGetAuthUserIdFromBearer.mockResolvedValue(null);
    const res = await POST(req({ companyId: 'co-a', strategyId: 'st-a' }));
    expect(res.status).toBe(401);
  });
});

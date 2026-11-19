const mockAuthUser = jest.fn();
const mockMembership = jest.fn();
const mockResolveCompany = jest.fn();
const mockAudit = jest.fn(async (_entry: unknown) => true);
const mockAdmin = jest.fn(() => ({}));

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => mockAdmin() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: (...args: unknown[]) => mockAuthUser(...args),
  requireMembership: (...args: unknown[]) => mockMembership(...args),
  assertMinRole: async (m: { role: string }, min: string) => {
    const w: Record<string, number> = { member: 1, manager: 2, admin: 3 };
    if ((w[m.role] ?? 0) < (w[min] ?? 0)) throw new Error('forbidden');
  },
  resolveCompanyIdFromStrategyId: (...args: unknown[]) => mockResolveCompany(...args),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: (entry: unknown) => mockAudit(entry) }));

import { POST } from './route';

const VALID = { companyId: 'co-a', strategyId: 'st-a', secCode: '5905', fromDate: '2026-06-20', toDate: '2026-06-21' };

function req(body: unknown, auth = true) {
  return new Request('http://localhost/api/stage1/autofill/candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer t' } : {}) },
    body: JSON.stringify(body),
  });
}

function edinetOk(results: unknown[]) {
  return jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ results }) })) as unknown as jest.Mock;
}

const ROW = {
  docID: 'S100TEST',
  secCode: '59050',
  edinetCode: 'E00001',
  filerName: '日本製罐株式会社',
  docTypeCode: '120',
  docDescription: '有価証券報告書',
  periodEnd: '2026-03-31',
  withdrawalStatus: '0',
};

describe('上場企業の基本情報の候補取得（PHASE 5A）の入口', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockAuthUser.mockReset().mockResolvedValue('user-1');
    mockMembership.mockReset().mockResolvedValue({ companyId: 'co-a', role: 'admin', departmentId: null, userId: 'user-1' });
    mockResolveCompany.mockReset().mockResolvedValue('co-a');
    mockAudit.mockClear();
    process.env.EDINET_API_KEY = 'test-key';
    delete process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED;
    global.fetch = edinetOk([]) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('停止の設定が有効なら、503。データにも認証にも触れない', async () => {
    process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED = 'true';
    const res = await POST(req(VALID));
    expect(res.status).toBe(503);
    expect(mockAuthUser).not.toHaveBeenCalled();
    expect(mockAdmin).not.toHaveBeenCalled();
  });

  it('認証が無い・無効なら、401', async () => {
    mockAuthUser.mockResolvedValue(null);
    expect((await POST(req(VALID, false))).status).toBe(401);
  });

  it('入力が不正（証券コードの形式、期間）なら、400で外部には問い合わせない', async () => {
    expect((await POST(req({ ...VALID, secCode: '59050' }))).status).toBe(400);
    expect((await POST(req({ ...VALID, fromDate: '2026-01-01', toDate: '2026-03-01' }))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('その会社に所属していなければ、403', async () => {
    mockMembership.mockResolvedValue(null);
    expect((await POST(req(VALID))).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('一般の利用者（member）は、取得できない（403）', async () => {
    mockMembership.mockResolvedValue({ companyId: 'co-a', role: 'member', departmentId: null, userId: 'user-1' });
    const res = await POST(req(VALID));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'insufficient_role' });
  });

  it('戦略が別の会社のものなら、403（企業IDと戦略IDの対応を確認する）', async () => {
    mockResolveCompany.mockResolvedValue('co-b');
    const res = await POST(req(VALID));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'strategy_mismatch' });
  });

  it('公開資料の鍵が未設定なら、503（外部には問い合わせない）', async () => {
    delete process.env.EDINET_API_KEY;
    expect((await POST(req(VALID))).status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('成功：候補を返し、保存はせず、操作を監査ログに残す', async () => {
    global.fetch = edinetOk([ROW]) as unknown as typeof fetch;
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.candidate.fields.ticker.value).toBe('5905');
    expect(json.candidate.fields.fiscalYearEnd.value).toBe('3');
    expect(json.matches[0].docId).toBe('S100TEST');
    expect(json.companyId).toBe('co-a');
    expect(json.strategyId).toBe('st-a');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAGE1_AUTOFILL_CANDIDATES', companyId: 'co-a', actorUserId: 'user-1' }));
  });

  it('該当する書類が無ければ、候補は無いと返す（推測で埋めない）', async () => {
    global.fetch = edinetOk([]) as unknown as typeof fetch;
    const json = await (await POST(req(VALID))).json();
    expect(json.candidate).toBeNull();
    expect(json.matches).toEqual([]);
  });

  it('公開資料の取得が429などで失敗したら、502。再試行はしない（期間の1日目で止める）', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    const res = await POST(req(VALID));
    expect(res.status).toBe(502);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

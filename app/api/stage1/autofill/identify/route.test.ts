import fs from 'node:fs';
import path from 'node:path';
import { CodeListIndex, parseCodeListText } from '@/lib/autofill/edinetCodeList';

jest.mock('server-only', () => ({}));

const mockAuthUser = jest.fn();
const mockMembership = jest.fn();
const mockResolveCompany = jest.fn();
const mockAudit = jest.fn((_entry: unknown) => Promise.resolve(true));
const mockAdmin = jest.fn(() => ({}));
const mockIndex = { current: null as CodeListIndex | null };

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
jest.mock('@/lib/autofill/edinetCodeList', () => {
  const actual = jest.requireActual('@/lib/autofill/edinetCodeList');
  return { ...actual, getCodeListIndex: async () => mockIndex.current };
});

import { POST } from './route';

const FIX = path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'autofill', '__fixtures__', 'edinetcode-subset.csv');

function req(body: unknown, auth = true) {
  return new Request('http://localhost/api/stage1/autofill/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer t' } : {}) },
    body: JSON.stringify(body),
  });
}

const VALID = { companyId: 'co-a', strategyId: 'st-a', text: '日本製罐の基本情報を入力して' };

describe('会社の特定（EDINETコードリスト）の入口', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockAuthUser.mockReset().mockResolvedValue('user-1');
    mockMembership.mockReset().mockResolvedValue({ companyId: 'co-a', role: 'admin', departmentId: null, userId: 'user-1' });
    mockResolveCompany.mockReset().mockResolvedValue('co-a');
    mockAudit.mockClear();
    mockIndex.current = new CodeListIndex(parseCodeListText(fs.readFileSync(FIX, 'utf8')));
    delete process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('停止の設定が有効なら、503（コードリストにも認証にも触れない）', async () => {
    process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED = 'true';
    expect((await POST(req(VALID))).status).toBe(503);
    expect(mockAuthUser).not.toHaveBeenCalled();
  });

  it('認証が無い、所属が無い、一般の利用者は、拒否する', async () => {
    mockAuthUser.mockResolvedValueOnce(null);
    expect((await POST(req(VALID, false))).status).toBe(401);
    mockMembership.mockResolvedValueOnce(null);
    expect((await POST(req(VALID))).status).toBe(403);
    mockMembership.mockResolvedValueOnce({ companyId: 'co-a', role: 'member', departmentId: null, userId: 'user-1' });
    expect((await POST(req(VALID))).status).toBe(403);
  });

  it('戦略が別の会社のものなら、403', async () => {
    mockResolveCompany.mockResolvedValueOnce('co-b');
    expect((await POST(req(VALID))).status).toBe(403);
  });

  it('依頼から会社が読み取れない時は、問い合わせずに入力を求める', async () => {
    const json = await (await POST(req({ ...VALID, text: 'こんにちは' }))).json();
    expect(json.status).toBe('QUERY_UNCLEAR');
  });

  it('会社名で一致（表記ゆれを吸収）したら、一覧の情報と決算期を返す（書類は走査しない）', async () => {
    const json = await (await POST(req({ ...VALID, text: '日本製罐の基本情報を入力して' }))).json();
    expect(json.status).toBe('FOUND');
    expect(json.filer).toMatchObject({ name: '日本製罐株式会社', secCode: '5905', edinetCode: 'E01408', industryName: '金属製品', listed: true });
    expect(json.periods).toHaveLength(3);
    expect(json.periods[0]).toMatch(/^\d{4}-03-31$/);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAGE1_AUTOFILL_IDENTIFY', companyId: 'co-a', targetId: 'E01408' }));
  });

  it('証券コードで一致する（会社名が違っても）', async () => {
    const json = await (await POST(req({ ...VALID, text: '証券コード9743の財務を取り込んで' }))).json();
    expect(json.status).toBe('FOUND');
    expect(json.filer.name).toBe('株式会社丹青社');
    expect(json.periods[0]).toMatch(/^\d{4}-01-31$/);
  });

  it('同じ名前の会社が複数あれば、推測せず候補の一覧を返す', async () => {
    const json = await (await POST(req({ ...VALID, text: '東洋の基本情報を入力して' }))).json();
    expect(json.status).toBe('AMBIGUOUS');
    expect(json.candidates.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(['東洋紡株式会社', '東洋水産株式会社']),
    );
  });

  it('一覧に無い会社は、NOT_FOUND', async () => {
    const json = await (await POST(req({ ...VALID, text: 'ゼッタイナイ株式会社の基本情報を入力して' }))).json();
    expect(json.status).toBe('NOT_FOUND');
  });
});

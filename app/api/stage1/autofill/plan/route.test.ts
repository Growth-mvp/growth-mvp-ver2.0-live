import fs from 'node:fs';
import path from 'node:path';
import { makeZip } from '../../../../../lib/autofill/__fixtures__/makeZip';

const mockAuthUser = jest.fn();
const mockMembership = jest.fn();
const mockResolveCompany = jest.fn();
const mockAudit = jest.fn((_entry: unknown) => Promise.resolve(true));
const mockIdentify = jest.fn();
const mockDownload = jest.fn();
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
jest.mock('@/lib/autofill/edinetIdentify', () => {
  const actual = jest.requireActual('@/lib/autofill/edinetIdentify');
  return { ...actual, identifyCompany: (...args: unknown[]) => mockIdentify(...args) };
});
jest.mock('@/lib/autofill/edinetDocuments', () => {
  const actual = jest.requireActual('@/lib/autofill/edinetDocuments');
  return {
    ...actual,
    listEdinetDocumentsForDate: jest.fn(async () => []),
    downloadEdinetCsvZip: (...args: unknown[]) => mockDownload(...args),
  };
});

import { POST } from './route';

const FIX = path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'autofill', '__fixtures__', 'nisshin-s100yk2j-main-subset.tsv');
const DOC = {
  docId: 'S100YK2J',
  secCode: '59050',
  edinetCode: 'E01408',
  filerName: '日本製罐株式会社',
  docTypeCode: '120',
  docDescription: '有価証券報告書',
  periodStart: '2025-04-01',
  periodEnd: '2026-03-31',
  submitDate: '2026-06-25 11:11',
  withdrawn: false,
};

function req(body: unknown, auth = true) {
  return new Request('http://localhost/api/stage1/autofill/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer t' } : {}) },
    body: JSON.stringify(body),
  });
}

const VALID = { companyId: 'co-a', strategyId: 'st-a', text: '日本製罐の基本情報を入力して' };

describe('AI経営コンサルタントからの依頼（公開資料の候補）の入口', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockAuthUser.mockReset().mockResolvedValue('user-1');
    mockMembership.mockReset().mockResolvedValue({ companyId: 'co-a', role: 'admin', departmentId: null, userId: 'user-1' });
    mockResolveCompany.mockReset().mockResolvedValue('co-a');
    mockIdentify.mockReset();
    mockDownload.mockReset();
    mockAudit.mockClear();
    process.env.EDINET_API_KEY = 'test-key';
    delete process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('停止の設定が有効なら、503。データにも認証にも触れない', async () => {
    process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED = 'true';
    expect((await POST(req(VALID))).status).toBe(503);
    expect(mockAuthUser).not.toHaveBeenCalled();
    expect(mockIdentify).not.toHaveBeenCalled();
  });

  it('認証が無い・無効なら、401', async () => {
    mockAuthUser.mockResolvedValue(null);
    expect((await POST(req(VALID, false))).status).toBe(401);
  });

  it('入力が不正なら、400', async () => {
    expect((await POST(req({ ...VALID, text: 123 }))).status).toBe(400);
    expect((await POST(req({ companyId: 'co-a', text: 'x' }))).status).toBe(400);
  });

  it('その会社に所属していない、または一般の利用者は、403（公開資料には問い合わせない）', async () => {
    mockMembership.mockResolvedValue(null);
    expect((await POST(req(VALID))).status).toBe(403);
    mockMembership.mockResolvedValue({ companyId: 'co-a', role: 'member', departmentId: null, userId: 'user-1' });
    const res = await POST(req(VALID));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'insufficient_role' });
    expect(mockIdentify).not.toHaveBeenCalled();
  });

  it('戦略が別の会社のものなら、403', async () => {
    mockResolveCompany.mockResolvedValue('co-b');
    expect((await POST(req(VALID))).status).toBe(403);
  });

  it('依頼から会社が読み取れない時は、問い合わせずに、入力を求める', async () => {
    const json = await (await POST(req({ ...VALID, text: 'こんにちは' }))).json();
    expect(json.status).toBe('QUERY_UNCLEAR');
    expect(mockIdentify).not.toHaveBeenCalled();
  });

  it('公開資料の鍵が未設定なら、503（問い合わせない）', async () => {
    delete process.env.EDINET_API_KEY;
    expect((await POST(req(VALID))).status).toBe(503);
    expect(mockIdentify).not.toHaveBeenCalled();
  });

  it('会社が見つからない・曖昧・上限到達は、その状態を返す（推測で決めない）', async () => {
    mockIdentify.mockResolvedValue({ status: 'AMBIGUOUS', candidates: [{ name: 'A社', secCode: '1111', edinetCode: 'E1' }], scannedDays: 22 });
    const json = await (await POST(req(VALID))).json();
    expect(json.status).toBe('AMBIGUOUS');
    expect(json.candidates).toHaveLength(1);
    mockIdentify.mockResolvedValue({ status: 'BUDGET_EXCEEDED', scannedDays: 150 });
    expect((await (await POST(req(VALID))).json()).status).toBe('BUDGET_EXCEEDED');
  });

  it('見つかった有価証券報告書の構造化データ（CSV）から、出典つきの候補を作り、操作を監査に残す', async () => {
    mockIdentify.mockResolvedValue({ status: 'FOUND', filer: { name: DOC.filerName, secCode: '5905', edinetCode: 'E01408' }, annualReport: DOC, amendments: [], scannedDays: 54 });
    const csv = fs.readFileSync(FIX, 'utf8');
    mockDownload.mockResolvedValue(makeZip([{ name: 'XBRL_TO_CSV/jpcrp030000-asr-001_E01408-000_2026-03-31_01_2026-06-25.csv', data: Buffer.from(csv.replace(/\n/g, '\r\n'), 'utf8') }]));
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('FOUND');
    expect(json.candidate.docId).toBe('S100YK2J');
    expect(json.candidate.finance.find((y: { year: number }) => y.year === 2026).revenue.value).toBe(11442246000);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAGE1_AUTOFILL_PLAN', companyId: 'co-a', actorUserId: 'user-1', targetId: 'S100YK2J' }));
  });

  it('訂正報告書があれば、その値を採用し、元の書類との関係を示す', async () => {
    const amend = { ...DOC, docId: 'S100AMND', docTypeCode: '130', submitDate: '2026-07-02 10:00' };
    mockIdentify.mockResolvedValue({ status: 'FOUND', filer: { name: DOC.filerName, secCode: '5905', edinetCode: 'E01408' }, annualReport: DOC, amendments: [amend], scannedDays: 60 });
    mockDownload.mockResolvedValue(makeZip([{ name: 'XBRL_TO_CSV/jpcrp030000-asr-001.csv', data: Buffer.from(fs.readFileSync(FIX, 'utf8'), 'utf8') }]));
    const json = await (await POST(req(VALID))).json();
    expect(mockDownload).toHaveBeenCalledWith('S100AMND', 'test-key');
    expect(json.candidate.docId).toBe('S100AMND');
    expect(json.candidate.amendedFromDocId).toBe('S100YK2J');
  });

  it('公開資料の取得に失敗したら、502（再試行しない）', async () => {
    mockIdentify.mockResolvedValue({ status: 'FOUND', filer: { name: DOC.filerName, secCode: '5905', edinetCode: 'E01408' }, annualReport: DOC, amendments: [], scannedDays: 3 });
    const { EdinetHttpError } = jest.requireActual('@/lib/autofill/edinetDocuments');
    mockDownload.mockRejectedValue(new EdinetHttpError(429));
    const res = await POST(req(VALID));
    expect(res.status).toBe(502);
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });
});

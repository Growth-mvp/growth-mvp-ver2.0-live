import fs from 'node:fs';
import path from 'node:path';
import { makeZip } from '../../../../../lib/autofill/__fixtures__/makeZip';

jest.mock('server-only', () => ({}));

const mockAuthUser = jest.fn();
const mockMembership = jest.fn();
const mockResolveCompany = jest.fn();
const mockListDocs = jest.fn();
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
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/autofill/edinetDocuments', () => {
  const actual = jest.requireActual('@/lib/autofill/edinetDocuments');
  return {
    ...actual,
    listAnnualDocsForDate: (...args: unknown[]) => mockListDocs(...args),
    downloadEdinetCsvZip: (...args: unknown[]) => mockDownload(...args),
  };
});

import { POST } from './route';

const FIX = path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'autofill', '__fixtures__', 'nisshin-s100yk2j-main-subset.tsv');
const ANNUAL = {
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
  return new Request('http://localhost/api/stage1/autofill/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer t' } : {}) },
    body: JSON.stringify(body),
  });
}

const VALID = { companyId: 'co-a', strategyId: 'st-a', edinetCode: 'E01408', periodEnd: '2026-03-31' };

describe('決算期ごとの有価証券報告書の入口', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockAuthUser.mockReset().mockResolvedValue('user-1');
    mockMembership.mockReset().mockResolvedValue({ companyId: 'co-a', role: 'admin', departmentId: null, userId: 'user-1' });
    mockResolveCompany.mockReset().mockResolvedValue('co-a');
    mockListDocs.mockReset().mockResolvedValue([]);
    mockDownload.mockReset();
    process.env.EDINET_API_KEY = 'test-key';
    delete process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('停止の設定が有効なら、503（書類にも問い合わせない）', async () => {
    process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED = 'true';
    expect((await POST(req(VALID))).status).toBe(503);
    expect(mockListDocs).not.toHaveBeenCalled();
  });

  it('認証・役割・戦略と会社の対応を、確認する（一般の利用者は不可）', async () => {
    mockAuthUser.mockResolvedValueOnce(null);
    expect((await POST(req(VALID, false))).status).toBe(401);
    mockMembership.mockResolvedValueOnce({ companyId: 'co-a', role: 'member', departmentId: null, userId: 'user-1' });
    expect((await POST(req(VALID))).status).toBe(403);
    mockResolveCompany.mockResolvedValueOnce('co-b');
    expect((await POST(req(VALID))).status).toBe(403);
    expect(mockListDocs).not.toHaveBeenCalled();
  });

  it('入力が不正（企業コードの形式、期の日付）なら、400', async () => {
    expect((await POST(req({ ...VALID, edinetCode: 'X1' }))).status).toBe(400);
    expect((await POST(req({ ...VALID, periodEnd: '2026/03/31' }))).status).toBe(400);
  });

  it('鍵が未設定なら、503', async () => {
    delete process.env.EDINET_API_KEY;
    expect((await POST(req(VALID))).status).toBe(503);
  });

  it('有価証券報告書が見つかれば、構造化データから企業情報・財務・セグメントを取り出して返す（1回の取得）', async () => {
    mockListDocs.mockImplementation(async (day: string) => (day === '2026-06-25' ? [ANNUAL] : []));
    const csv = fs.readFileSync(FIX, 'utf8');
    mockDownload.mockResolvedValue(makeZip([{ name: 'XBRL_TO_CSV/jpcrp030000-asr-001.csv', data: Buffer.from(csv, 'utf8') }]));
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('FOUND');
    expect(json.report.docId).toBe('S100YK2J');
    expect(json.report.facts.companyName).toBe('日本製罐株式会社');
    expect(json.report.facts.pl.find((p: { year: number }) => p.year === 2026).revenue).toBe(11442246000);
    expect(json.report.segments.items).toHaveLength(2);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith('S100YK2J', 'test-key');
  });

  it('訂正報告書があれば、その構造化データを採用し、元の書類を示す', async () => {
    const amend = { ...ANNUAL, docId: 'S100AMND', docTypeCode: '130', submitDate: '2026-07-02 10:00' };
    mockListDocs.mockImplementation(async (day: string) => (day === '2026-07-02' ? [amend] : day === '2026-06-25' ? [ANNUAL] : []));
    mockDownload.mockResolvedValue(makeZip([{ name: 'XBRL_TO_CSV/jpcrp030000-asr-001.csv', data: Buffer.from(fs.readFileSync(FIX, 'utf8'), 'utf8') }]));
    const json = await (await POST(req(VALID))).json();
    expect(json.report.docId).toBe('S100AMND');
    expect(json.report.amendedFromDocId).toBe('S100YK2J');
    expect(mockDownload).toHaveBeenCalledWith('S100AMND', 'test-key');
  });

  it('見つからなければ NOT_FOUND（取得はしない）', async () => {
    const json = await (await POST(req(VALID))).json();
    expect(json.status).toBe('NOT_FOUND');
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('書類の取得に失敗したら、502（再試行しない）', async () => {
    mockListDocs.mockImplementation(async (day: string) => (day === '2026-06-25' ? [ANNUAL] : []));
    const { EdinetHttpError } = jest.requireActual('@/lib/autofill/edinetDocuments');
    mockDownload.mockRejectedValue(new EdinetHttpError(429));
    const res = await POST(req(VALID));
    expect(res.status).toBe(502);
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });
});

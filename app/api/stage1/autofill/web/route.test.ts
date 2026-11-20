jest.mock('server-only', () => ({}));

const mockAuthorize = jest.fn();
const mockSearch = jest.fn();
const mockAudit = jest.fn((_entry: unknown) => Promise.resolve(true));

jest.mock('@/lib/autofill/serverGuard', () => ({
  authorizeAutofill: (...args: unknown[]) => mockAuthorize(...args),
  isId: (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100,
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: (entry: unknown) => mockAudit(entry) }));
jest.mock('@/lib/autofill/publicSearch', () => ({
  searchPublicCompanyProfile: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({})) }));

const { POST } = require('./route') as typeof import('./route');

const OK_AUTH = { ok: true, auth: { userId: 'u1', companyId: 'c1', strategyId: 's1' } };
const COMPANY_FACT = { text: '会社名: 株式会社サンプル', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] };

function post(body: unknown) {
  return POST(new Request('http://localhost/api/stage1/autofill/web', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
}

const VALID = { companyId: 'c1', strategyId: 's1', name: '株式会社サンプル' };

describe('POST /api/stage1/autofill/web', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    mockAuthorize.mockResolvedValue(OK_AUTH);
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  it('入力が不正な時は検索しない', async () => {
    const res = await post({ ...VALID, name: 'a' });
    expect(res.status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('認可に失敗した時は、その応答をそのまま返し、検索しない', async () => {
    const { NextResponse } = require('next/server') as typeof import('next/server');
    mockAuthorize.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) });
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('APIキーが無い時は、検索せず 503 を返す', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await post(VALID);
    expect(res.status).toBe(503);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('出典つきの会社名が一致すれば候補を返し、監査ログを残す（内容は残さない）', async () => {
    mockSearch.mockResolvedValue({ status: 'completed', facts: [COMPANY_FACT], confirmedOn: '2026-11-20' });
    const res = await post(VALID);
    const json = await res.json();
    expect(json.status).toBe('FOUND');
    expect(json.candidate.origin).toBe('WEB');
    expect(json.candidate.profile.fields.companyName.value).toBe('株式会社サンプル');
    expect(json.candidate.profile.fields.companyName.source).toMatchObject({ url: 'https://sample.co.jp/company', confirmedOn: '2026-11-20' });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c1', actorUserId: 'u1', action: 'STAGE1_AUTOFILL_WEB', metadata: { searchStatus: 'completed', factCount: 1 } }),
    );
  });

  it('会社名が依頼と違う時は候補を作らない', async () => {
    mockSearch.mockResolvedValue({ status: 'completed', facts: [{ ...COMPANY_FACT, text: '会社名: 別の株式会社' }], confirmedOn: '2026-11-20' });
    const json = await (await post(VALID)).json();
    expect(json.status).toBe('NOT_CONFIRMED');
    expect(json.candidate).toBeUndefined();
  });

  it('検索の結果が無い・失敗・タイムアウトは、その状態を返す', async () => {
    mockSearch.mockResolvedValue({ status: 'no_results', facts: [], confirmedOn: '2026-11-20' });
    expect((await (await post(VALID)).json()).status).toBe('NOT_FOUND');
    mockSearch.mockResolvedValue({ status: 'failed', facts: [], confirmedOn: '2026-11-20' });
    expect((await (await post(VALID)).json()).status).toBe('SEARCH_FAILED');
    mockSearch.mockResolvedValue({ status: 'timeout', facts: [], confirmedOn: '2026-11-20' });
    expect((await (await post(VALID)).json()).status).toBe('SEARCH_TIMEOUT');
  });
});

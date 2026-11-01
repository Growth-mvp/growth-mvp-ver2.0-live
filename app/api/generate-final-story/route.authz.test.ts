import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  assertMinRole: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/utils/supabase', () => ({
  saveFinalStory: jest.fn(async () => ({ ok: true, error: null })),
}));
jest.mock('@/lib/modelConfig', () => ({
  getOpenAIModelParamsForProcess: () => ({ model: 'test-model' }),
}));
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } };
  },
}));

import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { saveFinalStory } from '@/utils/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: (req: NextRequest) => Promise<Response>;
beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  // route は読み込み時に OPENAI_API_KEY を検査するため、設定後に読み込む
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  POST = require('./route').POST;
});

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const COMPANY_OTHER = '33333333-3333-4333-8333-333333333333';

/** ユーザーの所属会社を差し替える（requireMembership のモック挙動も合わせる） */
function setMemberships(companies: string[]) {
  (requireMembership as jest.Mock).mockImplementation(
    async (_admin: unknown, _userId: string, companyId?: string) => {
      if (companyId === undefined) {
        return companies.length
          ? { companyId: companies[0], role: 'admin', userId: USER, departmentId: null }
          : null;
      }
      return companies.includes(companyId)
        ? { companyId, role: 'admin', userId: USER, departmentId: null }
        : null;
    },
  );
}

function makeReq(body: Record<string, unknown>, cookie?: string) {
  return new NextRequest('http://localhost/api/generate-final-story', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer t',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      industry: '製造業',
      revenue: 100,
      employees: 50,
      mvv: { thought: '思い', mission: 'ミッション', vision: 'ビジョン', value: '価値' },
      swot: { strength: '強み', weakness: '弱み', opportunity: '機会', threat: '脅威' },
      ...body,
    }),
  });
}

describe('generate-final-story: 書き込み先会社の認可', () => {
  beforeEach(() => {
    jest.clearAllMocks(); // テスト間の呼び出し履歴を持ち越さない
    process.env.OPENAI_API_KEY = 'test-key';
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    setMemberships([COMPANY_A]);
    (saveFinalStory as jest.Mock).mockClear();
    // OpenAI 失敗 → ヒューリスティックへフォールバックして保存段階まで進める
    mockCreate.mockReset();
    mockCreate.mockRejectedValue(new Error('offline (test)'));
  });

  it('(a) 所属していない companyId を指定すると 403 になり、生成も保存も行わない', async () => {
    setMemberships([COMPANY_A]);
    const res = await POST(makeReq({ companyId: COMPANY_OTHER }));

    expect(res.status).toBe(403);
    expect(saveFinalStory).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(requireMembership).toHaveBeenCalledWith(expect.anything(), USER, COMPANY_OTHER);
  });

  it('(b) 所属している companyId を指定すると、その会社へ書き込まれ Cookie は書き換えない', async () => {
    setMemberships([COMPANY_A, COMPANY_B]);
    const res = await POST(makeReq({ companyId: COMPANY_B }));

    expect(res.status).toBe(200);
    expect(saveFinalStory).toHaveBeenCalledTimes(1);
    expect(saveFinalStory).toHaveBeenCalledWith(
      USER,
      expect.any(Array),
      { companyId: COMPANY_B, writeCookie: false },
    );
  });

  it('(c) companyId 未指定は、所属数に関係なく 400 になり、LLM も保存も呼ばない', async () => {
    setMemberships([COMPANY_A, COMPANY_B]);
    const res = await POST(makeReq({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(String(json.error)).toContain('companyId');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(saveFinalStory).not.toHaveBeenCalled();
  });

  it('(d) body の companyId と Cookie の company_id が食い違う場合、body を検証して採用し Cookie では置き換えない', async () => {
    setMemberships([COMPANY_A, COMPANY_B]);
    const res = await POST(makeReq({ companyId: COMPANY_B }, `company_id=${COMPANY_A}`));

    expect(res.status).toBe(200);
    expect(requireMembership).toHaveBeenCalledWith(expect.anything(), USER, COMPANY_B);
    expect(requireMembership).not.toHaveBeenCalledWith(expect.anything(), USER, COMPANY_A);
    expect(saveFinalStory).toHaveBeenCalledWith(
      USER,
      expect.any(Array),
      { companyId: COMPANY_B, writeCookie: false },
    );
  });

  it('(d-2) Cookie に所属外の会社が入っていても、body の所属確認済み companyId で保存する', async () => {
    setMemberships([COMPANY_A]);
    const res = await POST(makeReq({ companyId: COMPANY_A }, `company_id=${COMPANY_OTHER}`));

    expect(res.status).toBe(200);
    expect(saveFinalStory).toHaveBeenCalledWith(
      USER,
      expect.any(Array),
      { companyId: COMPANY_A, writeCookie: false },
    );
  });

  it('(e) 正常系: 所属会社の companyId を指定すると 200 で finalStory が返り、保存される', async () => {
    setMemberships([COMPANY_A]);
    const res = await POST(makeReq({ companyId: COMPANY_A }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json.finalStory)).toBe(true);
    expect(saveFinalStory).toHaveBeenCalledWith(
      USER,
      expect.any(Array),
      { companyId: COMPANY_A, writeCookie: false },
    );
  });

  it('不正な形式の companyId は 400 になり、所属確認も保存も行わない', async () => {
    const res = await POST(makeReq({ companyId: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    expect(requireMembership).not.toHaveBeenCalledWith(expect.anything(), USER, 'not-a-uuid');
    expect(saveFinalStory).not.toHaveBeenCalled();
  });
});

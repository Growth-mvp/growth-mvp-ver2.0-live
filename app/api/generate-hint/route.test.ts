/* eslint-disable @typescript-eslint/no-explicit-any -- モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/lib/server/rbacGuard', () => ({
  ...jest.requireActual('@/lib/server/rbacGuard'),
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
}));

import { POST } from './route';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { openai } from '@/lib/openai';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';

function req(body: unknown) {
  return new Request('http://localhost/api/generate-hint', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any;
}

describe('POST /api/generate-hint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ hints: ['ヒント1', 'ヒント2', 'ヒント3'] }) } }],
    });
  });

  it('認証なしは 401 で、AI を呼ばない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
    const res = await POST(req({ question: 'Q' }));
    expect(res.status).toBe(401);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('所属していない場合は 403 で、AI を呼ばない', async () => {
    (requireMembership as jest.Mock).mockResolvedValue(null);
    const res = await POST(req({ question: 'Q' }));
    expect(res.status).toBe(403);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('member 権限は 403 で、AI を呼ばない（manager 以上が必要）', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'member', departmentId: null });
    const res = await POST(req({ question: 'Q' }));
    expect(res.status).toBe(403);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('manager 権限は従来どおりヒントを返す', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'manager', departmentId: null });
    const res = await POST(req({ question: 'Q' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.hints).toEqual(['ヒント1', 'ヒント2', 'ヒント3']);
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});

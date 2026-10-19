import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/inputGuardLogger', () => ({
  checkSuspiciousKeywords: () => ({ autoMotive: false, exhaust: false, ceramic: false, oem: false }),
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

import { POST } from './route';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createFakeDb } from '@/lib/plans/testing/fakeSupabase';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ADMIN = '99999999-9999-4999-8999-999999999999';
const USER_MEMBER = '88888888-8888-4888-8888-888888888888';

const LONG_TEXT = [
  '第1章 経営課題の分析',
  '本文'.repeat(60),
  '第2章 改善戦略',
  '本文'.repeat(60),
].join('\n');

function makeRequest(body: unknown, withAuth = true) {
  return new NextRequest('http://localhost/api/plans/bank/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { authorization: 'Bearer test-token' } : {}),
    },
    body: JSON.stringify(body),
  });
}

const context = (audience = 'bank') => ({ params: Promise.resolve({ audience }) });

const validBody = { companyId: COMPANY_A, strategyId: STRATEGY_A };

function openAiReply(text: string = LONG_TEXT) {
  return {
    model: 'test-model',
    choices: [{ finish_reason: 'stop', message: { content: text } }],
    usage: { completion_tokens: 50, prompt_tokens: 10 },
  };
}

let db: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  db = createFakeDb({
    strategy_data: [
      {
        id: STRATEGY_A,
        company_id: COMPANY_A,
        company_name: 'テスト株式会社',
        departments: [],
        final_story: [],
      },
    ],
  });
  (getSupabaseAdmin as jest.Mock).mockReturnValue(db.client);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_ADMIN);
  (requireMembership as jest.Mock).mockResolvedValue({
    userId: USER_ADMIN,
    companyId: COMPANY_A,
    role: 'admin',
    departmentId: null,
  });
  mockCreate.mockResolvedValue(openAiReply());
});

describe('POST /api/plans/[audience]/generate', () => {
  it('generates and saves for an admin, returning status saved', async () => {
    const res = await POST(makeRequest(validBody), context());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('saved');
    expect(json.version).toBe(1);
    expect(json.generatedText).toBe(LONG_TEXT);
    expect(Array.isArray(json.sections)).toBe(true);
    expect(typeof json.generatedAt).toBe('string');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(db.rows.generated_plans).toHaveLength(1);
    expect(db.rows.generated_plans[0]).toEqual(
      expect.objectContaining({ company_id: COMPANY_A, strategy_id: STRATEGY_A, audience: 'bank', created_by: USER_ADMIN })
    );
  });

  it('allows a manager to generate', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({
      userId: USER_ADMIN,
      companyId: COMPANY_A,
      role: 'manager',
      departmentId: null,
    });

    const res = await POST(makeRequest(validBody), context());

    expect((await res.json()).status).toBe('saved');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects a member before any AI call or database write', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({
      userId: USER_MEMBER,
      companyId: COMPANY_A,
      role: 'member',
      departmentId: null,
    });

    const res = await POST(makeRequest(validBody), context());

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(db.rows.generated_plans).toHaveLength(0);
  });

  it('rejects a user who does not belong to the company', async () => {
    (requireMembership as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeRequest(validBody), context());

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a strategyId that belongs to another company (member of company A requesting company B)', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({
      userId: USER_ADMIN,
      companyId: COMPANY_B,
      role: 'admin',
      departmentId: null,
    });

    const res = await POST(makeRequest({ companyId: COMPANY_B, strategyId: STRATEGY_A }), context());

    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(db.rows.generated_plans).toHaveLength(0);
  });

  it('rejects an unauthenticated request', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeRequest(validBody, false), context());

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid strategyId', async () => {
    const res = await POST(makeRequest({ companyId: COMPANY_A, strategyId: 'not-a-uuid' }), context());

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('ignores client-supplied plan text and saves only the AI output', async () => {
    const res = await POST(
      makeRequest({ ...validBody, generatedText: '任意の本文（改ざん）', sections: ['改ざん'] }),
      context()
    );
    const json = await res.json();

    expect(json.generatedText).toBe(LONG_TEXT);
    expect(db.rows.generated_plans[0].generated_text).toBe(LONG_TEXT);
  });

  it('retries once after a transient save failure and reports saved', async () => {
    db.failures.push({ table: 'generated_plans', op: 'insert', times: 1, error: { message: 'timeout' } });

    const res = await POST(makeRequest(validBody), context());
    const json = await res.json();

    expect(json.status).toBe('saved');
    expect(db.rows.generated_plans).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns the generated text as unsaved when saving keeps failing, without regenerating', async () => {
    db.failures.push({ table: 'generated_plans', op: 'insert', times: 10, error: { message: 'db down' } });

    const res = await POST(makeRequest(validBody), context());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('unsaved');
    expect(json.saveReason).toBe('error');
    expect(json.version).toBeNull();
    expect(json.generatedText).toBe(LONG_TEXT);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(db.rows.generated_plans).toHaveLength(0);
  });

  it('regenerates and overwrites the existing plan with a new version', async () => {
    const first = await POST(makeRequest(validBody), context());
    expect((await first.json()).version).toBe(1);

    mockCreate.mockResolvedValue(openAiReply(LONG_TEXT.replace('改善戦略', '改善戦略（改訂）')));
    const second = await POST(makeRequest(validBody), context());
    const json = await second.json();

    expect(json.status).toBe('saved');
    expect(json.version).toBe(2);
    expect(db.rows.generated_plans).toHaveLength(1);
    expect(db.rows.generated_plans[0].generated_text).toContain('改善戦略（改訂）');
  });

  it('keeps bank and shareholder plans separate', async () => {
    await POST(makeRequest(validBody), context('bank'));
    await POST(makeRequest(validBody), context('shareholder'));

    expect(db.rows.generated_plans).toHaveLength(2);
    expect(db.rows.generated_plans.map((r) => r.audience).sort()).toEqual(['bank', 'shareholder']);
  });
});

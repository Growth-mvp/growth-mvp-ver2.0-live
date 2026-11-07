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

import { POST, maxDuration } from './route';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { logAuditEvent } from '@/lib/server/auditLog';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_DEADLINE_MS, PLAN_POST_AI_RESERVE_MS, PLAN_ATTEMPT_SAFETY_MS } from '@/lib/plans/generationBudget';
import { createFakeDb, planRow } from '@/lib/plans/testing/fakeSupabase';

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
    expect(json.generatedText).toContain(LONG_TEXT);
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

    expect(json.generatedText).toContain(LONG_TEXT);
    expect(db.rows.generated_plans[0].generated_text).toContain(LONG_TEXT);
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
    expect(json.generatedText).toContain(LONG_TEXT);
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

function providerError(name: string, status?: number) {
  return Object.assign(new Error(name), { name, status });
}

function existingPlan(audience: string) {
  return planRow({
    company_id: COMPANY_A,
    strategy_id: STRATEGY_A,
    audience,
    generated_text: '既存の本文',
    sections: ['既存'],
    generated_at: '2026-01-01T00:00:00.000Z',
    created_by: USER_ADMIN,
    updated_by: USER_ADMIN,
    version: 3,
  });
}

describe.each(['bank', 'shareholder', 'employee'] as const)('time budget for audience %s', (audience) => {
  it('saves the generated plan with a per-attempt timeout and no SDK retries', async () => {
    const res = await POST(makeRequest(validBody), context(audience));
    const json = await res.json();

    expect(json).toEqual(expect.objectContaining({ status: 'saved', version: 1, audience }));
    expect(db.rows.generated_plans).toEqual([expect.objectContaining({ audience, generated_text: expect.stringContaining(LONG_TEXT) })]);
    const options = mockCreate.mock.calls[0][1];
    expect(options.maxRetries).toBe(0);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(PLAN_DEADLINE_MS - PLAN_POST_AI_RESERVE_MS - PLAN_ATTEMPT_SAFETY_MS);
  });

  it('returns a JSON timeout error and keeps the existing plan when the attempt times out', async () => {
    db.rows.generated_plans.push(existingPlan(audience));
    mockCreate.mockRejectedValue(providerError('APIConnectionTimeoutError'));

    const res = await POST(makeRequest(validBody), context(audience));
    const json = await res.json();

    expect(res.status).toBe(504);
    expect(json.code).toBe('GENERATION_TIMEOUT');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(db.rows.generated_plans).toEqual([
      expect.objectContaining({ generated_text: '既存の本文', sections: ['既存'], version: 3 }),
    ]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_GENERATE_FAILED' }));
  });

  it('retries once after a transient provider error and saves the retried result', async () => {
    mockCreate
      .mockRejectedValueOnce(providerError('RateLimitError', 429))
      .mockResolvedValueOnce(openAiReply());

    const res = await POST(makeRequest(validBody), context(audience));

    expect((await res.json()).status).toBe('saved');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(db.rows.generated_plans).toEqual([expect.objectContaining({ audience, generated_text: expect.stringContaining(LONG_TEXT) })]);
  });

  it('does not retry a non-transient provider error and keeps the existing plan', async () => {
    db.rows.generated_plans.push(existingPlan(audience));
    mockCreate.mockRejectedValue(providerError('BadRequestError', 400));

    const res = await POST(makeRequest(validBody), context(audience));

    expect(res.status).toBe(500);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(db.rows.generated_plans).toEqual([expect.objectContaining({ generated_text: '既存の本文', version: 3 })]);
  });
});

describe('time budget declaration and timing log', () => {
  it('declares a 120 second max duration equal to the time budget', () => {
    expect(maxDuration).toBe(120);
    expect(PLAN_DEADLINE_MS).toBe(maxDuration * 1000);
  });

  it('logs phase timings without plan text, prompt, or identifiers', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await POST(makeRequest(validBody), context('bank'));

      const line = infoSpy.mock.calls.find((call) => call[0] === '[Plan Gen timing]');
      expect(line).toBeDefined();
      const serialized = String(line![1]);
      expect(JSON.parse(serialized)).toEqual({
        audience: 'bank',
        outcome: 'saved',
        totalMs: expect.any(Number),
        phases: {
          auth: expect.any(Number),
          db: expect.any(Number),
          build: expect.any(Number),
          prompt: expect.any(Number),
          llm: expect.any(Number),
          save: expect.any(Number),
        },
      });
      for (const secret of [LONG_TEXT, 'テスト株式会社', COMPANY_A, STRATEGY_A, USER_ADMIN, 'test-token']) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      infoSpy.mockRestore();
    }
  });
});

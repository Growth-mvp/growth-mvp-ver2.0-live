/* eslint-disable @typescript-eslint/no-explicit-any -- 外部モジュールの mock 用 */
jest.mock('server-only', () => ({}));

const mockOpenAiConstructed = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    constructor(opts: unknown) {
      mockOpenAiConstructed(opts);
    }
  },
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => 'user-admin'),
  requireMembership: jest.fn(async () => ({ userId: 'user-admin', companyId: 'company-a', role: 'admin', departmentId: null })),
}));
jest.mock('@/lib/server/mfaGuard', () => ({ requireAdminMfa: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/utils/supabase/org-alignment-server', () => ({
  getOrgAlignmentCasesForInsight: jest.fn(async () => []),
  saveOrgAlignmentInsight: jest.fn(),
  generateInsightKey: jest.fn(),
  saveInsightSources: jest.fn(),
}));
jest.mock('@/utils/supabase/org-alignment-shared-topics-server', () => ({
  createSharedTopicFromInsight: jest.fn(),
}));
jest.mock('@/utils/supabase/strategy', () => ({
  getFullStrategyDataByCompany: jest.fn(),
  getFullStrategyDataByStrategyId: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getOrgAlignmentCasesForInsight } from '@/utils/supabase/org-alignment-server';
import { isOrgInsightAiEnabled } from '@/lib/orgAlignment/insightAiGate';
import { POST } from './route';

const ORIGINAL_ENV = process.env.ORG_INSIGHT_AI_GENERATION_ENABLED;

function call() {
  return POST(
    new NextRequest('http://localhost/api/org-alignment/admin/insights/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ strategyId: 'strategy-1' }),
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ORG_INSIGHT_AI_GENERATION_ENABLED;
});

afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ORG_INSIGHT_AI_GENERATION_ENABLED;
  else process.env.ORG_INSIGHT_AI_GENERATION_ENABLED = ORIGINAL_ENV;
});

describe('集約生成ガード（個人投稿本文を外部AIへ送らない）', () => {
  it('フラグ未設定では、個人投稿を読まず、外部AIも呼ばずに 503 で停止する', async () => {
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'insight_generation_suspended' });
    expect(getOrgAlignmentCasesForInsight).not.toHaveBeenCalled();
    expect(mockOpenAiConstructed).not.toHaveBeenCalled();
  });

  it.each(['false', '', 'TRUE', '1'])('フラグが %p のときも停止する（true のみ有効）', async (value) => {
    process.env.ORG_INSIGHT_AI_GENERATION_ENABLED = value;
    const res = await call();
    expect(res.status).toBe(503);
    expect(getOrgAlignmentCasesForInsight).not.toHaveBeenCalled();
    expect(mockOpenAiConstructed).not.toHaveBeenCalled();
  });

  it('フラグが true のときだけ、従来どおり投稿を読み込む', async () => {
    process.env.ORG_INSIGHT_AI_GENERATION_ENABLED = 'true';
    const res = await call();
    expect(res.status).not.toBe(503);
    expect(getOrgAlignmentCasesForInsight).toHaveBeenCalledTimes(1);
  });
});

describe('isOrgInsightAiEnabled', () => {
  it('true の文字列だけを有効とみなす', () => {
    expect(isOrgInsightAiEnabled(undefined)).toBe(false);
    expect(isOrgInsightAiEnabled('true')).toBe(true);
    expect(isOrgInsightAiEnabled('yes')).toBe(false);
  });
});

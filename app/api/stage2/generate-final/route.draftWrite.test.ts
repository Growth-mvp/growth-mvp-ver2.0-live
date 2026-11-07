/* eslint-disable @typescript-eslint/no-explicit-any -- DB・OpenAI モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  ...jest.requireActual('@/lib/server/rbacGuard'),
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  assertMinRole: jest.fn(),
}));
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
}));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => undefined),
  extractAuditMetadata: jest.fn(() => ({})),
}));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { openai } from '@/lib/openai';
import { isValidFinalStoryDraft } from '@/lib/stage2/finalStoryDraft';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const STRATEGY_ID = '33333333-3333-4333-8333-333333333333';

function req(body: unknown) {
  return new Request('http://localhost/api/stage2/generate-final', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ strategyDataId: STRATEGY_ID, ...(body as object) }),
  }) as any;
}

function setup(aiContent: string) {
  const update = jest.fn();
  const admin: any = {
    from: (table: string) => {
      if (table !== 'strategy_data') throw new Error(`unexpected table ${table}`);
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        update: (...args: unknown[]) => {
          update(...args);
          return builder;
        },
        maybeSingle: async () => ({ data: { company_id: COMPANY }, error: null }),
      };
      return builder;
    },
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'manager' });
  process.env.OPENAI_API_KEY = 'test-key';
  (openai.chat.completions.create as jest.Mock).mockResolvedValue({
    choices: [{ message: { content: aiContent } }],
  });
  return { update };
}

const FOUR_SECTIONS = JSON.stringify({
  sections: [
    { heading: 'なぜ今', body: '市場の変化が速く、今の事業モデルのままでは利益率が下がり続ける。' },
    { heading: 'どう戦う', body: '小規模事業者の受発注を支える仕組みに経営資源を集中させる。' },
    { heading: 'どんな未来', body: '三年後には受発注の大半がデジタルで完結する状態を目指す。' },
    { heading: 'どう実行する', body: '四半期ごとに部門の実行計画を見直し、責任者ごとに進捗を管理する。' },
  ],
});

describe('POST /api/stage2/generate-final: 下書きの書き込み経路', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AIが空の結果を返した場合は422で拒否し、strategy_data に書き込まない', async () => {
    const { update } = setup('{}');

    const res = await POST(req({ answers12: [] }));

    expect(res.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it('正常な4章の結果は有効な形で返し、strategy_data に直接書き込まない', async () => {
    const { update } = setup(FOUR_SECTIONS);

    const res = await POST(req({ answers12: [] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
    expect(isValidFinalStoryDraft(body.finalStory)).toBe(true);
  });
});

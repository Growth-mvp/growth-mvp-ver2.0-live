/* eslint-disable @typescript-eslint/no-explicit-any -- DB・OpenAI モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  ...jest.requireActual('@/lib/server/rbacGuard'),
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
}));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => undefined),
  extractAuditMetadata: jest.fn(() => ({})),
}));
jest.mock('@/lib/modelConfig', () => ({
  getOpenAIModelParamsForProcess: jest.fn(() => ({ model: 'test-model' })),
}));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { openai } from '@/lib/openai';

const USER = '99999999-9999-4999-8999-999999999999';
const MEMBER_COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const STRATEGY_ID = '33333333-3333-4333-8333-333333333333';
const REVISION = 6;

function strategyRow(companyId: string | null, revision = REVISION) {
  return {
    id: STRATEGY_ID,
    company_id: companyId,
    revision,
    final_story_draft: [{ title: '第1章', body: '顧客価値を明確にする本文です。' }],
    final_story_edited: null,
    final_story_final: null,
    answers12: [],
  };
}

/* 更新時の条件（id・company_id・revision）が一致した行だけ更新し、トリガー相当に revision を +1 する */
function setupAdmin(strategy: ReturnType<typeof strategyRow> | null, opts: { revisionAtUpdate?: number } = {}) {
  const admin: any = { label: 'admin' };
  const updates: Array<{ payload: any; filters: Record<string, unknown>; updated: boolean }> = [];
  admin.from = (table: string) => {
    if (table !== 'strategy_data') throw new Error(`unexpected table ${table}`);
    const filters: Record<string, unknown> = {};
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      maybeSingle: async () => ({
        data: strategy && strategy.id === filters.id ? strategy : null,
        error: null,
      }),
      update: (payload: any) => {
        const updateFilters: Record<string, unknown> = {};
        const upd: any = {
          eq: (col: string, val: unknown) => {
            updateFilters[col] = val;
            return upd;
          },
          select: () => upd,
          maybeSingle: async () => {
            const current = opts.revisionAtUpdate ?? strategy?.revision;
            const matches =
              !!strategy &&
              updateFilters.id === strategy.id &&
              updateFilters.company_id === strategy.company_id &&
              updateFilters.revision === current;
            updates.push({ payload, filters: { ...updateFilters }, updated: matches });
            if (!matches) return { data: null, error: null };
            return { data: { revision: (strategy?.revision ?? 0) + 1 }, error: null };
          },
        };
        return upd;
      },
    };
    return builder;
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
  return { admin, updates };
}

function req(body: unknown) {
  return new Request('http://localhost/api/stage2/generate-conclusion', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any;
}

describe('POST /api/stage2/generate-conclusion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    (requireMembership as jest.Mock).mockImplementation(async (_admin, _userId, companyId) =>
      companyId === MEMBER_COMPANY
        ? { userId: USER, companyId, role: 'manager', departmentId: null }
        : null
    );
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [{ message: { content: 'この結論は十分な長さを持つテキストです。顧客価値と選ばれる理由を示します。' } }],
    });
  });

  it('認証なしは 401 で、AI 呼び出しも保存も行わない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
    const { updates } = setupAdmin(strategyRow(MEMBER_COMPANY));

    const res = await POST(req({ strategyDataId: STRATEGY_ID, expectedRevision: REVISION }));

    expect(res.status).toBe(401);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('所属していない会社の strategy は 403 で、AI 呼び出しも保存も行わない', async () => {
    const { admin, updates } = setupAdmin(strategyRow(OTHER_COMPANY));

    const res = await POST(req({ strategyDataId: STRATEGY_ID, expectedRevision: REVISION }));

    expect(res.status).toBe(403);
    expect(requireMembership).toHaveBeenCalledWith(admin, USER, OTHER_COMPANY);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('company_id が無い strategy は所属確認を通さず 403 にする', async () => {
    const { updates } = setupAdmin(strategyRow(null));

    const res = await POST(req({ strategyDataId: STRATEGY_ID, expectedRevision: REVISION }));

    expect(res.status).toBe(403);
    expect(requireMembership).not.toHaveBeenCalled();
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('member 権限は 403 で、AI 呼び出しも保存も行わない（manager 以上が必要）', async () => {
    (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: MEMBER_COMPANY, role: 'member', departmentId: null });
    const { updates } = setupAdmin(strategyRow(MEMBER_COMPANY));

    const res = await POST(req({ strategyDataId: STRATEGY_ID, expectedRevision: REVISION }));

    expect(res.status).toBe(403);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('manager 以上は結論を生成し、対象会社の strategy にだけ保存し、保存後の revision を返す', async () => {
    const { admin, updates } = setupAdmin(strategyRow(MEMBER_COMPANY));

    const res = await POST(req({ strategyDataId: STRATEGY_ID, expectedRevision: REVISION }));

    expect(res.status).toBe(200);
    expect((await res.json()).revision).toBe(REVISION + 1);
    expect(requireMembership).toHaveBeenCalledWith(admin, USER, MEMBER_COMPANY);
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toEqual({ id: STRATEGY_ID, company_id: MEMBER_COMPANY, revision: REVISION });
    expect(updates[0].payload.final_story_conclusion).toMatchObject({ source: 'ai' });
  });

  it('画面の revision が古ければ、AI を呼ばず 409 を返し、保存しない', async () => {
    setupAdmin(strategyRow(MEMBER_COMPANY, REVISION + 1));

    const res = await POST(req({ strategyDataId: STRATEGY_ID, expectedRevision: REVISION }));

    expect(res.status).toBe(409);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('確認後に別の保存が入った場合は、条件付き更新が外れて 409 を返し、結論を保存しない', async () => {
    const { updates } = setupAdmin(strategyRow(MEMBER_COMPANY), { revisionAtUpdate: REVISION + 1 });

    const res = await POST(req({ strategyDataId: STRATEGY_ID, expectedRevision: REVISION }));

    expect(res.status).toBe(409);
    expect(updates).toHaveLength(1);
    expect(updates[0].updated).toBe(false);
  });

  it('expectedRevision が無ければ 400 を返し、AI も保存も行わない', async () => {
    const { updates } = setupAdmin(strategyRow(MEMBER_COMPANY));

    const res = await POST(req({ strategyDataId: STRATEGY_ID }));

    expect(res.status).toBe(400);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

import { FICTIONAL_COMPANY_ID, FICTIONAL_STRATEGY_ID } from '@/eval/quality/fictionalCompany';
import { RISK_NOW, riskStrategyFixture, type RiskFixtureOptions } from '@/eval/quality/riskFixtures';
import { createClaimStore } from '@/eval/quality/riskClaimStore';

const mockCreate = jest.fn();
const mockGetFullStrategy = jest.fn();
const mockRequireMembership = jest.fn();
let mockStore = createClaimStore();

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => mockStore.admin }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: async (_admin: unknown, req: Request) => {
    const h = req.headers.get('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
  },
  requireMembership: (...a: unknown[]) => mockRequireMembership(...a),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/openai', () => ({ openai: { chat: { completions: { create: (...a: unknown[]) => mockCreate(...a) } } } }));
jest.mock('@/lib/modelConfig', () => ({ getOpenAIModelParamsForProcess: () => ({ model: 'm' }) }));
jest.mock('@/utils/supabase/strategy', () => ({
  getFullStrategyDataByStrategyId: (...a: unknown[]) => mockGetFullStrategy(...a),
}));
jest.mock('@/utils/supabase/normalize', () => ({ normalizeStrategyData: (x: unknown) => x }));

import { POST } from './route';
import { jstDateOf } from '@/lib/companion/companionRiskClaim';

const CASH_OPTIONS: RiskFixtureOptions = { minCashYen: 260_000_000, newLoan: 'zero', dividends: 'zero', stage6Target: true };
const STALL_OPTIONS: RiskFixtureOptions = { krOverdue: true, progress: 'stalled' };

function call(companyId: string, user: string, strategyId = FICTIONAL_STRATEGY_ID) {
  return POST(
    new Request('http://localhost/api/companion/risk-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user}` },
      body: JSON.stringify({ companyId, strategyId }),
    }),
  );
}

async function json(res: Response) {
  return (await res.json()) as Record<string, any>;
}

let fixture: RiskFixtureOptions = CASH_OPTIONS;

describe('経営点検の実行枠と所見の共有', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: RISK_NOW,
      doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
    });
    mockStore = createClaimStore({ delayMs: 5 });
    mockCreate.mockReset();
    mockGetFullStrategy.mockReset();
    mockRequireMembership.mockReset();
    mockRequireMembership.mockResolvedValue({ companyId: FICTIONAL_COMPANY_ID, role: 'member' });
    mockGetFullStrategy.mockImplementation(async (_strategyId: string, companyId: string) => {
      const row = riskStrategyFixture(fixture);
      if (companyId !== FICTIONAL_COMPANY_ID) row.csvFinanceData.financePlanAssumptions.companyId = companyId;
      return { data: row, error: null };
    });
    fixture = CASH_OPTIONS;
    mockCreate.mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const label = params.messages[1].content.includes('資金繰り試算') ? '資金' : '所見';
      return { choices: [{ message: { content: `仮説（${label}）：営業と製造の情報共有が遅れている可能性があります。` } }] };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('並行する5件のリクエストでも、AI呼び出しは1回だけで、残りは作成中として事実を返す', async () => {
    const responses = await Promise.all([1, 2, 3, 4, 5].map((i) => call(FICTIONAL_COMPANY_ID, `user-${i}`)));
    const bodies = await Promise.all(responses.map(json));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const generated = bodies.filter((b) => b.aiState === 'GENERATED');
    expect(generated).toHaveLength(1);
    for (const b of bodies) {
      expect(['GENERATED', 'IN_PROGRESS', 'REUSED']).toContain(b.aiState);
      expect(b.facts.length).toBeGreaterThan(0);
      expect(b.status).toBe('ISSUES');
      if (b.aiState === 'REUSED') expect(b.text).toBe(generated[0].text);
      if (b.aiState === 'IN_PROGRESS') expect(b.text).toBeNull();
    }
    expect(bodies.every((b) => b.facts.join('\n') === bodies[0].facts.join('\n'))).toBe(true);
    expect(mockStore.rows.size).toBe(1);
  });

  it('作成中（IN_PROGRESS）の利用者は、完成後の所見を再取得できる（自動の繰り返しはない）', async () => {
    const first = call(FICTIONAL_COMPANY_ID, 'user-1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const waiting = await json(await call(FICTIONAL_COMPANY_ID, 'user-2'));
    expect(waiting.aiState).toBe('IN_PROGRESS');
    expect(waiting.text).toBeNull();
    expect(typeof waiting.checkedAt).toBe('string');

    const generated = await json(await first);
    expect(generated.aiState).toBe('GENERATED');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const refreshed = await json(await call(FICTIONAL_COMPANY_ID, 'user-2'));
    expect(refreshed.aiState).toBe('REUSED');
    expect(refreshed.text).toBe(generated.text);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('同じ企業の別の利用者は、当日の所見を共有する（AIは呼ばない）', async () => {
    await json(await call(FICTIONAL_COMPANY_ID, 'user-1'));
    const first = await json(await call(FICTIONAL_COMPANY_ID, 'user-2'));
    expect(first.aiState).toBe('REUSED');
    expect(first.text).toContain('仮説（資金）');
    const second = await json(await call(FICTIONAL_COMPANY_ID, 'user-3'));
    expect(second.text).toBe(first.text);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('他企業の点検は、別の枠で扱い、他企業の所見を返さない', async () => {
    await json(await call(FICTIONAL_COMPANY_ID, 'user-1'));
    const other = await json(await call('quality-company-b', 'user-9'));
    expect(other.aiState).toBe('GENERATED');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockStore.rows.size).toBe(2);
    expect(mockStore.rows.get('quality-company-b|2027-06-15')?.ai_finding).toBe(other.text);
  });

  it('当日の点検事実が変わった場合、古い所見は表示せず、事実だけを返す（AIは呼ばない）', async () => {
    await json(await call(FICTIONAL_COMPANY_ID, 'user-1'));
    fixture = STALL_OPTIONS;
    const changed = await json(await call(FICTIONAL_COMPANY_ID, 'user-2'));
    expect(changed.aiState).toBe('STALE');
    expect(changed.text).toBeNull();
    expect(changed.facts.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('実行枠の確保に失敗した場合は、AIを呼ばず、事実だけを返す', async () => {
    mockStore = createClaimStore({ failInsert: true });
    const body = await json(await call(FICTIONAL_COMPANY_ID, 'user-1'));
    expect(body.aiState).toBe('UNAVAILABLE');
    expect(body.text).toBeNull();
    expect(body.facts.length).toBeGreaterThan(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('AIの呼び出しに失敗しても事実は返し、同じ日の再試行はしない', async () => {
    mockCreate.mockReset();
    mockCreate.mockRejectedValue(Object.assign(new Error('upstream'), { status: 500 }));
    const failed = await json(await call(FICTIONAL_COMPANY_ID, 'user-1'));
    expect(failed.aiState).toBe('FAILED');
    expect(failed.text).toBeNull();
    expect(failed.facts.length).toBeGreaterThan(0);

    const again = await json(await call(FICTIONAL_COMPANY_ID, 'user-2'));
    expect(again.aiState).toBe('FAILED_TODAY');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('所属がない利用者は、実行枠に触れず、403を返す', async () => {
    mockRequireMembership.mockResolvedValueOnce(null);
    const res = await call(FICTIONAL_COMPANY_ID, 'outsider');
    expect(res.status).toBe(403);
    expect(mockStore.stats.inserts).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('戦略が指定された会社に属さなければ、404を返し、実行枠に触れない', async () => {
    mockGetFullStrategy.mockResolvedValueOnce({ data: null, error: new Error('not found') });
    const res = await call('quality-company-b', 'user-9');
    expect(res.status).toBe(404);
    expect(mockStore.stats.inserts).toBe(0);
  });

  it('戦略の読み取りは、リクエストの会社の範囲で行う', async () => {
    await call(FICTIONAL_COMPANY_ID, 'user-1');
    expect(mockGetFullStrategy).toHaveBeenCalledWith(FICTIONAL_STRATEGY_ID, FICTIONAL_COMPANY_ID, expect.anything());
  });

  it('日付は日本時間で区切る（UTCの15時は日本時間の翌日0時）', () => {
    expect(jstDateOf(new Date('2026-11-27T14:59:59Z'))).toBe('2026-11-27');
    expect(jstDateOf(new Date('2026-11-27T15:00:00Z'))).toBe('2026-11-28');
  });
});

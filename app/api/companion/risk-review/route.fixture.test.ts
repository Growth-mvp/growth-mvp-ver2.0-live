import { FICTIONAL_COMPANY_ID, FICTIONAL_STRATEGY_ID } from '@/eval/quality/fictionalCompany';
import { RISK_NOW, riskStrategyFixture, type RiskFixtureOptions } from '@/eval/quality/riskFixtures';
import { createClaimStore } from '@/eval/quality/riskClaimStore';
import { RISK_GUARD, NOT_CHECKED_NOTE } from '@/lib/companion/companionRisk';
import { requestRiskReview, riskReviewBody } from '@/lib/companion/companionRiskClient';

const mockCreate = jest.fn();
const mockGetFullStrategy = jest.fn();
let mockStore = createClaimStore();

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => mockStoreAdmin() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: async () => 'quality-user-ceo',
  requireMembership: async () => ({ companyId: 'quality-company-a', role: 'admin' }),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/openai', () => ({ openai: { chat: { completions: { create: (...a: unknown[]) => mockCreate(...a) } } } }));
jest.mock('@/lib/modelConfig', () => ({ getOpenAIModelParamsForProcess: () => ({ model: 'm' }) }));
jest.mock('@/utils/supabase/strategy', () => ({
  getFullStrategyDataByStrategyId: (...a: unknown[]) => mockGetFullStrategy(...a),
}));
jest.mock('@/utils/supabase/normalize', () => ({ normalizeStrategyData: (x: unknown) => x }));

function mockStoreAdmin() {
  return mockStore.admin;
}

import { POST } from './route';

function routeOver(options: RiskFixtureOptions) {
  mockGetFullStrategy.mockResolvedValue({ data: riskStrategyFixture(options), error: null });
  return (url: string, init: RequestInit) => POST(new Request(`http://localhost${url}`, init));
}

const client = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>) =>
  requestRiskReview({
    companyId: FICTIONAL_COMPANY_ID,
    strategyId: FICTIONAL_STRATEGY_ID,
    getAccessToken: async () => 'token',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

describe('経営点検の一気通貫（API → AI所見 → 表示本文）', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: RISK_NOW,
      doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
    });
    mockStore = createClaimStore();
    mockCreate.mockReset();
    mockGetFullStrategy.mockReset();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '仮説：営業と製造の情報共有が遅れ、目標の進捗が見えにくくなっている可能性があります。' } }],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('資金不足・目標未達・計画停滞・KR期限超過を含む事実を、AI所見と表示本文まで届ける', async () => {
    const result = await client(
      routeOver({ minCashYen: 260_000_000, newLoan: 'zero', dividends: 'zero', stage6Target: true, krOverdue: true, progress: 'stalled' }),
    );

    expect(result?.status).toBe('ISSUES');
    expect(result?.aiState).toBe('GENERATED');
    const facts = result!.facts.join('\n');
    expect(facts).toContain('2026年度：施策反映・借入反映後の期末現預金が最低現預金を 16,760,000円 下回る見込み');
    expect(facts).toContain('2027年度の売上：STAGE6の経営目標に対して 70,000,000円 不足');
    expect(facts).toContain('2027年度の営業利益：STAGE6の経営目標に対して 18,000,000円 不足');
    expect(facts).toContain('期限（2027-01）を過ぎたが、実績が未登録');
    expect(facts).toContain('期限（2027-03）を過ぎ、実績 80件 が目標 120件 に届いていない');
    expect(facts).toContain('進行中のまま30日以上更新がない実施事項');
    expect(result!.serious).toBe(true);
    expect(result!.text).toContain('仮説');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sent = mockCreate.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(sent.messages[0]).toEqual({ role: 'system', content: RISK_GUARD });
    expect(sent.messages[1].content).toContain(result!.facts[0]);

    const body = riskReviewBody(result!);
    expect(body.startsWith('事実（保存済みデータの計算結果）')).toBe(true);
    expect(body).toContain('仮説：営業と製造');
    expect(body.endsWith(NOT_CHECKED_NOTE)).toBe(true);
  });

  it('資金計画が未保存で判断材料が限られるときは、AIを呼ばず、判断材料の不足を示す（実行枠も使わない）', async () => {
    const result = await client(routeOver({ finance: 'none', stage6Target: false }));

    expect(result?.status).toBe('INSUFFICIENT');
    expect(result?.facts).toEqual([]);
    expect(result?.coverage).toEqual(expect.arrayContaining([expect.stringContaining('資金繰り：未登録')]));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockStore.stats.inserts).toBe(0);

    const body = riskReviewBody(result!);
    expect(body).toContain('判断材料が不足している項目があるため、経営点検の結論は出せません');
    expect(body).toContain('資金繰り：未登録');
  });

  it('事実が0件で判断材料も揃っていれば、問題なしを定型文で示し、AIを呼ばない', async () => {
    const result = await client(
      routeOver({ minCashYen: 150_000_000, newLoan: 'zero', dividends: 'zero', stage6RevenueTargetYen: 900_000_000, stage6OperatingIncomeTargetYen: 40_000_000, progress: 'recent' }),
    );

    expect(result?.status).toBe('NO_ISSUE');
    expect(result?.facts).toEqual([]);
    expect(result?.coverage).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(riskReviewBody(result!)).toContain('点検できた範囲では、問題は検出されませんでした');
  });

  it('点検の処理が失敗したときは、失敗として示し、AIを呼ばない', async () => {
    mockGetFullStrategy.mockResolvedValue({ data: null, error: new Error('db') });
    const result = await client((url, init) => POST(new Request(`http://localhost${url}`, init)));
    expect(result?.status).toBe('FAILED');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

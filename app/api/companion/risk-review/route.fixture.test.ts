import { FICTIONAL_COMPANY_ID, FICTIONAL_STRATEGY_ID, FICTIONAL_STRATEGY_ROW } from '@/eval/quality/fictionalCompany';
import { NOT_CHECKED_NOTE, RISK_GUARD } from '@/lib/companion/companionRisk';
import { requestRiskReview, riskReviewBody } from '@/lib/companion/companionRiskClient';

const mockCreate = jest.fn();
const mockGetFullStrategy = jest.fn();

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({}) }));
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

import { POST } from './route';

const NOW = new Date('2027-06-15T09:00:00+09:00');

function fixtureStrategy(): Record<string, unknown> {
  const row = JSON.parse(JSON.stringify(FICTIONAL_STRATEGY_ROW)) as Record<string, any>;
  const sales = row.departments[0].projects[0];
  sales.okrsV2[0].actual = { value: 80 };
  const mfg = row.departments[1].projects[0];
  mfg.okrsV2[0].due = '2027-01';
  mfg.executionProgress = {
    'action-1': { status: 'IN_PROGRESS', result: '', issue: '', nextAction: '', krIds: [], updatedAt: '2026-10-01T00:00:00Z' },
  };
  row.companyTargets = [
    { id: 't-revenue', label: '売上', unit: '円', dueYear: 2027, base: 1_000_000_000, linkedIssueIds: [], rationale: '架空の業績目標' },
    { id: 't-oi', label: '営業利益', unit: '円', dueYear: 2027, base: 70_000_000, linkedIssueIds: [], rationale: '架空の業績目標' },
  ];
  const plan = row.csvFinanceData.financePlanAssumptions.cashFlow;
  Object.assign(plan, { minCashYen: 260_000_000, depreciationYen: 20_000_000, arRatio: 0.14, inventoryRatio: 0.077, apRatio: 0.085 });
  row.csvFinanceData.financePlanAssumptions.dividendsYen = { 2026: 0, 2027: 0, 2028: 0 };
  row.csvFinanceData.financePlanAssumptions.existingLoans = [
    {
      id: 'loan-1',
      name: '長期借入金（架空）',
      category: 'LONG',
      balanceYen: 200_000_000,
      annualRate: 0.01,
      scheduledPrincipalYen: { 2026: 20_000_000, 2027: 20_000_000, 2028: 20_000_000 },
    },
  ];
  return row;
}

function requestThroughRoute(): (url: string, init: RequestInit) => Promise<Response> {
  return (url, init) => POST(new Request(`http://localhost${url}`, init));
}

describe('経営点検の一気通貫（API → AI所見 → 表示本文）', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    mockCreate.mockReset();
    mockGetFullStrategy.mockReset();
    mockGetFullStrategy.mockResolvedValue({ data: fixtureStrategy(), error: null });
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '仮説：営業と製造の情報共有が遅れ、目標の進捗が見えにくくなっている可能性があります。' } }],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('代表的な4つの事実（目標未達・資金不足・計画停滞・KR期限超過）を含む事実を、クライアントの本文まで届ける', async () => {
    const result = await requestRiskReview({
      companyId: FICTIONAL_COMPANY_ID,
      strategyId: FICTIONAL_STRATEGY_ID,
      getAccessToken: async () => 'token',
      fetchImpl: requestThroughRoute() as unknown as typeof fetch,
    });

    expect(result).not.toBeNull();
    const facts = result!.facts.join('\n');
    expect(facts).toContain('2026年度：施策反映・借入反映後の期末現預金が最低現預金を 16,760,000円 下回る見込み');
    expect(facts).toContain('2027年度の営業利益：経営目標に対して');
    expect(facts).toContain('2027年度の売上：経営目標に対して');
    expect(facts).toContain('期限（2027-01）を過ぎたが、実績が未登録');
    expect(facts).toContain('期限（2027-03）を過ぎ、実績 80件 が目標 120件 に届いていない');
    expect(facts).toContain('進行中のまま30日以上更新がない実施事項');
    expect(result!.serious).toBe(true);
    expect(result!.text).toContain('仮説');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sent = mockCreate.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(sent.messages[0]).toEqual({ role: 'system', content: RISK_GUARD });
    expect(sent.messages[1].content).toContain('- ' + result!.facts[0].slice(2));

    const body = riskReviewBody(result!);
    expect(body.startsWith('事実（保存済みデータの計算結果）')).toBe(true);
    expect(body).toContain('仮説：営業と製造');
    expect(body.endsWith(NOT_CHECKED_NOTE)).toBe(true);
  });

  it('事実が無いときは、AIを呼ばず、判断できなかった項目だけを返す', async () => {
    mockGetFullStrategy.mockResolvedValue({ data: { ...fixtureStrategy(), departments: [], csvFinanceData: {} }, error: null });
    const res = await requestThroughRoute()(`/api/companion/risk-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ companyId: FICTIONAL_COMPANY_ID, strategyId: FICTIONAL_STRATEGY_ID }),
    });
    const data = (await res.json()) as { facts: string[]; text: unknown; coverage: string[] };
    expect(data.facts).toEqual([]);
    expect(data.text).toBeNull();
    expect(data.coverage).toEqual(expect.arrayContaining([expect.stringContaining('資金繰り：未登録')]));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

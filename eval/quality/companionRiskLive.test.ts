/* 経営点検の実API検証（匿名化された架空企業）。QUALITY_LIVE=1 かつ QUALITY_APPROVED=yes のときだけ動く。
 * 3ケース・最大3回の呼び出しに制限する。実企業のデータは使わない。 */
import fs from 'fs';
import path from 'path';
import { FICTIONAL_COMPANY_ID, FICTIONAL_STRATEGY_ID } from './fictionalCompany';
import { RISK_NOW, riskStrategyFixture, type RiskFixtureOptions } from './riskFixtures';

const LIVE = process.env.QUALITY_LIVE === '1' && process.env.QUALITY_APPROVED === 'yes';
const describeLive = LIVE ? describe : describe.skip;

const MAX_CALLS = 3;
const mockGetFullStrategy = jest.fn();

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({}) }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: async () => 'quality-user-ceo',
  requireMembership: async () => ({ companyId: 'quality-company-a', role: 'admin' }),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/utils/supabase/strategy', () => ({
  getFullStrategyDataByStrategyId: (...a: unknown[]) => mockGetFullStrategy(...a),
}));
jest.mock('@/utils/supabase/normalize', () => ({ normalizeStrategyData: (x: unknown) => x }));

const CASES: Array<{ name: string; options: RiskFixtureOptions }> = [
  {
    name: '資金不足と経営目標未達が同時にある',
    options: { minCashYen: 260_000_000, newLoan: 'zero', dividends: 'zero', stage6Target: true, krOverdue: false, progress: 'none' },
  },
  {
    name: '実行計画の停滞とKRの期限超過がある',
    options: { minCashYen: 150_000_000, newLoan: 'zero', dividends: 'zero', stage6Target: false, krOverdue: true, progress: 'stalled' },
  },
  {
    name: '判断材料が限定されている（資金計画が未保存）',
    options: { finance: 'none', stage6Target: false, krOverdue: true },
  },
];

function loadApiKeyFromEnvFile(): void {
  if (process.env.OPENAI_API_KEY) return;
  const text = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const m = /^OPENAI_API_KEY=(.*)$/m.exec(text);
  if (m) process.env.OPENAI_API_KEY = m[1].trim().replace(/^['"]|['"]$/g, '');
}

describeLive('経営点検の実API検証（承認済み・3ケース・最大3回）', () => {
  let post: (req: Request) => Promise<Response>;
  let calls = 0;
  const outputs: Array<Record<string, unknown>> = [];

  beforeAll(() => {
    loadApiKeyFromEnvFile();
    jest.useFakeTimers({
      now: RISK_NOW,
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
    });
    const { openai } = require('@/lib/openai');
    const original = openai.chat.completions.create.bind(openai.chat.completions);
    openai.chat.completions.create = async (params: unknown) => {
      calls += 1;
      if (calls > MAX_CALLS) throw new Error('検証の呼び出し上限（3回）を超えました');
      return original(params);
    };
    post = require('@/app/api/companion/risk-review/route').POST;
  });

  afterAll(() => {
    jest.useRealTimers();
    const dir = path.join(process.cwd(), 'eval', 'quality', 'archive', 'phase3-risk-live');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'risk-live.json'), JSON.stringify(outputs, null, 2), 'utf8');
  });

  it.each(CASES)('$name', async ({ name, options }) => {
    mockGetFullStrategy.mockResolvedValue({ data: riskStrategyFixture(options), error: null });
    const res = await post(
      new Request('http://localhost/api/companion/risk-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
        body: JSON.stringify({ companyId: FICTIONAL_COMPANY_ID, strategyId: FICTIONAL_STRATEGY_ID }),
      }),
    );
    const data = (await res.json()) as Record<string, unknown>;
    outputs.push({ case: name, httpStatus: res.status, ...data, aiCallsSoFar: calls });
    console.log(`【${name}】\n${JSON.stringify(data, null, 2)}`);
    expect(res.status).toBe(200);
    expect(['ISSUES', 'INSUFFICIENT', 'NO_ISSUE']).toContain(data.status);
  }, 120_000);
});

/* Phase 2J の1件実行（承認後のみ）。PLAN_2J_LIVE=1, PLAN_2J_APPROVED=yes, PLAN_2J_CASE=growth|profit|crossdept。
 * 1回の実行で1件だけ送信する。台帳で合計3回・$1 を超えない。 */
import { runEngineOnce } from './live-2j';
import { CROSSDEPT_INPUT } from './quality/crossdept';
import { GROWTH_INPUT } from './quality/growth';
import { PROFIT_INPUT } from './quality/profit';

const env = process.env;
const LIVE = env.PLAN_2J_LIVE === '1' && env.PLAN_2J_APPROVED === 'yes';
const inputs: Record<string, typeof GROWTH_INPUT> = { growth: GROWTH_INPUT, profit: PROFIT_INPUT, crossdept: CROSSDEPT_INPUT };

(LIVE ? describe : describe.skip)('Phase 2J：新エンジンの1件実行（承認後のみ）', () => {
  it('指定された1件を、厳格な構造化出力で1回生成する', async () => {
    const id = env.PLAN_2J_CASE ?? '';
    if (!inputs[id]) throw new Error(`PLAN_2J_CASE が不正: ${id}`);
    const r = await runEngineOnce({ caseId: id, raw: inputs[id], apiKey: env.OPENAI_API_KEY });
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.finishReason).toBe('stop');
  }, 300_000);
});

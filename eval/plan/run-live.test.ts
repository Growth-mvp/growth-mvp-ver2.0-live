/* 承認後のみ実行する：3件 × 2方式 = 6回の実OpenAI生成。
 * 実行条件：PLAN_LIVE=1 かつ PLAN_APPROVED=yes。どちらか欠ければ何も送信せずスキップする。
 * 結果（プロンプト全文・出力全文・usage・費用・時間）と機械的検証は eval/plan/results-live/ に保存する（Git管理外）。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { runExecutionPlanEngine } from '@/lib/stage4/plan/generate';
import { CROSSDEPT_INPUT } from './quality/crossdept';
import { GROWTH_INPUT } from './quality/growth';
import { PROFIT_INPUT } from './quality/profit';
import { runLive, LIVE_BUDGET_USD, type LiveCallResult } from './live';
import { summarizeEngineBurden, countLegacyEdits, type LegacyDraftJson } from './evaluation';

const LIVE = process.env.PLAN_LIVE === '1' && process.env.PLAN_APPROVED === 'yes';
const outDir = path.join(__dirname, 'results-live');
const now = { year: 2026, month: 11, day: 9 };
const cases = [
  { id: 'growth', name: '成長戦略型', raw: GROWTH_INPUT },
  { id: 'profit', name: '収益改善型', raw: PROFIT_INPUT },
  { id: 'crossdept', name: '組織横断型', raw: CROSSDEPT_INPUT },
];
/** 既存方式の期限の窓（本番と同じ規則：KPIは3〜6か月後、ステップは1〜3か月後） */
const legacyWindow = { kpiFrom: '2027-02', kpiTo: '2027-05', stepFrom: '2026-12', stepTo: '2027-02' };

function jsonOf(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSONが見つからない');
  return JSON.parse(m[0]);
}

(LIVE ? describe : describe.skip)('実API：3件 × 2方式（承認後のみ・各1回）', () => {
  it('6回生成し、結果と機械的検証を保存する', async () => {
    mkdirSync(outDir, { recursive: true });
    const { results, spentUsd } = await runLive({
      cases,
      now,
      outDir,
      apiKey: process.env.OPENAI_API_KEY,
      env: process.env,
    });
    expect(results).toHaveLength(6);

    const summary = [];
    for (const c of cases) {
      const legacy = results.find((r) => r.caseId === c.id && r.system === 'LEGACY') as LiveCallResult;
      const engine = results.find((r) => r.caseId === c.id && r.system === 'ENGINE') as LiveCallResult;

      const run = await runExecutionPlanEngine({ raw: c.raw, callModel: async () => engine.output });
      const engineEdits = summarizeEngineBurden(run.plan, run.issues);

      let legacyEdits: ReturnType<typeof countLegacyEdits> | null = null;
      let legacyError: string | null = null;
      try {
        const json = jsonOf(legacy.output) as LegacyDraftJson;
        legacyEdits = countLegacyEdits(json, { stage3KpiCount: run.context!.stage3Kpis.length, window: legacyWindow });
      } catch (e) {
        legacyError = e instanceof Error ? e.message : String(e);
      }

      summary.push({
        caseId: c.id,
        name: c.name,
        legacy: { durationMs: legacy.durationMs, usage: legacy.usage, costUsd: legacy.costUsd, finishReason: legacy.finishReason, parseError: legacyError, edits: legacyEdits },
        engine: {
          durationMs: engine.durationMs,
          usage: engine.usage,
          costUsd: engine.costUsd,
          finishReason: engine.finishReason,
          ok: run.ok,
          errors: run.issues.filter((i) => i.severity === 'error'),
          warnings: run.issues.filter((i) => i.severity === 'warning'),
          edits: engineEdits,
        },
      });
    }

    writeFileSync(
      path.join(outDir, 'summary.json'),
      JSON.stringify({ model: results[0].model, budgetUsd: LIVE_BUDGET_USD, spentUsd, summary }, null, 2),
      'utf8'
    );
    expect(spentUsd).toBeLessThan(LIVE_BUDGET_USD);
  }, 1_800_000);
});

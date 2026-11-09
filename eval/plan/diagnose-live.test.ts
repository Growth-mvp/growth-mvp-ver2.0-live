/* 承認済みの実API結果（eval/plan/results-live）の診断。送信はしない。
 * 1. 既存方式：確定KPIのラベル・目標・単位・期限・担当が入力と一致するか（改変の数）
 * 2. 新方式：保存済みの出力を v2 へ移行し（移行ログ付き）、検証器にかける
 * 結果は results-live/diagnostics-v2.json に保存する（Phase 2C の diagnostics.json は残す）。 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { runExecutionPlanEngine } from '@/lib/stage4/plan/generate';
import { buildPlanSource } from '@/lib/stage4/plan/source';
import { buildPlanContext } from '@/lib/stage4/plan/context';
import { migrateV1ToV2 } from '@/lib/stage4/plan/migrate';
import { CROSSDEPT_INPUT } from './quality/crossdept';
import { GROWTH_INPUT } from './quality/growth';
import { PROFIT_INPUT } from './quality/profit';
import type { RawPlanInput } from '@/lib/stage4/plan/source';

const dir = path.join(__dirname, 'results-live');
const cases: Array<[string, RawPlanInput]> = [
  ['growth', GROWTH_INPUT],
  ['profit', PROFIT_INPUT],
  ['crossdept', CROSSDEPT_INPUT],
];

/** 既存方式：確定KPIの改変（入力と異なる目標・単位・期限・担当・欠落）を数える */
function legacyKpiAlterations(legacy: Record<string, any>, raw: RawPlanInput): Array<Record<string, unknown>> {
  const { source, scope } = buildPlanSource(raw);
  const ctx = buildPlanContext(source, scope);
  const out: Array<Record<string, unknown>> = [];
  for (const s of ctx.stage3Kpis) {
    const hit = (legacy.kpis ?? []).find((k: { label?: string }) => k.label === s.label);
    if (!hit) {
      out.push({ kpi: s.label, change: '欠落（ラベルが一致しない）' });
      continue;
    }
    const diffs: string[] = [];
    if (Number(hit.target) !== s.target) diffs.push(`目標 ${s.target}${s.unit} → ${hit.target}`);
    if ((hit.due ?? null) !== s.due) diffs.push(`期限 ${s.due} → ${hit.due}`);
    if ((hit.owner || null) !== s.owner) diffs.push(`担当 ${s.owner} → "${hit.owner}"`);
    if (diffs.length) out.push({ kpi: s.label, change: diffs.join('、') });
  }
  return out;
}

(existsSync(path.join(dir, 'summary.json')) ? describe : describe.skip)('承認済み実API結果の診断（v2移行）', () => {
  it('既存方式の確定KPI改変を数え、新方式を移行して検証し、結果を保存する', async () => {
    const report: Record<string, unknown> = {};
    for (const [id, raw] of cases) {
      const legacy = JSON.parse(readFileSync(path.join(dir, `${id}-LEGACY.json`), 'utf8'));
      const engine = JSON.parse(readFileSync(path.join(dir, `${id}-ENGINE.json`), 'utf8'));
      const legacyJson = JSON.parse(legacy.output.match(/\{[\s\S]*\}/)![0]);
      const engineRaw = JSON.parse(engine.output.match(/\{[\s\S]*\}/)![0]);

      const { json, log } = migrateV1ToV2(engineRaw);
      const run = await runExecutionPlanEngine({ raw, callModel: async () => JSON.stringify(json) });

      report[id] = {
        legacyKpiAlterations: legacyKpiAlterations(legacyJson, raw),
        migrationLog: log,
        engineAfterMigration: {
          ok: run.ok,
          errors: run.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.path}`),
          warnings: run.issues.filter((i) => i.severity === 'warning').map((i) => `${i.code} ${i.path}`),
          protectedKpis: run.plan?.section3.protectedKpis.map((k) => `${k.key} ${k.label} 目標${k.target}${k.unit} 期限${k.due} 担当${k.owner}`) ?? [],
          period: run.plan?.period ?? null,
        },
      };
    }
    writeFileSync(path.join(dir, 'diagnostics-v2.json'), JSON.stringify(report, null, 2), 'utf8');
    expect(Object.keys(report)).toHaveLength(3);
  });
});

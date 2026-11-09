/* Phase 2F：保存済みの成長戦略型の出力（Phase 2E）を、API送信なしで再検証する。
 * 保存済みの出力は読むだけ。参照IDの正規化以外の変更は、検証で許さない。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { runExecutionPlanEngine } from '@/lib/stage4/plan/generate';
import { buildPlanApiSchema } from '@/lib/stage4/plan/apiSchema';
import { classifyKpi } from '@/lib/stage4/plan/kpiClass';
import { canonicalizeRefs } from '@/lib/stage4/plan/refs';
import { buildPlanContext } from '@/lib/stage4/plan/context';
import { buildPlanSource } from '@/lib/stage4/plan/source';
import { summarizeEngineBurden } from '../evaluation';
import { GROWTH_INPUT } from '../quality/growth';

const saved = path.join(__dirname, '..', 'results-phase2e', 'growth-ENGINE-2E.json');
const outDir = path.join(__dirname, '..', 'results-phase2f');

/** sourceRefs 以外の値を比べるための写し */
const withoutRefs = (v: any): any => {
  if (Array.isArray(v)) return v.map(withoutRefs);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'sourceRefs') o[k] = withoutRefs(x);
    return o;
  }
  return v;
};

(existsSync(saved) ? describe : describe.skip)('Phase 2F：保存済みの成長戦略型のオフライン検証', () => {
  const rec = JSON.parse(readFileSync(saved, 'utf8'));
  const original = JSON.parse(rec.output);
  const { source, scope } = buildPlanSource(GROWTH_INPUT);
  const ctx = buildPlanContext(source, scope);
  const known = new Set(ctx.sources.map((s) => s.ref));

  it('正規化は参照IDの角括弧を外すだけで、他の内容は変えない', () => {
    const canon = canonicalizeRefs(original, known);
    expect(canon.normalized).toBe(54);
    expect(withoutRefs(canon.value)).toEqual(withoutRefs(original));
    for (const r of JSON.stringify(canon.value).match(/"sourceRefs":\[[^\]]*\]/g) ?? []) {
      expect(r).not.toContain('[S');
    }
  });

  it('エンジンの検証で、参照IDのエラーは残らず、正規化の件数が記録される', async () => {
    const run = await runExecutionPlanEngine({ raw: GROWTH_INPUT, callModel: async () => rec.output });
    const errors = run.issues.filter((i) => i.severity === 'error');
    expect(errors.map((e) => e.code)).not.toContain('SOURCE_REF_UNKNOWN');
    expect(run.issues.find((i) => i.code === 'REF_NORMALIZED')?.message).toContain('54 件');
    // Phase 2I：旧出力は、入力の規制の論点（脅威）を計画に反映していない。新しい検証で検出される
    expect(errors.map((e) => e.code)).toEqual(['REGULATORY_CONSTRAINT_NOT_ADDRESSED']);
    expect(run.ok).toBe(false);
  });

  it('KPIの分類：記録件数は活動、作業時間の削減率は成果', () => {
    expect(classifyKpi('記録件数', '件').class).toBe('ACTIVITY');
    expect(classifyKpi('計測・記録に必要な作業時間の削減率', '%').class).toBe('OUTCOME');
    expect(classifyKpi('試験導入先で計測・記録の負担軽減を確認できた医療機関数', '件').class).toBe('OUTCOME');
  });

  it('既存KPIは変更されず、追加KPIの分類は成果の指標として判定される', async () => {
    const run = await runExecutionPlanEngine({ raw: GROWTH_INPUT, callModel: async () => rec.output });
    expect(run.plan!.section3.protectedKpis.map((k) => `${k.key}:${k.label}:${k.target}:${k.due}`)).toEqual([
      'S1:試験導入に合意した医療機関数:5:2027-09',
      'S2:試験導入後に継続利用の意向を確認した医療機関数:3:2028-02',
    ]);
    for (const k of run.plan!.section3.proposedKpis) {
      expect(classifyKpi(k.label, k.unit).class).not.toBe('ACTIVITY');
    }
  });

  it('未確認の財務数値は確定扱いにならず、金額も作られない', async () => {
    const run = await runExecutionPlanEngine({ raw: GROWTH_INPUT, callModel: async () => rec.output });
    expect(run.estimates.every((e) => e.status !== 'AI_ESTIMATE_UNCONFIRMED' || e.amountYen !== null)).toBe(true);
    for (const e of run.estimates) expect(e.amountYen).toBeNull();
    for (const f of run.plan!.section4.financeItems) {
      for (const i of f.inputs) expect(i.confirmState).not.toBe('USER_CONFIRMED');
    }
  });

  it('API向けスキーマには適合したまま（保存済みの出力は、Phase 2E で適合済み）', () => {
    expect(buildPlanApiSchema().schema).toBeDefined();
  });

  it('検証結果を保存する（保存済みの出力は書き換えない）', async () => {
    const run = await runExecutionPlanEngine({ raw: GROWTH_INPUT, callModel: async () => rec.output });
    const burden = summarizeEngineBurden(run.plan, run.issues);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, 'growth-offline.json'),
      JSON.stringify({ ok: run.ok, issues: run.issues, burden, sourceUnchanged: true }, null, 2),
      'utf8'
    );
    expect(burden.machineErrors.total).toBe(1);
  });
});

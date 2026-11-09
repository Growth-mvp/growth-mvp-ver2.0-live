/* Phase 2E の保存済み出力の機械的検証（API送信なし）。
 * 1. API向けスキーマへの適合、2. Zod（PlanDraftSchema）と検証器、3. 既存KPIの保護、4. 財務・期限・順序の確認。
 * 結果は results-phase2e/{caseId}-check.json に保存する。 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { buildPlanApiSchema } from '@/lib/stage4/plan/apiSchema';
import { runExecutionPlanEngine } from '@/lib/stage4/plan/generate';
import { summarizeEngineBurden } from './evaluation';
import { CROSSDEPT_INPUT } from './quality/crossdept';
import { GROWTH_INPUT } from './quality/growth';
import { PROFIT_INPUT } from './quality/profit';
import type { RawPlanInput } from '@/lib/stage4/plan/source';

const dir = path.join(__dirname, 'results-phase2e');
const inputs: Array<[string, RawPlanInput]> = [
  ['growth', GROWTH_INPUT],
  ['profit', PROFIT_INPUT],
  ['crossdept', CROSSDEPT_INPUT],
];

/** API向けスキーマの最小検証器（検証の仕組みは api-schema-conformance.test.ts と同じ） */
function conforms(schema: any, value: any, p = '$'): string[] {
  if (schema.anyOf) return schema.anyOf.some((s: any) => conforms(s, value, p).length === 0) ? [] : [`${p}: anyOf`];
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (!types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) return [`${p}: 型 ${actual}`];
  const e: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) e.push(`${p}: 列挙外 ${JSON.stringify(value)}`);
  if (actual === 'object' && schema.properties) {
    for (const k of Object.keys(value)) if (!(k in schema.properties)) e.push(`${p}: 未定義 ${k}`);
    for (const r of schema.required ?? []) if (!(r in value)) e.push(`${p}: 必須 ${r}`);
    for (const [k, s] of Object.entries(schema.properties)) if (k in value) e.push(...conforms(s, value[k], `${p}.${k}`));
  }
  if (actual === 'array' && schema.items) value.forEach((v: any, i: number) => e.push(...conforms(schema.items, v, `${p}[${i}]`)));
  return e;
}

(existsSync(path.join(dir, 'ledger.json')) ? describe : describe.skip)('Phase 2E 保存済み出力の機械的検証', () => {
  const api = buildPlanApiSchema();
  for (const [id, raw] of inputs) {
    const file = path.join(dir, `${id}-ENGINE-2E.json`);
    if (!existsSync(file)) continue;
    it(`${id}：スキーマ・検証器・KPI保護・財務の確認`, async () => {
      const rec = JSON.parse(readFileSync(file, 'utf8'));
      const parsed = JSON.parse(rec.output);
      const apiErrors = conforms(api.schema, parsed);
      const run = await runExecutionPlanEngine({ raw, callModel: async () => rec.output });
      const edits = run.plan ? summarizeEngineBurden(run.plan, run.issues) : null;
      const check = {
        caseId: id,
        apiSchemaErrors: apiErrors,
        zodOk: run.plan !== null,
        engineOk: run.ok,
        errors: run.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.path}`),
        warnings: run.issues.filter((i) => i.severity === 'warning').map((i) => `${i.code} ${i.path}`),
        protectedKpis: run.plan?.section3.protectedKpis.map((k) => `${k.key} ${k.label} 目標${k.target}${k.unit} 期限${k.due} 担当${k.owner}`) ?? [],
        proposedKpis: run.plan?.section3.proposedKpis.map((k) => `${k.key} [${k.kind}] ${k.label} 目標${k.target}${k.unit}`) ?? [],
        actions: run.plan?.section2.actions.length ?? 0,
        mechanismsPresent: run.plan?.section2.actions.filter((a) => a.mechanism !== null).length ?? 0,
        obstacles: run.plan?.section1.obstacles.length ?? 0,
        beforeStartConfirmations: run.plan?.verificationItems.filter((v) => v.priority === 'BEFORE_START').length ?? 0,
        totalConfirmations: run.plan?.verificationItems.length ?? 0,
        financeItems: run.plan?.section4.financeItems.map((f) => `${f.key} ${f.method} 入力${f.inputs.length}件`) ?? [],
        estimates: run.estimates.map((e) => `${e.itemKey} ${e.status} ${e.amountYen ?? ''} 不足:${e.missing.join('/')}`),
        edits,
      };
      writeFileSync(path.join(dir, `${id}-check.json`), JSON.stringify(check, null, 2), 'utf8');
      expect(apiErrors).toEqual([]);
    });
  }
});

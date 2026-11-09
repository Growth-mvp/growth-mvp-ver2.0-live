import { buildPlanApiSchema } from '@/lib/stage4/plan/apiSchema';
import { PlanDraftSchema } from '@/lib/stage4/plan/types';
import { COMMERCIAL_GOLDEN_DRAFT } from '../fixtures/commercial.golden';

/** 厳格モードで使う範囲（type / enum / anyOf / required / additionalProperties / items）だけを検査する最小の検証器 */
function conforms(schema: any, value: any, path = '$'): string[] {
  if (schema.anyOf) {
    const results = schema.anyOf.map((s: any) => conforms(s, value, path));
    return results.some((r: string[]) => r.length === 0) ? [] : [`${path}: anyOf に合わない`];
  }
  const errs: string[] = [];
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const typeOk = types.some((t) => t === actual || (t === 'number' && actual === 'integer') || (t === 'integer' && actual === 'integer'));
  if (!typeOk) return [`${path}: 型が ${actual}（期待 ${types.join('|')}）`];
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: 列挙外の値 ${JSON.stringify(value)}`);
  if (actual === 'object' && schema.properties) {
    for (const k of Object.keys(value)) if (!(k in schema.properties)) errs.push(`${path}: 未定義の項目 ${k}`);
    for (const r of schema.required ?? []) if (!(r in value)) errs.push(`${path}: 必須の項目 ${r} が無い`);
    for (const [k, sub] of Object.entries(schema.properties)) if (k in value) errs.push(...conforms(sub, value[k], `${path}.${k}`));
  }
  if (actual === 'array' && schema.items) value.forEach((v: any, i: number) => errs.push(...conforms(schema.items, v, `${path}[${i}]`)));
  return errs;
}

describe('API向けスキーマと Zod 検証の整合', () => {
  const api = buildPlanApiSchema();

  it('期待出力（ゴールデン）は、API向けスキーマにも Zod にも適合する', () => {
    expect(conforms(api.schema, COMMERCIAL_GOLDEN_DRAFT)).toEqual([]);
    expect(() => PlanDraftSchema.parse(COMMERCIAL_GOLDEN_DRAFT)).not.toThrow();
  });

  it('余分な項目（未知のキー）は、API向けスキーマでも弾かれる', () => {
    const bad = { ...COMMERCIAL_GOLDEN_DRAFT, trialInvestmentCost: 1 };
    expect(conforms(api.schema, bad).join(' ')).toContain('未定義の項目 trialInvestmentCost');
  });

  it('必須の項目が無いと弾かれる（確認事項の形式違いなど）', () => {
    const bad = JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT));
    delete bad.verificationItems[0].priority;
    expect(conforms(api.schema, bad).join(' ')).toContain('必須の項目 priority');
  });

  it('列挙外の値は弾かれる（財務の役割の名称など）', () => {
    const bad = JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT));
    bad.section4.financeItems[0].inputs[0].role = 'TRIAL_COST';
    expect(conforms(api.schema, bad).join(' ')).toContain('列挙外の値');
  });

  it('仮期間の文字列は、API向けスキーマでも Zod でも弾かれる（同じ向きの判定）', () => {
    const bad = { ...COMMERCIAL_GOLDEN_DRAFT, provisionalPeriod: '2026-12〜2027-09' };
    expect(conforms(api.schema, bad).length).toBeGreaterThan(0);
    expect(() => PlanDraftSchema.parse(bad)).toThrow();
  });
});

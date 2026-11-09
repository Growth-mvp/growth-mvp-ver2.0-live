/* 保存済みの実AI出力（Phase 2C：eval/plan/results-live）を使う回帰テスト。API は呼び出さない。
 * 確認すること：
 * 1. 旧形式の出力を移行すると、v2 のスキーマで解析できる（スキーマ違反の解消）
 * 2. 財務の入力は、移行で消えない（名称・根拠・値の欄を保持）
 * 3. 既存KPIは保護される（出力に含まれず、入力の内容のまま）
 * 4. 未確認の金額は確定扱いにならない
 * 5. 移行で補えない内容（障害・行動の因果）は、欠落として検出される（補わない）
 * 行動と成果の因果の改善そのものは、改善後のプロンプトで再生成して評価する必要がある（ここでは判定しない）。 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { runExecutionPlanEngine } from '@/lib/stage4/plan/generate';
import { migrateV1ToV2 } from '@/lib/stage4/plan/migrate';
import { PlanDraftSchema } from '@/lib/stage4/plan/types';
import { CROSSDEPT_INPUT } from '../quality/crossdept';
import { GROWTH_INPUT } from '../quality/growth';
import { PROFIT_INPUT } from '../quality/profit';
import type { RawPlanInput } from '@/lib/stage4/plan/source';

const dir = path.join(__dirname, '..', 'results-live');
const cases: Array<[string, RawPlanInput, number]> = [
  ['growth', GROWTH_INPUT, 2],
  ['profit', PROFIT_INPUT, 2],
  ['crossdept', CROSSDEPT_INPUT, 3],
];
/** 移行で補えない内容の欠落だけが残ることを期待する（それ以外のエラーは許さない） */
/* REGULATORY_CONSTRAINT_NOT_ADDRESSED：旧版の成長戦略型は、入力の規制の論点を反映していない（Phase 2I の新しい検証で検出される既知の欠落） */
const ALLOWED_CONTENT_GAPS = ['OBSTACLES_MISSING', 'MECHANISM_MISSING', 'REGULATORY_CONSTRAINT_NOT_ADDRESSED'];

const savedJson = (id: string) =>
  JSON.parse(readFileSync(path.join(dir, `${id}-ENGINE.json`), 'utf8')).output.match(/\{[\s\S]*\}/)[0];

(existsSync(path.join(dir, 'summary.json')) ? describe : describe.skip)('保存済みの実AI出力（3件）の回帰テスト', () => {
  it.each(cases)('%s：移行後の出力が v2 のスキーマで解析でき、確定KPIは出力されていない', (id) => {
    const { json } = migrateV1ToV2(JSON.parse(savedJson(id)));
    expect(() => PlanDraftSchema.parse(json)).not.toThrow();
    expect(json.section3.kpis.every((k: { key: string }) => /^A\d+$/.test(k.key))).toBe(true);
  });

  it.each(cases)('%s：財務入力の件数と名称が移行の前後で一致する（削除されない）', (id) => {
    const orig = JSON.parse(savedJson(id));
    const { json, log } = migrateV1ToV2(orig);
    const origNames = orig.section4.financeItems.flatMap((f: any) => Object.keys(f.inputs));
    const newLabels = json.section4.financeItems.flatMap((f: any) => f.inputs.map((i: any) => i.label));
    expect(newLabels).toHaveLength(origNames.length);
    for (const name of origNames) {
      expect(log.some((n) => n.path.endsWith(`.inputs.${name}`))).toBe(true);
    }
  });

  it.each(cases)('%s：確認事項の本文と根拠は、移行で失われない', (id) => {
    const orig = JSON.parse(savedJson(id));
    const { json } = migrateV1ToV2(orig);
    const texts = json.verificationItems.map((v: { item: string }) => v.item);
    orig.verificationItems.forEach((v: string | { item: string }) => {
      expect(texts).toContain(typeof v === 'string' ? v : v.item);
    });
  });

  it.each(cases)('%s：エンジン検証の結果は、内容の欠落（障害・因果）だけになり、スキーマ違反と未確認の確定は無い', async (id, raw, stage3Count) => {
    const { json } = migrateV1ToV2(JSON.parse(savedJson(id)));
    const run = await runExecutionPlanEngine({ raw, callModel: async () => JSON.stringify(json) });
    const codes = run.issues.filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes).not.toContain('SCHEMA_INVALID');
    expect(codes.filter((c) => !ALLOWED_CONTENT_GAPS.includes(c))).toEqual([]);
    expect(run.plan!.section3.protectedKpis).toHaveLength(stage3Count);
    expect(run.plan!.section4.financeItems.every((f) => f.inputs.every((i) => i.value === null))).toBe(true);
  });

  it.each(cases)('%s：障害と行動の因果が無いことは、欠落として検出される（補っていない）', async (id, raw) => {
    const { json } = migrateV1ToV2(JSON.parse(savedJson(id)));
    const run = await runExecutionPlanEngine({ raw, callModel: async () => JSON.stringify(json) });
    expect(run.issues.map((i) => i.code)).toContain('OBSTACLES_MISSING');
    expect(run.issues.filter((i) => i.code === 'MECHANISM_MISSING').length).toBe(json.section2.actions.length);
  });
});

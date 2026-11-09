import { COMMERCIAL_GOLDEN_DRAFT } from './fixtures/commercial.golden';
import { assemblePlan } from '@/lib/stage4/plan/assemble';
import { buildPlanContext } from '@/lib/stage4/plan/context';
import { buildPlanSource } from '@/lib/stage4/plan/source';
import { COMMERCIAL_INPUT } from './fixtures/commercial';
import { PlanDraftSchema } from '@/lib/stage4/plan/types';
import { validatePlan } from '@/lib/stage4/plan/validate';
import {
  summarizeEngineBurden,
  countLegacyEdits,
  judgeRun,
  PLAN_CRITERIA,
  type CriterionId,
  type HumanSheet,
} from './evaluation';

const full = (v: number): Partial<Record<CriterionId, number>> =>
  Object.fromEntries(PLAN_CRITERIA.map((c) => [c.id, v])) as Partial<Record<CriterionId, number>>;

const sheet = (caseId: string, system: 'LEGACY' | 'ENGINE', v: number): HumanSheet => ({
  caseId,
  system,
  scores: full(v),
  scorer: 'tester',
  comment: '',
});

const window = { kpiFrom: '2027-02', kpiTo: '2027-05', stepFrom: '2026-12', stepTo: '2027-02' };

describe('修正箇所の数え方', () => {
  it('既存の出力：担当が空・期限の窓の外・KPI件数の不一致を、直す箇所として数える', () => {
    const r = countLegacyEdits(
      {
        kpis: [
          { label: 'a', target: 1, unit: '件', due: '2027-09', owner: '' },
          { label: 'b', target: 'x' as unknown as number, unit: '件', due: '2027-03', owner: '鈴木' },
        ],
        steps: [{ title: 's', dueYm: '2027-06' }],
        assumptionBasis: { x: 'HYPOTHESIS' },
        verificationItems: ['確認1'],
      },
      { stage3KpiCount: 3, window }
    );
    expect(r.fix).toBe(1 + 1 + 1 + 1 + 1); // 件数 + 担当 + 期限 + 目標 + ステップ期限
    expect(r.confirm).toBe(2);
  });

  it('新エンジン：プログラムの検証エラー、利用者の修正、利用者の確認を区別して数える', () => {
    const { source, scope } = buildPlanSource(COMMERCIAL_INPUT);
    const ctx = buildPlanContext(source, scope);
    const plan = assemblePlan(PlanDraftSchema.parse(JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT))), {
      ...ctx,
      endYm: ctx.endYm as string,
      periodBasis: 'STAGE3_KPI_DUE',
    });
    const issues = validatePlan(plan, ctx);
    const b = summarizeEngineBurden(plan, issues);
    expect(b.machineErrors.total).toBe(issues.filter((i) => i.severity === 'error').length);
    expect(b.userMustFix).toEqual(expect.arrayContaining(['責任者を決める']));
    expect(b.userMustFix.filter((x) => x.startsWith('財務 F1'))).toHaveLength(1);
    expect(b.userConfirmBeforeStart).toHaveLength(3);
    expect(b.userConfirmLater.length).toBeGreaterThan(0);
  });

  it('同じ原因の機械的エラーは、個別の利用者修正として数えない', () => {
    const { source, scope } = buildPlanSource(COMMERCIAL_INPUT);
    const ctx = buildPlanContext(source, scope);
    const plan = assemblePlan(PlanDraftSchema.parse(JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT))), {
      ...ctx,
      endYm: ctx.endYm as string,
      periodBasis: 'STAGE3_KPI_DUE',
    });
    plan.section1.companyResult.sourceRefs = ['[S1-FIN]'];
    const issues = validatePlan(plan, ctx);
    const b = summarizeEngineBurden(plan, issues);
    expect(b.machineErrors.byCode['SOURCE_REF_UNKNOWN']).toBe(1);
    expect(b.userMustFix.some((x) => x.includes('SOURCE_REF'))).toBe(false);
  });
});

describe('judgeRun（合否）', () => {
  const caseIds = ['c1', 'c2', 'c3'];
  const zeroEdits = { fix: 0, confirm: 0, details: [] };

  it('人の採点が無ければ、JSONが正常でも不合格', () => {
    const r = judgeRun({
      sheets: [sheet('c1', 'ENGINE', 5)],
      caseIds,
      engineErrors: {},
      edits: Object.fromEntries(caseIds.map((id) => [id, { legacy: zeroEdits, engine: zeroEdits }])),
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toContain('採点が無い');
  });

  it('エンジンが全項目4点以上で、既存を上回り、検証エラーが無ければ合格', () => {
    const sheets = caseIds.flatMap((id) => [sheet(id, 'LEGACY', 3), sheet(id, 'ENGINE', 4)]);
    const r = judgeRun({
      sheets,
      caseIds,
      engineErrors: {},
      edits: Object.fromEntries(caseIds.map((id) => [id, { legacy: { ...zeroEdits, fix: 2 }, engine: zeroEdits }])),
    });
    expect(r.reasons).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('エンジンの検証エラーが1件でもあれば不合格', () => {
    const sheets = caseIds.flatMap((id) => [sheet(id, 'LEGACY', 3), sheet(id, 'ENGINE', 5)]);
    const r = judgeRun({
      sheets,
      caseIds,
      engineErrors: { c2: 1 },
      edits: Object.fromEntries(caseIds.map((id) => [id, { legacy: zeroEdits, engine: zeroEdits }])),
    });
    expect(r.pass).toBe(false);
  });

  it('2点以下の項目があれば不合格', () => {
    const sheets = caseIds.flatMap((id) => [sheet(id, 'LEGACY', 3), sheet(id, 'ENGINE', id === 'c3' ? 2 : 5)]);
    const r = judgeRun({
      sheets,
      caseIds,
      engineErrors: {},
      edits: Object.fromEntries(caseIds.map((id) => [id, { legacy: zeroEdits, engine: zeroEdits }])),
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toContain('2点以下');
  });

  it('修正箇所が既存より多ければ不合格', () => {
    const sheets = caseIds.flatMap((id) => [sheet(id, 'LEGACY', 3), sheet(id, 'ENGINE', 5)]);
    const r = judgeRun({
      sheets,
      caseIds,
      engineErrors: {},
      edits: Object.fromEntries(caseIds.map((id) => [id, { legacy: zeroEdits, engine: { fix: 2, confirm: 0, details: [] } }])),
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toContain('修正箇所');
  });
});

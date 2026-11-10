import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { DEEPEN_INPUT } from '@/eval/plan/fixtures/deepen';
import { HIRE_INPUT } from '@/eval/plan/fixtures/hire';
import { buildPlanSource } from './source';
import { PlanScopeError } from './scope';
import { PlanSourceSchema } from './types';

describe('buildPlanSource（情報の取得と照合）', () => {
  it('商業施設: 対象プロジェクトのSTAGE3 KPIと戦略ブリッジを取り込む', () => {
    const { source, scope } = buildPlanSource(COMMERCIAL_INPUT);
    expect(scope.departmentName).toBe('営業部');
    expect(source.stage3.project.kpis.map((k) => k.id)).toEqual(['fx-kpi-proposals', 'fx-kpi-days']);
    expect(source.stage3.bridge?.keyThemes).toContain('商業施設の改装提案を強化する');
    expect(source.stage1.financeYears[0]).toMatchObject({ year: 2025, revenueMYen: 1200, operatingIncomeMYen: 60 });
    expect(source.stage1.operatingMarginPct).toBe(5);
  });

  it('番号のないSTAGE3 KPIは、順番から一時的な番号を付けて、入力の検証を通す（STAGE3は変えない）', () => {
    const input = JSON.parse(JSON.stringify(COMMERCIAL_INPUT)) as typeof COMMERCIAL_INPUT;
    const projects = (input.strategy.departments ?? []).flatMap(
      (d) => (d.projects ?? []) as Array<{ okrsV2?: Array<{ id: string }> }>
    );
    for (const p of projects) if (p.okrsV2?.[0]) p.okrsV2[0].id = '';
    const { source } = buildPlanSource(input);
    expect(source.stage3.project.kpis[0]?.id).toBe('unnumbered-kpi-1');
    expect(PlanSourceSchema.safeParse(source).success).toBe(true);
  });

  it('他部門の施策は、対象部門を除いて取り込む', () => {
    const { source } = buildPlanSource(COMMERCIAL_INPUT);
    expect(source.stage3.otherDepartments.map((d) => d.name)).toEqual(['設計部']);
  });

  it('戦略ブリッジが無い場合は null のまま扱う', () => {
    const { source } = buildPlanSource(HIRE_INPUT);
    expect(source.stage3.bridge).toBeNull();
    expect(source.stage3.project.ownerName).toBeNull();
  });

  it('所属企業が違う場合は COMPANY_MISMATCH で拒否する', () => {
    expect(() =>
      buildPlanSource({ ...COMMERCIAL_INPUT, membershipCompanyId: 'fx-company-logistics' })
    ).toThrow(PlanScopeError);
    try {
      buildPlanSource({ ...COMMERCIAL_INPUT, membershipCompanyId: 'fx-company-logistics' });
    } catch (e) {
      expect((e as PlanScopeError).reason).toBe('COMPANY_MISMATCH');
    }
  });

  it('要求された戦略IDが違う場合は STRATEGY_MISMATCH で拒否する', () => {
    try {
      buildPlanSource({ ...COMMERCIAL_INPUT, requestedStrategyId: 'other' });
      throw new Error('拒否されるべき');
    } catch (e) {
      expect((e as PlanScopeError).reason).toBe('STRATEGY_MISMATCH');
    }
  });

  it('プロジェクトが戦略に存在しない場合は PROJECT_NOT_IN_STRATEGY で拒否する', () => {
    try {
      buildPlanSource({ ...COMMERCIAL_INPUT, requestedProjectId: 'fx-proj-missing' });
      throw new Error('拒否されるべき');
    } catch (e) {
      expect((e as PlanScopeError).reason).toBe('PROJECT_NOT_IN_STRATEGY');
    }
  });

  it('他社のプロジェクトIDを指定しても、自社の戦略内に無ければ拒否する', () => {
    expect(() => buildPlanSource({ ...DEEPEN_INPUT, requestedProjectId: 'fx-proj-renovation' })).toThrow(PlanScopeError);
  });
});

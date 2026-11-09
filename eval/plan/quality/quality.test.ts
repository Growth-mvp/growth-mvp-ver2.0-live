import { buildPlanContext } from '@/lib/stage4/plan/context';
import { buildExecutionPlanPrompt } from '@/lib/stage4/plan/prompt';
import { buildPlanSource, type RawPlanInput } from '@/lib/stage4/plan/source';
import { buildLegacyRequest } from '../legacy/legacyRequest';
import { CROSSDEPT_INPUT } from './crossdept';
import { GROWTH_INPUT } from './growth';
import { PROFIT_INPUT } from './profit';

const cases: Array<[string, RawPlanInput, { basis: string | null; endYm: string | null; kpiCount: number }]> = [
  ['成長戦略型', GROWTH_INPUT, { basis: 'COMPANY_PLAN', endYm: '2028-03', kpiCount: 2 }],
  ['収益改善型', PROFIT_INPUT, { basis: 'STAGE3_KPI_DUE', endYm: '2027-09', kpiCount: 2 }],
  ['組織横断型', CROSSDEPT_INPUT, { basis: null, endYm: null, kpiCount: 3 }],
];

describe.each(cases)('品質評価セット：%s', (_name, raw, expected) => {
  const { source, scope } = buildPlanSource(raw);
  const ctx = buildPlanContext(source, scope);

  it('入力の照合が通り、確定KPIを持つ', () => {
    expect(ctx.stage3Kpis).toHaveLength(expected.kpiCount);
    expect(ctx.sources.some((s) => s.ref === 'S3-PROJ')).toBe(true);
    expect(ctx.sources.some((s) => s.ref === 'S3-DEPT')).toBe(true);
  });

  it('計画期間の根拠が想定どおり（根拠なしのケースは仮期間をAIに委ねる）', () => {
    expect(ctx.periodBasis).toBe(expected.basis);
    expect(ctx.endYm).toBe(expected.endYm);
  });

  it('戦略の結論（重点テーマ）と財務の根拠が必ず入る', () => {
    expect(ctx.sources.some((s) => s.ref === 'S2-PRIO-1')).toBe(true);
    expect(ctx.sources.some((s) => s.ref === 'S1-FIN')).toBe(true);
  });

  it('既存STAGE4と同じ入力から、既存の草案リクエストを組み立てられる', () => {
    const body = buildLegacyRequest(raw);
    expect(body.projectTitle).toBe(source.stage3.project.title);
    expect(body.sourceKpis).toHaveLength(expected.kpiCount);
    expect(body.companyContext.latestFinance).toBeDefined();
  });

  it('新エンジンのプロンプトが組み立てられ、AIに仮期間を求めるかどうかが期間の根拠で決まる', () => {
    const prompt = buildExecutionPlanPrompt(ctx);
    if (expected.endYm === null) {
      expect(prompt).toContain('provisionalPeriod に');
    } else {
      expect(prompt).toContain(`計画期間：${ctx.startYm} 〜 ${expected.endYm}`);
    }
  });
});

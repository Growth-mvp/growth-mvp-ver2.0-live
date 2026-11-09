import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { CROSSDEPT_INPUT } from '@/eval/plan/quality/crossdept';
import { GROWTH_INPUT } from '@/eval/plan/quality/growth';
import { PROFIT_INPUT } from '@/eval/plan/quality/profit';
import { assemblePlan, protectedKpisOf } from './assemble';
import { buildPlanContext, type PlanContext } from './context';
import { buildExecutionPlanPrompt } from './prompt';
import { buildPlanSource, type RawPlanInput } from './source';
import { PlanDraftSchema, type AssembledPlan, type PeriodBasis } from './types';

type AssemblyCtx = PlanContext & { endYm: string; periodBasis: PeriodBasis };
import { validatePlan } from './validate';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const ctxOf = (raw: RawPlanInput): PlanContext => {
  const { source, scope } = buildPlanSource(raw);
  return buildPlanContext(source, scope);
};

/** 期待出力（商業施設）を、与えた入力の文脈で組み立てる。改変は各テストで行う */
const planFor = (raw: RawPlanInput, mutate?: (draft: any) => void): { plan: AssembledPlan; ctx: PlanContext } => {
  const base = ctxOf(raw);
  const endYm = base.endYm ?? '2027-05';
  const ctx: AssemblyCtx = { ...base, endYm, periodBasis: base.periodBasis ?? 'AI_PROVISIONAL' };
  const draft: any = clone(COMMERCIAL_GOLDEN_DRAFT);
  mutate?.(draft);
  return { plan: assemblePlan(PlanDraftSchema.parse(draft), ctx), ctx };
};

const issuesOf = (raw: RawPlanInput, mutate?: (draft: any) => void) => {
  const { plan, ctx } = planFor(raw, mutate);
  return validatePlan(plan, ctx);
};
const codesOf = (raw: RawPlanInput, mutate?: (draft: any) => void, severity?: 'error' | 'warning') =>
  issuesOf(raw, mutate)
    .filter((i) => !severity || i.severity === severity)
    .map((i) => i.code);

describe('情報の保全（入力から、制約・参照を落とさない）', () => {
  it.each([
    ['成長戦略型', GROWTH_INPUT],
    ['収益改善型', PROFIT_INPUT],
    ['組織横断型', CROSSDEPT_INPUT],
  ])('%s：SWOTの4項目（強み・弱み・機会・脅威）は、関連度に関係なく必ず根拠に入る', (_name, raw) => {
    const refs = ctxOf(raw).sources.map((s) => s.ref);
    expect(refs).toEqual(expect.arrayContaining(['S2-SWOT-S', 'S2-SWOT-W', 'S2-SWOT-O', 'S2-SWOT-T']));
  });

  it('成長戦略型：医療機器の規制に関する脅威が、根拠の本文として入る', () => {
    const threat = ctxOf(GROWTH_INPUT).sources.find((s) => s.ref === 'S2-SWOT-T');
    expect(threat?.text).toContain('医療機器としての規制対応');
  });

  it('他部門のKPIは、参照のみと明記して根拠に入る（確定KPIではない）', () => {
    const other = ctxOf(PROFIT_INPUT).sources.find((s) => s.ref === 'S3-OTHER-1');
    expect(other?.text.startsWith('参照のみ（この計画の確定KPIではない）')).toBe(true);
    expect(other?.text).toContain('主要原材料の調達単価の改善率');
  });

  it('他部門のKPIのラベルを、文脈として保持する（追加KPIとの照合に使う）', () => {
    expect(ctxOf(CROSSDEPT_INPUT).otherDepartmentKpiLabels).toEqual(
      expect.arrayContaining(['既存顧客からの紹介商談数', 'リリース後の重大な不具合件数'])
    );
  });
});

describe('規制・安全の制約が計画から落ちないこと', () => {
  const withThreat = (threat: string): RawPlanInput => {
    const raw = clone(COMMERCIAL_INPUT) as RawPlanInput;
    (raw.strategy as any).threat = threat;
    return raw;
  };

  it('脅威に規制の論点があり、計画のどこにも反映されないとエラー', () => {
    const codes = codesOf(withThreat('医療機器としての規制対応に時間と費用がかかる'), undefined, 'error');
    expect(codes).toContain('REGULATORY_CONSTRAINT_NOT_ADDRESSED');
  });

  it('同じ規制の論点を、確認事項の根拠として参照すればエラーにならない', () => {
    const codes = codesOf(
      withThreat('医療機器としての規制対応に時間と費用がかかる'),
      (d) => d.verificationItems[0].sourceRefs.push('S2-SWOT-T'),
      'error'
    );
    expect(codes).not.toContain('REGULATORY_CONSTRAINT_NOT_ADDRESSED');
  });

  it('規制の論点が無い脅威では、このチェックは働かない', () => {
    const codes = codesOf(COMMERCIAL_INPUT as RawPlanInput, undefined, 'error');
    expect(codes).not.toContain('REGULATORY_CONSTRAINT_NOT_ADDRESSED');
  });
});

describe('KPIと行動の整合・他部門KPIの扱い・重複', () => {
  it('他部門の指標を、この計画の追加KPIにするとエラー', () => {
    const codes = codesOf(PROFIT_INPUT, (d) => {
      d.section3.kpis[0].label = '主要原材料の調達単価の改善率';
    });
    expect(codes).toContain('OTHER_DEPARTMENT_KPI_ADOPTED');
  });

  it('同じ目標値で、ほぼ同じ内容の追加KPIがあると警告（統合の判断を促す）', () => {
    const issues = issuesOf(COMMERCIAL_INPUT as RawPlanInput, (d) => {
      d.section3.kpis[1].label = d.section3.kpis[0].label + '（再掲）';
      d.section3.kpis[1].target = d.section3.kpis[0].target;
      d.section3.kpis[1].unit = d.section3.kpis[0].unit;
      d.section3.kpis[1].targetBasis = 'AI_PROVISIONAL';
    });
    expect(issues.find((i) => i.code === 'KPI_DUPLICATE' && i.path === 'section3.A2')?.severity).toBe('warning');
  });

  it('目標値が違えば、言い換えでも重複とは判定しない', () => {
    const issues = issuesOf(COMMERCIAL_INPUT as RawPlanInput, (d) => {
      d.section3.kpis[1].label = d.section3.kpis[0].label + '（別の測り方）';
      d.section3.kpis[1].target = 999;
      d.section3.kpis[1].targetBasis = 'AI_PROVISIONAL';
    });
    expect(issues.filter((i) => i.code === 'KPI_DUPLICATE' && i.path === 'section3.A2')).toEqual([]);
  });

  it('同じ内容の確認事項を2回書くとエラー', () => {
    const codes = codesOf(COMMERCIAL_INPUT as RawPlanInput, (d) => {
      d.verificationItems[1].item = d.verificationItems[0].item;
    }, 'error');
    expect(codes).toContain('VERIFICATION_DUPLICATE');
  });

  it('「記録の完了率」を成果のKPIとして書くとエラー（活動を成果にしている）', () => {
    const codes = codesOf(COMMERCIAL_INPUT as RawPlanInput, (d) => {
      d.section3.kpis[0].kind = 'COMPANY_RESULT';
      d.section3.kpis[0].label = '日次の記録の完了率';
      d.section3.kpis[0].unit = '%';
    }, 'error');
    expect(codes).toContain('ACTIVITY_KPI_AS_OUTCOME');
  });

  it('同じ「記録の完了率」でも、先行指標（LEADING）なら、エラーにはせず成果への道筋を求める警告にする', () => {
    const issues = issuesOf(COMMERCIAL_INPUT as RawPlanInput, (d) => {
      d.section3.kpis[0].kind = 'LEADING';
      d.section3.kpis[0].label = '日次の記録の完了率';
      d.section3.kpis[0].unit = '%';
    });
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.code)).not.toContain('ACTIVITY_KPI_AS_OUTCOME');
    expect(issues.find((i) => i.code === 'LEADING_PROCESS_KPI')?.severity).toBe('warning');
  });
});

describe('確定KPIの保護と、提案（候補）の表示', () => {
  it('確定KPIの内容は入力の値をそのまま保持する（AIの出力に依存しない）', () => {
    const { ctx } = planFor(CROSSDEPT_INPUT);
    const kpis = protectedKpisOf(ctx);
    expect(kpis.map((k) => k.label)).toEqual(CROSSDEPT_INPUT.strategy.departments!
      .flatMap((d) => d.projects)
      .find((p) => p.id === 'qc-proj-launch')!.okrsV2!.map((k) => k.label));
    expect(kpis.map((k) => k.target)).toEqual([30, 25, 80]);
  });

  it('期限が未設定の確定KPIには、判定時期の候補として計画期間の終わりを付ける（入力にない期限は作らない）', () => {
    const base = ctxOf(CROSSDEPT_INPUT);
    const ctx: AssemblyCtx = { ...base, endYm: '2027-05', periodBasis: 'AI_PROVISIONAL' };
    const plan = assemblePlan(PlanDraftSchema.parse(clone(COMMERCIAL_GOLDEN_DRAFT)), ctx);
    expect(plan.section3.protectedKpis.map((k) => k.due)).toEqual([null, null, null]);
    expect(plan.section3.protectedKpis.map((k) => k.judgeCandidateYm)).toEqual(['2027-05', '2027-05', '2027-05']);
  });

  it('期限が入っている確定KPIには、判定時期の候補を付けない', () => {
    const { plan } = planFor(COMMERCIAL_INPUT as RawPlanInput);
    expect(plan.section3.protectedKpis.every((k) => k.judgeCandidateYm === null)).toBe(true);
  });

  it('AIが担当を決めなかった場合、入力の担当候補の先頭を候補として示す（確定ではない）', () => {
    const base = ctxOf(CROSSDEPT_INPUT);
    const ctx: AssemblyCtx = { ...base, endYm: '2027-05', periodBasis: 'AI_PROVISIONAL' };
    const plan = assemblePlan(PlanDraftSchema.parse(clone(COMMERCIAL_GOLDEN_DRAFT)), ctx);
    expect(plan.responsibleSuggestion).toBe('高橋 亮（仮）');
  });
});

describe('プロンプトの規則（新しい判断の規則が含まれる）', () => {
  const prompt = buildExecutionPlanPrompt(ctxOf(GROWTH_INPUT));

  it('制約（規制・安全・資金）を落とさないよう、脅威と弱みを必ず反映させる', () => {
    expect(prompt).toContain('S2-SWOT-T');
    expect(prompt).toContain('規制や法令の適用有無は、AIが決めつけない');
  });

  it('「合意」と「実施」を区別し、期限は紐づく行動の後にする', () => {
    expect(prompt).toContain('「合意」「決定」「承認」「採用」を測るKPI');
    expect(prompt).toContain('行動がKPIを支えるなら、KPIの期限はその行動の期限以降にする');
  });

  it('他部門のKPIは参照のみとし、追加KPIにしない', () => {
    expect(prompt).toContain('他部門のKPI（入力の「他部門の施策」・S3-OTHER-*）は、この計画の追加KPIに入れない');
  });

  it('記録・算出・会議の完了を成果にしない', () => {
    expect(prompt).toContain('記録・算出・分類・会議・研修の実施や完了は、成果のKPIにしない');
  });

  it('重複を作らず、根拠がある場合だけ仮の提案をする', () => {
    expect(prompt).toContain('同じ内容を測るKPIは作らない');
    expect(prompt).toContain('根拠が無ければ target を null');
    expect(prompt).toContain('候補（仮）。実行前に確定が必要');
  });
});

import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { assemblePlan, protectedKpisOf } from './assemble';
import { buildPlanContext, type PlanContext } from './context';
import { buildPlanSource } from './source';
import { PlanDraftSchema, type AssembledPlan } from './types';
import { findRouteBKeys, periodIssues, validatePlan } from './validate';

const { source, scope } = buildPlanSource(COMMERCIAL_INPUT);
const ctx: PlanContext = buildPlanContext(source, scope);
const endYm = ctx.endYm as string;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const plan = (): AssembledPlan =>
  assemblePlan(PlanDraftSchema.parse(clone(COMMERCIAL_GOLDEN_DRAFT)), {
    ...ctx,
    endYm,
    periodBasis: ctx.periodBasis ?? 'STAGE3_KPI_DUE',
  });
const codes = (p: AssembledPlan) => validatePlan(p, ctx).filter((i) => i.severity === 'error').map((i) => i.code);
const allCodes = (p: AssembledPlan) => validatePlan(p, ctx).map((i) => i.code);

describe('validatePlan（期待出力と、違反の検出）', () => {
  it('期待出力はエラーなしで通る', () => {
    expect(codes(plan())).toEqual([]);
  });

  it('計画期間は、入力の根拠（既存KPIの期限）から決まる', () => {
    expect(ctx.periodBasis).toBe('STAGE3_KPI_DUE');
    expect(plan().period).toEqual({ startYm: '2026-12', endYm: '2027-05', basis: 'STAGE3_KPI_DUE' });
  });

  it('確定KPIは入力の内容をそのまま保持する（S1・S2）', () => {
    const kpis = protectedKpisOf(ctx);
    expect(kpis.map((k) => k.key)).toEqual(['S1', 'S2']);
    expect(kpis[0]).toMatchObject({ stage3KpiId: 'fx-kpi-proposals', label: '改装提案を出した商業施設数', target: 3, unit: '件', due: '2027-02' });
  });

  describe('障害と行動の因果', () => {
    it('障害（obstacles）が無いとエラー', () => {
      const p = plan();
      p.section1.obstacles = [];
      expect(codes(p)).toContain('OBSTACLES_MISSING');
    });

    it('行動に mechanism が無い（null）とエラー', () => {
      const p = plan();
      p.section2.actions[2].mechanism = null;
      expect(codes(p)).toContain('MECHANISM_MISSING');
    });

    it('mechanism が存在しない障害を指すとエラー', () => {
      const p = plan();
      p.section2.actions[0].mechanism!.obstacleRefs = [5];
      expect(codes(p)).toContain('MECHANISM_OBSTACLE_REF_UNKNOWN');
    });

    it('仮説の障害に検証の行動が無いとエラー', () => {
      const p = plan();
      p.section1.obstacles[0] = { ...p.section1.obstacles[0], basis: 'HYPOTHESIS', verifyBy: '' };
      expect(codes(p)).toContain('HYPOTHESIS_WITHOUT_VERIFICATION');
    });

    it('主要な行動が6件を超えると警告（現場社員が読める量に抑える）', () => {
      const p = plan();
      const extra = { ...p.section2.actions[0], order: 6, dependsOn: [] };
      p.section2.actions.push(extra);
      expect(allCodes(p)).toContain('ACTION_COUNT_HIGH');
    });
  });

  describe('活動と成果の区別', () => {
    it('会議・研修・記録などの活動の指標を、成果のKPIにするとエラー', () => {
      const p = plan();
      p.section3.proposedKpis[1] = { ...p.section3.proposedKpis[1], kind: 'COMPANY_RESULT', label: '社内会議の開催回数' };
      expect(codes(p)).toContain('ACTIVITY_KPI_AS_OUTCOME');
    });

    it('同じ活動の指標でも、先行指標（LEADING）なら許される', () => {
      const p = plan();
      p.section3.proposedKpis[0] = { ...p.section3.proposedKpis[0], label: '社内会議の開催回数' };
      expect(codes(p)).not.toContain('ACTIVITY_KPI_AS_OUTCOME');
    });

    it('提案件数を成果のKPIにするとエラー（提案を増やしても受注は増えない）', () => {
      const p = plan();
      p.section3.proposedKpis[1] = { ...p.section3.proposedKpis[1], kind: 'COMPANY_RESULT', label: '改装提案の件数' };
      expect(codes(p)).toContain('ACTIVITY_KPI_AS_OUTCOME');
    });
  });

  describe('確認事項の集約', () => {
    it('実行前の確認事項が3件を超えるとエラー', () => {
      const p = plan();
      p.verificationItems = p.verificationItems.map((v) => ({ ...v, priority: 'BEFORE_START' as const }));
      expect(codes(p)).toContain('CONFIRMATION_OVERLOAD');
    });

    it('確認期限が計画期間の外だとエラー', () => {
      const p = plan();
      p.verificationItems[3] = { ...p.verificationItems[3], confirmBy: '2028-01' };
      expect(codes(p)).toContain('DUE_OUT_OF_PERIOD');
    });
  });

  describe('既存KPIと期限', () => {
    it('追加KPIが既存の確定KPIと同名だとエラー', () => {
      const p = plan();
      p.section3.proposedKpis[0].label = '改装提案を出した商業施設数';
      expect(codes(p)).toContain('KPI_IDENTITY_CONFLICT');
    });

    it('AIが置いた目標値が仮目標になっていないとエラー', () => {
      const p = plan();
      (p.section3.proposedKpis[0] as { targetBasis: string | null }).targetBasis = 'STAGE_DATA';
      expect(codes(p)).toContain('UNCONFIRMED_AS_CONFIRMED');
    });

    it('計画期間の外の期限はエラー', () => {
      const p = plan();
      p.section3.proposedKpis[1].due = '2027-06';
      expect(codes(p)).toContain('DUE_OUT_OF_PERIOD');
    });

    it('追加KPIの期限が、それを支える行動より前だとエラー', () => {
      const p = plan();
      p.section3.proposedKpis[0].due = '2026-12';
      expect(codes(p)).toContain('KPI_BEFORE_ACTION');
    });

    it('既存KPIの期限が行動より前だと、エラーではなく確認事項（警告）になる', () => {
      const p = plan();
      p.section3.protectedKpis[0].due = '2026-12';
      const issues = validatePlan(p, ctx);
      expect(issues.find((i) => i.code === 'STAGE3_KPI_TIMING_CONFLICT')?.severity).toBe('warning');
      expect(codes(p)).toEqual([]);
    });

    it('先行行動の期限が後続より後だとエラー', () => {
      const p = plan();
      p.section2.actions[3].dueYm = '2026-12';
      expect(codes(p)).toContain('DUE_ORDER_CONFLICT');
    });

    it('存在しないKPIキーを参照するとエラー', () => {
      const p = plan();
      p.section2.actions[0].supportsKpiKeys = ['S9'];
      expect(codes(p)).toContain('KPI_REF_UNKNOWN');
    });

    it('入力にない担当者名はエラー', () => {
      const p = plan();
      p.section3.proposedKpis[0].owner = '架空の人物';
      expect(codes(p)).toContain('OWNER_NOT_IN_CONTEXT');
    });
  });

  describe('財務入力', () => {
    it('顧客成果のKPIを金額単位にするとエラー（顧客成果と自社財務の混同）', () => {
      const p = plan();
      p.section3.proposedKpis[2].unit = '百万円';
      expect(codes(p)).toContain('CUSTOMER_FINANCE_MIX');
    });

    it('顧客成果のKPIを財務効果の根拠にするとエラー', () => {
      const p = plan();
      p.section4.financeItems[0].basedOnKpiKeys = ['A3'];
      expect(codes(p)).toContain('CUSTOMER_FINANCE_MIX');
    });

    it('根拠の無い値（UNCONFIRMED）に数値が入っているとエラー', () => {
      const p = plan();
      const wr = p.section4.financeItems[0].inputs.find((i) => i.role === 'WIN_RATE')!;
      wr.value = 33;
      expect(codes(p)).toContain('UNCONFIRMED_AS_VALUE');
    });

    it('AIが利用者の確認済み（USER_CONFIRMED）を付けているとエラー', () => {
      const p = plan();
      p.section4.financeItems[0].inputs[0].confirmState = 'USER_CONFIRMED';
      expect(codes(p)).toContain('AI_SET_USER_CONFIRMED');
    });

    it('自由項目（FREE）なのに、算定の考え方が無いとエラー', () => {
      const p = plan();
      p.section4.financeItems[0].method = 'FREE';
      p.section4.financeItems[0].freeNote = null;
      expect(codes(p)).toContain('FREE_NOTE_MISSING');
    });

    it('自由項目（FREE）なのに、算定に必要な入力が1つも列挙されていないとエラー', () => {
      const p = plan();
      p.section4.financeItems[0].method = 'FREE';
      p.section4.financeItems[0].freeNote = '算定式：利益 = 売上 − 原価（原価が不足）';
      p.section4.financeItems[0].inputs = [];
      expect(codes(p)).toContain('FINANCE_INPUTS_MISSING');
    });

    it('開始前の確認事項の期限が、計画の開始月より後だとエラー', () => {
      const p = plan();
      p.verificationItems[0].priority = 'BEFORE_START';
      p.verificationItems[0].confirmBy = endYm;
      expect(codes(p)).toContain('BEFORE_START_AFTER_START');
    });

    it('開始前の確認事項の期限が、開始月と同じなら通る', () => {
      const p = plan();
      p.verificationItems[0].priority = 'BEFORE_START';
      p.verificationItems[0].confirmBy = ctx.startYm;
      expect(codes(p)).not.toContain('BEFORE_START_AFTER_START');
    });

    it('実施事項に成果物・判断条件・段階のどれかが無いとエラー（契約項目の欠落）', () => {
      const p = plan();
      p.section2.actions[0].deliverable = null;
      expect(codes(p)).toContain('ACTION_CONTRACT_MISSING');
    });

    it('収益化の段階が、先の行動より前に戻るとエラー', () => {
      const p = plan();
      p.section2.actions[0].valueStage = 'PAID_CONTRACT';
      p.section2.actions[1].valueStage = 'ORDER_INTENT';
      expect(codes(p)).toContain('STAGE_ORDER_CONFLICT');
    });

    it('実施事項が「整理する」などの語だけなら、エラー（何をするか分からない）', () => {
      const p = plan();
      p.section2.actions[0].title = '整理する';
      expect(codes(p)).toContain('ACTION_TITLE_VAGUE');
    });

    it('限界利益を売上増加（REVENUE_UP）にすると、誤分類としてエラー', () => {
      const p = plan();
      const f = p.section4.financeItems[0];
      f.label = '案件別の限界利益';
      f.kind = 'REVENUE_UP';
      expect(codes(p)).toContain('FINANCE_MISCLASSIFIED');
    });

    it('財務効果として扱わない項目（NOT_FINANCIAL）は、算定式を持てず、理由が必要', () => {
      const p = plan();
      const f = p.section4.financeItems[0];
      f.label = '案件別の限界利益';
      f.kind = 'NOT_FINANCIAL';
      f.method = 'DIRECT_AMOUNT';
      expect(codes(p)).toContain('NOT_FINANCIAL_METHOD_CONFLICT');
      f.method = 'FREE';
      f.freeNote = null;
      expect(codes(p)).toContain('FREE_NOTE_MISSING');
      f.freeNote = '算定式：限界利益 = 売上 − 直接原価。直接原価が不足';
      expect(codes(p)).not.toContain('FINANCE_MISCLASSIFIED');
    });

    it('方式に必要な役割が無いと警告（算定できない理由が見える）', () => {
      const p = plan();
      p.section4.financeItems[0].inputs = p.section4.financeItems[0].inputs.filter((i) => i.role !== 'WIN_RATE');
      expect(allCodes(p)).toContain('FINANCE_ROLE_MISSING');
    });

    it('方式の計算に入らない役割の入力に値があると警告', () => {
      const p = plan();
      p.section4.financeItems[1].inputs.push({
        role: 'YIELD_RATE',
        label: '歩留まり',
        value: 90,
        unit: '%',
        basis: 'PROPOSAL',
        confirmState: 'AI_PROPOSED',
        sourceRefs: [],
      });
      expect(allCodes(p)).toContain('FINANCE_INPUT_NOT_USED');
    });

    it('入力に根拠参照が無いのに STAGE_DATA とされているとエラー', () => {
      const p = plan();
      p.section4.financeItems[1].inputs[0].basis = 'STAGE_DATA';
      expect(codes(p)).toContain('CLAIM_UNSOURCED');
    });
  });

  describe('責任者・参照', () => {
    it('入力にない参照IDはエラー', () => {
      const p = plan();
      p.section1.companyResult.sourceRefs = ['S9-NOT-EXIST'];
      expect(codes(p)).toContain('SOURCE_REF_UNKNOWN');
    });

    it('STAGE_DATA と書きながら根拠参照が無いとエラー', () => {
      const p = plan();
      p.section1.companyResult = { text: '売上が増える', basis: 'STAGE_DATA', sourceRefs: [] };
      expect(codes(p)).toContain('CLAIM_UNSOURCED');
    });

    it('確定KPIの確認事項が存在しないKPIを指すとエラー', () => {
      const p = plan();
      p.section3.stage3Review = [{ stage3KpiId: 'nope', concern: '矛盾の可能性', sourceRefs: [] }];
      expect(codes(p)).toContain('STAGE3_REVIEW_UNKNOWN_KPI');
    });

    it('仮期間が規則の範囲（3〜12か月）の外だとエラー', () => {
      const p = plan();
      p.period = { startYm: '2026-12', endYm: '2026-12', basis: 'AI_PROVISIONAL' };
      expect(periodIssues(p).map((i) => i.code)).toContain('PERIOD_PROVISIONAL_OUT_OF_RANGE');
    });

    it('経路Bの項目名（financeEffect など）がAI出力に現れるとエラー', () => {
      expect(findRouteBKeys({ financeEffect: { confirmed: true } })).toEqual(
        expect.arrayContaining(['$.financeEffect', '$.financeEffect.confirmed'])
      );
    });

    it('責任者が未設定なら、警告として実行開始不可を示す', () => {
      expect(allCodes(plan())).toContain('OWNER_UNSET');
    });
  });
});

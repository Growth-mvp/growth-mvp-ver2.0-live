import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { HIRE_INPUT } from '@/eval/plan/fixtures/hire';
import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { runExecutionPlanEngine } from './generate';
import { PlanScopeError } from './scope';
import type { RawPlanInput } from './source';

const golden = () => JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT));
const respond = (d: unknown) => async () => JSON.stringify(d);
const errorsOf = (r: { issues: Array<{ severity: string; code: string }> }) =>
  r.issues.filter((i) => i.severity === 'error').map((i) => i.code);

/** 期限の根拠を消した入力（計画期間を AI が仮に決める場合） */
function withoutPeriodBasis(raw: RawPlanInput): RawPlanInput {
  const copy = JSON.parse(JSON.stringify(raw)) as RawPlanInput;
  delete copy.strategy.periodEndYear;
  for (const d of copy.strategy.departments as Array<{ projects: Array<{ okrsV2?: Array<{ due?: string }> }> }>) {
    for (const p of d.projects) for (const k of p.okrsV2 ?? []) delete k.due;
  }
  return copy;
}

describe('runExecutionPlanEngine', () => {
  it('期待出力を返すと、エラーなしで通り、財務は未確認の試算になる', async () => {
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: respond(golden()) });
    expect(errorsOf(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.plan!.section3.protectedKpis.map((k) => k.key)).toEqual(['S1', 'S2']);
    expect(r.estimates.map((e) => e.status)).toEqual(['INPUT_MISSING', 'INPUT_MISSING']);
    expect(r.executionStartable).toBe(false);
  });

  it('モデルに渡すプロンプトには、判断原則・確定KPI（S）・計画期間・担当候補が入る', async () => {
    const callModel = jest.fn(async (_p: string) => JSON.stringify(golden()));
    await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel });
    const prompt = callModel.mock.calls[0][0];
    expect(prompt).toContain('顧客に選ばれる理由');
    expect(prompt).toContain('S1（stage3KpiId: fx-kpi-proposals）');
    expect(prompt).toContain('計画期間：2026-12 〜 2027-05');
    expect(prompt).toContain('budget は必ず null');
    expect(prompt).toContain('確定KPIは出力に含めない');
  });

  it('AIが確定KPIを出力した場合は、契約違反（SCHEMA_INVALID）で失敗する', async () => {
    const d = golden();
    d.section3.kpis.push({
      key: 'S1',
      origin: 'STAGE3',
      stage3KpiId: 'fx-kpi-proposals',
      kind: 'LEADING',
      label: '改装提案を出した商業施設数',
      target: 99,
      unit: '件',
      targetBasis: 'STAGE_DATA',
      due: '2027-02',
      owner: null,
      measurement: 'x',
      supportsActionOrders: [],
    });
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: respond(d) });
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe('SCHEMA_INVALID');
  });

  it('AIが確定KPIの目標値を書き換える余地が無い（出力に確定KPIが無い）', async () => {
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: respond(golden()) });
    expect(r.plan!.section3.protectedKpis[0].target).toBe(3);
    expect(r.plan!.section3.protectedKpis[1].target).toBe(30);
  });

  it('既存KPIと戦略の矛盾の懸念は、確認事項として残る（変更はしない）', async () => {
    const d = golden();
    d.section3.stage3Review = [
      { stage3KpiId: 'fx-kpi-days', concern: '決定までの日数が、提案件数の増加と両立しにくい', sourceRefs: [] },
    ];
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: respond(d) });
    expect(r.ok).toBe(true);
    expect(r.plan!.section3.stage3Review[0].concern).toContain('両立');
    expect(r.plan!.section3.protectedKpis[1].target).toBe(30);
  });

  it('財務入力の中の未知のキーも、黙って消されずスキーマ違反になる', async () => {
    const d = golden();
    d.section4.financeItems[0].inputs[0] = { ...d.section4.financeItems[0].inputs[0], trialInvestmentCost: 1000 };
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: respond(d) });
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe('SCHEMA_INVALID');
    expect(r.issues[0].message).toContain('trialInvestmentCost');
  });

  it('JSONが無い応答は JSON_NOT_FOUND で失敗する', async () => {
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: async () => '申し訳ありません' });
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe('JSON_NOT_FOUND');
    expect(r.plan).toBeNull();
  });

  it('スキーマに合わない応答は SCHEMA_INVALID で失敗する', async () => {
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: respond({ ...golden(), unknownField: 1 }) });
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe('SCHEMA_INVALID');
  });

  it('入力に無い担当者名は、エラーになる', async () => {
    const d = golden();
    d.section5.responsible.name = '架空の人物';
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: respond(d) });
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain('OWNER_NOT_IN_CONTEXT');
  });

  it('スコープ違反は、モデルを呼ぶ前に例外で止める', async () => {
    const callModel = jest.fn(async () => '{}');
    await expect(
      runExecutionPlanEngine({ raw: { ...COMMERCIAL_INPUT, membershipCompanyId: 'other' }, callModel })
    ).rejects.toBeInstanceOf(PlanScopeError);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('期限の根拠が無い入力では、AIの仮期間を使い、範囲内なら通る', async () => {
    const d = golden();
    d.provisionalPeriod = { endYm: '2027-05', reason: '既存KPIに期限が無いため、6か月を仮定' };
    const r = await runExecutionPlanEngine({ raw: withoutPeriodBasis(COMMERCIAL_INPUT), callModel: respond(d) });
    expect(errorsOf(r)).toEqual([]);
    expect(r.plan!.period).toEqual({ startYm: '2026-12', endYm: '2027-05', basis: 'AI_PROVISIONAL' });
  });

  it('期限の根拠が無いのに仮期間を出さない場合は PERIOD_PROPOSAL_MISSING で失敗する', async () => {
    const r = await runExecutionPlanEngine({ raw: withoutPeriodBasis(COMMERCIAL_INPUT), callModel: respond(golden()) });
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe('PERIOD_PROPOSAL_MISSING');
  });

  it('AIの仮期間が範囲（3〜12か月）の外なら失敗する', async () => {
    const d = golden();
    d.provisionalPeriod = { endYm: '2026-12', reason: '短すぎる' };
    const r = await runExecutionPlanEngine({ raw: withoutPeriodBasis(COMMERCIAL_INPUT), callModel: respond(d) });
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain('PERIOD_PROVISIONAL_OUT_OF_RANGE');
  });

  it('戦略ブリッジが無く、確定KPIも担当者も無い入力でも、確定KPIは必ず組み込まれ、実行不可を示す', async () => {
    const d = golden();
    d.section3.kpis = [];
    d.section2.actions = [
      { order: 1, title: '募集する職種と人数を決める', ownerRole: '人事部', dueYm: '2026-12', dependsOn: [], basis: 'PROPOSAL', sourceRefs: [], supportsKpiKeys: ['S1'], mechanism: null },
    ];
    d.section4.financeItems = [];
    d.section5.roles = [{ unit: '人事部', role: '募集と面接', actionOrders: [1] }];
    d.section5.risks = [];
    const r = await runExecutionPlanEngine({ raw: HIRE_INPUT, callModel: respond(d) });
    expect(r.plan!.section3.protectedKpis.map((k) => k.key)).toEqual(['S1', 'S2']);
    expect(r.executionStartable).toBe(false);
  });
});

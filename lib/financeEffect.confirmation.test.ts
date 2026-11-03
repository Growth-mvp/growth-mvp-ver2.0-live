import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { applyProjectImpactPatch } from '@/lib/okr/projectImpactPatch';
import { guardFinanceEffectConfirmation } from './financeEffect';

const M = 1_000_000;
const CONFIRMED_AT = '2026-11-01T00:00:00.000Z';

const confirmed = {
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 20 * M,
  amountBasis: 'ANNUAL',
  startYm: '2027-04',
  endYm: '2028-03',
  sourceNote: '架空の算定根拠',
  scopeNote: '首都圏',
  source: 'USER_INPUT',
  confirmed: true,
  confirmedAt: CONFIRMED_AT,
  overlapNote: '既存の法人顧客と重複しない想定',
} as const;

function stateWith(effect: Record<string, any> | undefined) {
  return {
    version: 1,
    departments: [{ id: 'd1', name: '営業部', projects: [{ title: '新規開拓A', role: 'REVENUE', financeEffect: effect }] }],
    companyTargets: [{ id: 'rev-target', label: '売上', unit: '百万円' }],
    projectTargetImpacts: [] as any[],
  };
}

const savedEffect = (st: any) => st.departments[0].projects[0].financeEffect;

describe('financeEffect の重要項目が変わると、確認は解除される（FinanceEffectSection 以外の経路も含む）', () => {
  const materialChanges: Array<[string, Record<string, unknown>]> = [
    ['金額', { directAmountYen: 25 * M }],
    ['効果の種類', { kind: 'COST_REDUCTION' }],
    ['算定方法', { method: 'FUNNEL', meetingsPerPeriod: 3, winRatePct: 20, averageDealYen: 10 * M }],
    ['金額の単位', { amountBasis: 'MONTHLY' }],
    ['開始月', { startYm: '2027-10' }],
    ['終了月', { endYm: '2029-03' }],
    ['対象範囲', { scopeNote: '全国' }],
    ['算定根拠・出所', { sourceNote: '別の出所' }],
    ['値の出所', { source: 'AI_PROPOSED' }],
    ['原価率', { costRatePct: 30 }],
  ];

  it.each(materialChanges)('%s を変えると未確認に戻り、確認日時は消える（保存経路）', (_label, change) => {
    const st = applyProjectImpactPatch(stateWith(confirmed), 0, 0, { financeEffect: { ...confirmed, ...change } });
    expect(savedEffect(st).confirmed).toBe(false);
    expect(savedEffect(st).confirmedAt).toBeUndefined();
  });

  it.each(materialChanges)('%s を変えると未確認になる（純粋関数）', (_label, change) => {
    const next = guardFinanceEffectConfirmation(confirmed, { ...confirmed, ...change });
    expect(next?.confirmed).toBe(false);
    expect(next?.confirmedAt).toBeUndefined();
  });

  it('表示用の注記（重複の説明）だけの変更は、確認を外さない', () => {
    const st = applyProjectImpactPatch(stateWith(confirmed), 0, 0, {
      financeEffect: { ...confirmed, overlapNote: '他施策と切り分け済み' },
    });
    expect(savedEffect(st).confirmed).toBe(true);
    expect(savedEffect(st).confirmedAt).toBe(CONFIRMED_AT);
  });

  it('確認の取り消し（confirmed を false にする）は、確認日時も消す', () => {
    const next = guardFinanceEffectConfirmation(confirmed, { ...confirmed, confirmed: false });
    expect(next?.confirmed).toBe(false);
    expect(next?.confirmedAt).toBeUndefined();
  });

  it('新規に入力された財務効果は、確認済みで届いても未確認になる', () => {
    expect(guardFinanceEffectConfirmation(undefined, { ...confirmed, confirmedAt: CONFIRMED_AT })?.confirmed).toBe(false);
  });
});

describe('同値の保存・再読込では、確認状態と確認日時を保つ', () => {
  it('同じ内容を保存しても、確認と確認日時は維持される', () => {
    const st = applyProjectImpactPatch(stateWith(confirmed), 0, 0, { financeEffect: { ...confirmed } });
    expect(savedEffect(st)).toEqual(confirmed);
  });

  it('保存して再読込しても、確認と確認日時は維持される', () => {
    const saved = JSON.parse(JSON.stringify({ departments: [{ id: 'd1', name: '営業部', projects: [{ title: '新規開拓A', financeEffect: confirmed }] }] }));
    const loaded = normalizeStrategyData(saved) as any;
    const reloaded = loaded.departments[0].projects[0].financeEffect;
    expect(reloaded).toEqual(confirmed);

    const again = applyProjectImpactPatch(stateWith(reloaded), 0, 0, { financeEffect: { ...reloaded } });
    expect(savedEffect(again)).toEqual(confirmed);
  });

  it('未確認の値に確認を付けると、その時点の確認日時で確認済みになる', () => {
    const draft = { ...confirmed, confirmed: false } as Record<string, unknown>;
    delete draft.confirmedAt;
    const next = guardFinanceEffectConfirmation(draft, { ...draft, confirmed: true, confirmedAt: CONFIRMED_AT });
    expect(next).toMatchObject({ confirmed: true, confirmedAt: CONFIRMED_AT });
  });

  it('財務効果を削除すると、何も残らない', () => {
    expect(guardFinanceEffectConfirmation(confirmed, undefined)).toBeUndefined();
  });
});

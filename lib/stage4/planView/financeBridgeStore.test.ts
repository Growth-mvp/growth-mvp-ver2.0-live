/* 財務効果の書き込みを、ストア実体で確認する（Supabase と認証のみモック）。
 * 会社・戦略の不一致の拒否、施策の特定、保存成功、保存失敗時の巻き戻し、切替による中断を確かめる。 */

export {};

jest.mock('@/store/userStore', () => ({
  useUserStore: {
    getState: () => ({ user: { id: 'user-1' }, companyId: 'co-jnc', membershipVerified: true }),
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/client', () => ({
  ...jest.requireActual('@/utils/supabase/client'),
  safeGetSession: async () => ({ error: null, data: { session: { user: { id: 'user-1' } } } }),
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: jest.fn(),
    saveStrategyData: jest.fn(async () => ({ ok: true })),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: () => 0,
  };
});

import { useStrategyStore } from '@/store/strategyStore';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { findProjectPositionById, writeFinanceEffectToProject } from './financeBridgeStore';
import { applyFinanceAnswers, buildFinanceEffectDrafts } from './financeBridge';
import { estimateProjectImpact } from './impactEstimate';

const PROJECT = {
  id: 'p-jnc-renewal',
  title: '既存顧客の保守契約更新',
  role: 'REVENUE',
  impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20 },
  okrsV2: [{ id: 'kr-1', label: '保守契約の継続率', target: 95, unit: '%' }],
};
const OTHER = { id: 'p-other', title: '他社の施策', okrsV2: [] as any[] };

function candidate() {
  const est = estimateProjectImpact(PROJECT, { edits: { 'impact:startYear': 2027, 'impact:endYear': 2028 } });
  const draft = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' }).find((d) => d.kind === 'REVENUE_UP')!;
  return applyFinanceAnswers(draft, { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
}

function setStore(saveResult: any = { ok: true, revision: 7 }) {
  const save = jest.fn(async () => saveResult);
  const departments = [
    { id: 'd1', name: '営業部', projects: [{ ...PROJECT }, { ...OTHER }] },
    { id: 'd2', name: '企画部', projects: [] as any[] },
  ];
  useStrategyStore.setState({
    companyId: 'co-jnc',
    strategyId: 'st-1',
    pendingCompanyId: null,
    departments,
    saveStrategyData: save,
  } as any);
  return { save, departments };
}

describe('施策の位置を安定IDで特定する', () => {
  it('同じIDの施策が1つだけなら、その位置を返す', () => {
    const found = findProjectPositionById([{ projects: [{ id: 'a' }] }, { projects: [{ id: 'b' }] }], 'b');
    expect(found).toMatchObject({ dIdx: 1, pIdx: 0 });
  });
  it('同じIDが複数ある・無いときは特定しない', () => {
    expect(findProjectPositionById([{ projects: [{ id: 'a' }, { id: 'a' }] }], 'a')).toBeNull();
    expect(findProjectPositionById([{ projects: [{ id: 'a' }] }], 'z')).toBeNull();
    expect(findProjectPositionById([{ projects: [{ id: 'a' }] }], '')).toBeNull();
  });
});

describe('財務効果の書き込み（ストア）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('会社・戦略が一致しなければ、保存も書き込みもしない', async () => {
    const { save, departments } = setStore();
    const r = await writeFinanceEffectToProject({ companyId: 'co-other', strategyId: 'st-1', projectId: PROJECT.id, candidate: candidate(), action: 'SAVE_DRAFT' });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(useStrategyStore.getState().departments).toBe(departments);
  });

  it('施策が特定できなければ、保存しない', async () => {
    const { save } = setStore();
    const r = await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: 'missing', candidate: candidate(), action: 'SAVE_DRAFT' });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('保存に成功すると、その施策だけに財務効果が入り、他の施策とSTAGE3のKPIは変わらない', async () => {
    const { save } = setStore({ ok: true, revision: 7 });
    const r = await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: PROJECT.id, candidate: candidate(), action: 'SAVE_DRAFT' });
    expect(r).toEqual({ ok: true, outcome: 'created', revision: 7 });
    expect(save).toHaveBeenCalledWith({ reason: 'stage4_finance_effect', force: true });
    const depts = useStrategyStore.getState().departments as any[];
    expect(depts[0].projects[0].financeEffect).toMatchObject({ kind: 'REVENUE_UP', confirmed: false });
    expect(depts[0].projects[0].okrsV2).toEqual(PROJECT.okrsV2);
    expect(depts[0].projects[1]).toEqual(OTHER);
    expect(depts[1].projects).toEqual([]);
  });

  it('確認の書き込みは、保存済みの草案を確認済みにする', async () => {
    setStore({ ok: true, revision: 7 });
    const cand = candidate();
    await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: PROJECT.id, candidate: cand, action: 'SAVE_DRAFT' });
    const r = await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: PROJECT.id, candidate: cand, action: 'CONFIRM' });
    expect(r).toMatchObject({ ok: true, outcome: 'confirmed' });
    const saved = (useStrategyStore.getState().departments as any[])[0].projects[0].financeEffect;
    expect(saved.confirmed).toBe(true);
    expect(typeof saved.confirmedAt).toBe('string');
  });

  it('保存に失敗したら、画面の状態を書き込み前に戻す', async () => {
    const { departments } = setStore({ ok: false, reason: 'api_error', error: 'boom' });
    const r = await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: PROJECT.id, candidate: candidate(), action: 'SAVE_DRAFT' });
    expect(r.ok).toBe(false);
    expect(useStrategyStore.getState().departments).toBe(departments);
    expect((useStrategyStore.getState().departments as any[])[0].projects[0].financeEffect).toBeUndefined();
  });

  it('確認した財務効果は、再読み込み（保存データの正規化）の後も金額・年度・確認状態を保つ', async () => {
    setStore({ ok: true, revision: 7 });
    const cand = candidate();
    await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: PROJECT.id, candidate: cand, action: 'SAVE_DRAFT' });
    await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: PROJECT.id, candidate: cand, action: 'CONFIRM' });
    const normalized: any = normalizeStrategyData({ departments: useStrategyStore.getState().departments } as any);
    expect(normalized.departments[0].projects[0].financeEffect).toMatchObject({
      kind: 'REVENUE_UP',
      method: 'FUNNEL',
      meetingsPerPeriod: 10,
      winRatePct: 30,
      averageDealYen: 20_000_000,
      amountBasis: 'ANNUAL',
      startYm: '2026-04',
      endYm: '2028-03',
      isIncremental: true,
      meetingBasisConfirmed: true,
      confirmed: true,
    });
    expect(typeof normalized.departments[0].projects[0].financeEffect.confirmedAt).toBe('string');
  });

  it('保存の途中で会社・戦略が切り替わったとき（skipped）は、切替後の状態を巻き戻さない', async () => {
    setStore({ ok: false, skipped: true, reason: 'scope_changed' });
    const r = await writeFinanceEffectToProject({ companyId: 'co-jnc', strategyId: 'st-1', projectId: PROJECT.id, candidate: candidate(), action: 'SAVE_DRAFT' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('切り替わった');
    expect(useStrategyStore.getState().companyId).toBe('co-jnc');
  });
});

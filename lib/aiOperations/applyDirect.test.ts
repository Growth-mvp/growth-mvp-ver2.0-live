import { applyDirectProposal, applyStageOp, isDirectProposal, planRemoval, planUndo } from './applyDirect';
import { useAiUndoStore } from './aiUndoStore';
import { waitForSaveSettled } from './saveSettle';
import type { OperationProposal } from './instruction';
import type { StageOp } from './stage1Input';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { supabase } from '@/utils/supabase/client';

jest.mock('@/utils/supabase/client', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('@/store/strategyStore', () => ({ useStrategyStore: { getState: jest.fn() } }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: jest.fn() } }));
jest.mock('./saveSettle', () => ({
  ...jest.requireActual('./saveSettle'),
  waitForSaveSettled: jest.fn(async () => 'dirty'),
}));

const ISSUE: OperationProposal = {
  kind: 'stage1.issue',
  pathname: '/stage1',
  companyId: 'c1',
  strategyId: 's1',
  beforeTitles: ['既存の課題'],
  title: '新規顧客の獲得が鈍い',
  description: '商談が増えない',
};

const REVENUE_EMPTY: OperationProposal = {
  kind: 'stage1.revenue',
  pathname: '/stage1',
  companyId: 'c1',
  strategyId: 's1',
  year: 2025,
  beforeYen: null,
  afterYen: 160_000_000,
};

const REVENUE_OVERWRITE: OperationProposal = { ...REVENUE_EMPTY, beforeYen: 150_000_000 };

function setStore(over: Record<string, unknown> = {}) {
  const state: Record<string, any> = {
    companyId: 'c1',
    strategyId: 's1',
    dirty: false,
    revision: 7,
    stage1Issues: [{ title: '既存の課題', description: '', linkedMetrics: [], scope: 'company' }],
    financePL: [{ year: 2024, revenue: 100 }],
    financeBS: [],
    businessSegments: [{ id: 'seg-1', name: '製造事業' }],
    segmentPL: { 製造事業: [{ year: 2025, revenue: 1 }] },
    segmentBS: {},
    stage1Benchmarks: { waccManual: 4 },
    setStage1Issues: jest.fn((issues: unknown[]) => {
      state.stage1Issues = issues;
    }),
    setFinancePL: jest.fn((rows: unknown[]) => {
      state.financePL = rows;
    }),
    setFinanceBS: jest.fn((rows: unknown[]) => {
      state.financeBS = rows;
    }),
    setProfile: jest.fn((patch: Record<string, unknown>) => Object.assign(state, patch)),
    upsertSegmentPL: jest.fn((name: string, rows: unknown[]) => {
      state.segmentPL = { ...state.segmentPL, [name]: rows };
    }),
    upsertSegmentBS: jest.fn(),
    setStage1Benchmarks: jest.fn((bm: unknown) => {
      state.stage1Benchmarks = bm;
    }),
    recomputeValueAnalysis: jest.fn(),
    ...over,
  };
  (useStrategyStore.getState as jest.Mock).mockReturnValue(state);
  return state;
}

function allowAuthorize(revision: number | null = 7) {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u1' } } } });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ revision }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useUserStore.getState as jest.Mock).mockReturnValue({ role: 'manager', user: { id: 'u1' } });
  useAiHighlightStore.setState({ target: null, at: 0, reveal: null });
  useAiUndoStore.setState({ last: null });
});

describe('isDirectProposal：直接反映する操作', () => {
  it('経営課題の追加と、売上の空欄への入力は直接反映する', () => {
    expect(isDirectProposal(ISSUE)).toBe(true);
    expect(isDirectProposal(REVENUE_EMPTY)).toBe(true);
  });

  it('売上の既存値の上書きは、内容を確かめるため従来どおり承認カードにする', () => {
    expect(isDirectProposal(REVENUE_OVERWRITE)).toBe(false);
  });
});

describe('applyDirectProposal：入力欄への直接反映', () => {
  it('経営課題を入力欄に加え、保存はせず、反映した項目を強調の対象にする', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('入力欄に反映しました');
    expect(result.message).toContain('保存はまだです');
    expect(state.setStage1Issues).toHaveBeenCalledWith([
      { title: '既存の課題', description: '', linkedMetrics: [], scope: 'company' },
      { title: '新規顧客の獲得が鈍い', description: '商談が増えない', linkedMetrics: [], scope: 'company' },
    ]);
    expect(useAiHighlightStore.getState().target).toBe('stage1.issue.1');
  });

  it('売上の空欄に年度の値を入力欄に反映する', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyDirectProposal(REVENUE_EMPTY);
    expect(result.ok).toBe(true);
    expect(state.setFinancePL).toHaveBeenCalledWith([
      { year: 2024, revenue: 100 },
      { year: 2025, revenue: 160_000_000 },
    ]);
    expect(useAiHighlightStore.getState().target).toBe('stage1.finance.pl.revenue.2025');
  });

  it('未保存の変更があっても止めず、対象の項目だけを反映する', async () => {
    const state = setStore({ dirty: true });
    allowAuthorize();
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(true);
    expect(state.setStage1Issues).toHaveBeenCalled();
  });

  it('サーバーの版が画面と違えば（ほかで更新された）反映しない', async () => {
    const state = setStore();
    allowAuthorize(8);
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ほかの画面で内容が更新');
    expect(state.setStage1Issues).not.toHaveBeenCalled();
  });

  it('企業が切り替わっていれば反映しない', async () => {
    const state = setStore({ companyId: 'c2' });
    allowAuthorize();
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(false);
    expect(state.setStage1Issues).not.toHaveBeenCalled();
  });

  it('権限の確認に失敗すれば反映しない', async () => {
    const state = setStore();
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { access_token: 't' } } });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(false);
    expect(state.setStage1Issues).not.toHaveBeenCalled();
  });

  it('ログインしていなければ反映しない', async () => {
    const state = setStore();
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(false);
    expect(state.setStage1Issues).not.toHaveBeenCalled();
  });

  it('経営課題が5件あれば反映しない', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ title: `課題${i}`, description: '', linkedMetrics: [], scope: 'company' }));
    const state = setStore({ stage1Issues: five });
    allowAuthorize();
    const result = await applyDirectProposal({ ...ISSUE, beforeTitles: five.map((f) => f.title) });
    expect(result.ok).toBe(false);
    expect(state.setStage1Issues).not.toHaveBeenCalled();
  });

  it('入力案を作った後に経営課題が変わっていれば反映しない', async () => {
    const state = setStore({ stage1Issues: [{ title: '別の課題' }] });
    allowAuthorize();
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(false);
    expect(state.setStage1Issues).not.toHaveBeenCalled();
  });

  it('財務の入力を受け付けなかった場合は、反映できなかったと伝える', async () => {
    setStore({ setFinancePL: jest.fn() });
    allowAuthorize();
    const result = await applyDirectProposal(REVENUE_EMPTY);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('反映できませんでした');
  });
});

describe('applyStageOp：STAGE1の各入力欄への反映', () => {
  it('役割が管理職未満なら反映しない', async () => {
    const state = setStore();
    (useUserStore.getState as jest.Mock).mockReturnValue({ role: 'member' });
    allowAuthorize();
    const result = await applyStageOp({ kind: 'profile', field: 'companyName', value: 'A社', display: 'A社' });
    expect(result.ok).toBe(false);
    expect(state.setProfile).not.toHaveBeenCalled();
  });

  it('会社名・業種などの基本情報は、既存の入力処理で入力欄に入れる', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyStageOp({ kind: 'profile', field: 'employees', value: '20〜49', display: '30名（20〜49名）' });
    expect(result.ok).toBe(true);
    expect(state.setProfile).toHaveBeenCalledWith({ employees: '20〜49' });
    expect(useAiHighlightStore.getState().target).toBe('stage1.profile.employees');
  });

  it('事業の追加は、上限内で新しい事業を入力欄に加える', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyStageOp({ kind: 'segment.add', name: 'カフェ' });
    expect(result.ok).toBe(true);
    const call = (state.setProfile as jest.Mock).mock.calls[0][0];
    expect(call.businessSegments).toHaveLength(2);
    expect(call.businessSegments[1]).toMatchObject({ name: 'カフェ' });
    expect(typeof call.businessSegments[1].id).toBe('string');
  });

  it('事業名の変更は、事業のIDを変えず、事業別の財務を守る', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyStageOp({ kind: 'segment.rename', from: '製造事業', to: '製造・加工事業' });
    expect(result.ok).toBe(true);
    expect(state.setProfile).toHaveBeenCalledWith({ businessSegments: [{ id: 'seg-1', name: '製造・加工事業' }] });
  });

  it('事業の顧客は、対象の事業だけを更新する', async () => {
    const state = setStore({
      businessSegments: [
        { id: 'seg-1', name: '製造事業', keyCustomers: ['A社'] },
        { id: 'seg-2', name: 'フィットネス' },
      ],
    });
    allowAuthorize();
    await applyStageOp({ kind: 'segment.set', name: 'フィットネス', field: 'keyCustomers', value: ['地域の高齢者'] });
    const next = (state.setProfile as jest.Mock).mock.calls[0][0].businessSegments;
    expect(next[0]).toMatchObject({ id: 'seg-1', keyCustomers: ['A社'] });
    expect(next[1]).toMatchObject({ id: 'seg-2', keyCustomers: ['地域の高齢者'] });
  });

  it('事業別の財務は、その事業の財務表の該当の年度だけを更新する', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyStageOp({
      kind: 'finance',
      table: 'pl',
      key: 'revenue',
      label: '売上高',
      year: 2025,
      yen: 900_000_000,
      segment: '製造事業',
    });
    expect(result.ok).toBe(true);
    expect(state.upsertSegmentPL).toHaveBeenCalledWith('製造事業', [{ year: 2025, revenue: 900_000_000 }]);
    expect(useAiHighlightStore.getState().target).toBe('stage1.finance.segment.seg-1.pl.revenue.2025');
  });

  it('全社の財務は、他の年度を変えずに該当の項目だけを入力する', async () => {
    const state = setStore({ financePL: [{ year: 2024, revenue: 100, operatingIncome: 5 }] });
    allowAuthorize();
    await applyStageOp({ kind: 'finance', table: 'pl', key: 'operatingIncome', label: '営業利益', year: 2025, yen: -3_000_000 });
    expect(state.setFinancePL).toHaveBeenCalledWith([
      { year: 2024, revenue: 100, operatingIncome: 5 },
      { year: 2025, operatingIncome: -3_000_000 },
    ]);
  });

  it('確認を経た財務は、値が変わっていれば反映しない', async () => {
    const state = setStore({ financePL: [{ year: 2025, operatingIncome: 2_000_000 }] });
    allowAuthorize();
    const result = await applyStageOp({
      kind: 'finance',
      table: 'pl',
      key: 'operatingIncome',
      label: '営業利益',
      year: 2025,
      yen: 5_000_000,
      expectedBefore: 1_000_000,
    });
    expect(result.ok).toBe(false);
    expect(state.setFinancePL).not.toHaveBeenCalled();
  });

  it('WACCは、既存の前提条件を残して、入力値だけを変える', async () => {
    const state = setStore({ stage1Benchmarks: { waccManual: 4, waccRationale: '根拠' } });
    allowAuthorize();
    await applyStageOp({ kind: 'wacc', pct: 5.5 });
    expect(state.setStage1Benchmarks).toHaveBeenCalledWith({ waccManual: 5.5, waccRationale: '根拠' });
  });

  it('経営課題の説明の修正は、対象の経営課題だけを変える', async () => {
    const state = setStore({
      stage1Issues: [
        { title: '新規顧客の獲得が鈍い', description: '旧', linkedMetrics: [], scope: 'company' },
        { title: '離脱', description: '', linkedMetrics: [], scope: 'company' },
      ],
    });
    allowAuthorize();
    await applyStageOp({ kind: 'issue.edit', title: '新規顧客の獲得が鈍い', field: 'description', value: '新しい説明' });
    const next = (state.setStage1Issues as jest.Mock).mock.calls[0][0];
    expect(next[0]).toMatchObject({ title: '新規顧客の獲得が鈍い', description: '新しい説明' });
    expect(next[1]).toMatchObject({ title: '離脱', description: '' });
  });

  it('企業価値分析の更新は、既存の再計算を呼ぶ', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyStageOp({ kind: 'valuation' });
    expect(result.ok).toBe(true);
    expect(state.recomputeValueAnalysis).toHaveBeenCalled();
  });
});

describe('applyStageOp：権限確認の前後で、利用者・企業・戦略と対象の値を確かめる', () => {
  const PROFILE: StageOp = { kind: 'profile', field: 'companyName', value: 'A社', display: 'A社' };
  const OP_2025: StageOp = { kind: 'finance', table: 'pl', key: 'operatingIncome', label: '営業利益', year: 2025, yen: 5_000_000 };

  it('権限確認中に利用者が切り替わったら反映しない', async () => {
    const state = setStore();
    allowAuthorize();
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { access_token: 't', user: { id: 'u2' } } } });
    const result = await applyStageOp(PROFILE);
    expect(result.ok).toBe(false);
    expect(state.setProfile).not.toHaveBeenCalled();
  });

  it('権限確認中に企業が切り替わったら反映しない', async () => {
    const state = setStore({ financePL: [{ year: 2024, revenue: 100 }] });
    allowAuthorize();
    global.fetch = jest.fn(async () => {
      (useStrategyStore.getState as jest.Mock).mockReturnValue({ ...state, companyId: 'c2' });
      return { ok: true, json: async () => ({ revision: 7 }) };
    }) as unknown as typeof fetch;
    const result = await applyStageOp(OP_2025);
    expect(result.ok).toBe(false);
    expect(state.setFinancePL).not.toHaveBeenCalled();
  });

  it('権限確認中に同じ項目を手動で変えていたら、上書きしない', async () => {
    const state = setStore({ financePL: [{ year: 2024, revenue: 100 }] });
    allowAuthorize();
    global.fetch = jest.fn(async () => {
      state.financePL = [{ year: 2024, revenue: 100 }, { year: 2025, operatingIncome: 2_000_000 }];
      return { ok: true, json: async () => ({ revision: 7 }) };
    }) as unknown as typeof fetch;
    const result = await applyStageOp(OP_2025);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('同じ項目が変わった');
    expect(state.setFinancePL).not.toHaveBeenCalled();
    expect(state.financePL).toEqual([{ year: 2024, revenue: 100 }, { year: 2025, operatingIncome: 2_000_000 }]);
  });

  it('権限確認中に別の項目（別の年度）が変わっても、対象の項目だけを反映し、その変更を残す', async () => {
    const state = setStore({ financePL: [{ year: 2024, revenue: 100 }] });
    allowAuthorize();
    global.fetch = jest.fn(async () => {
      state.financePL = [{ year: 2024, revenue: 200 }];
      return { ok: true, json: async () => ({ revision: 7 }) };
    }) as unknown as typeof fetch;
    const result = await applyStageOp(OP_2025);
    expect(result.ok).toBe(true);
    expect(state.financePL).toEqual([
      { year: 2024, revenue: 200 },
      { year: 2025, operatingIncome: 5_000_000 },
    ]);
  });
});

describe('直前のAI入力の取り消し', () => {
  const OP_2025: StageOp = { kind: 'finance', table: 'pl', key: 'operatingIncome', label: '営業利益', year: 2025, yen: 5_000_000 };

  it('基本情報の入力は、対象の値が反映時のままなら取り消せる', async () => {
    const state = setStore({ companyName: '旧社名' });
    allowAuthorize();
    expect((await applyStageOp({ kind: 'profile', field: 'companyName', value: '新社名', display: '新社名' }, { settleMs: 0 })).ok).toBe(true);
    expect(state.companyName).toBe('新社名');
    const plan = planUndo();
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    allowAuthorize();
    const undone = await applyStageOp(plan.record.undo, { settleMs: 0, recordUndo: false });
    expect(undone.ok).toBe(true);
    expect(state.companyName).toBe('旧社名');
  });

  it('取り消しの前に同じ項目が手動で変わっていれば、取り消さない', async () => {
    const state = setStore({ companyName: '旧社名' });
    allowAuthorize();
    await applyStageOp({ kind: 'profile', field: 'companyName', value: '新社名', display: '新社名' }, { settleMs: 0 });
    state.companyName = '手入力の社名';
    const plan = planUndo();
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.message).toContain('同じ項目が変わった');
  });

  it('財務の入力を取り消すと、入力した年度の値を空欄に戻し、年度の行は残さない', async () => {
    const state = setStore({ financePL: [{ year: 2024, revenue: 100 }] });
    allowAuthorize();
    await applyStageOp(OP_2025, { settleMs: 0 });
    expect(state.financePL).toEqual([{ year: 2024, revenue: 100 }, { year: 2025, operatingIncome: 5_000_000 }]);
    const plan = planUndo();
    if (!plan.ok) throw new Error(plan.message);
    allowAuthorize();
    const undone = await applyStageOp(plan.record.undo, { settleMs: 0, recordUndo: false });
    expect(undone.ok).toBe(true);
    expect(state.financePL).toEqual([{ year: 2024, revenue: 100 }]);
  });

  it('事業の追加は取り消せるが、事業に財務データが入っていれば削除しない', async () => {
    const state = setStore({ businessSegments: [{ id: 'seg-1', name: '製造事業' }] });
    allowAuthorize();
    await applyStageOp({ kind: 'segment.add', name: 'カフェ' }, { settleMs: 0 });
    state.segmentPL = { ...state.segmentPL, カフェ: [{ year: 2025, revenue: 1 }] };
    const plan = planUndo();
    if (!plan.ok) throw new Error(plan.message);
    allowAuthorize();
    const undone = await applyStageOp(plan.record.undo, { settleMs: 0, recordUndo: false });
    expect(undone.ok).toBe(false);
    expect(undone.message).toContain('財務データ');
    expect(state.businessSegments).toHaveLength(2);
  });
});

describe('登録済みの事業・経営課題の削除（明示承認の前に影響を確かめる）', () => {
  it('財務データのない事業は、削除の案になる', () => {
    setStore({
      businessSegments: [{ id: 'seg-1', name: '製造事業' }, { id: 'seg-2', name: 'カフェ' }],
      segmentPL: {},
      segmentBS: {},
    });
    const plan = planRemoval({ type: 'segment', name: '製造事業' });
    expect(plan).toMatchObject({ ok: true, op: { kind: 'segment.remove', name: '製造事業' } });
  });

  it('事業別の財務データがある事業は、削除の案にしない', () => {
    setStore({
      businessSegments: [{ id: 'seg-1', name: '製造事業' }, { id: 'seg-2', name: 'カフェ' }],
      segmentPL: { カフェ: [{ year: 2025, revenue: 1 }] },
    });
    const plan = planRemoval({ type: 'segment', name: 'カフェ' });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.message).toContain('財務データ');
  });

  it('経営課題の削除は、影響を示した案になる。承認すると削除する', async () => {
    const state = setStore();
    const plan = planRemoval({ type: 'issue', name: '既存の課題' });
    expect(plan).toMatchObject({ ok: true, op: { kind: 'issue.remove', title: '既存の課題' } });
    if (!plan.ok) return;
    expect(plan.impact).toContain('既存の課題');
    allowAuthorize();
    const r = await applyStageOp(plan.op, { settleMs: 0 });
    expect(r.ok).toBe(true);
    expect(state.stage1Issues).toEqual([]);
  });
});

describe('取り消し情報の記録（自動保存の待機との前後関係）', () => {
  const PROFILE: StageOp = { kind: 'profile', field: 'companyName', value: '新社名', display: '新社名' };

  it('反映直後、自動保存を待つ前に、利用者・企業・戦略・対象値を記録する', async () => {
    const state = setStore({ companyName: '旧社名' });
    allowAuthorize();
    let seen: unknown = 'not-called';
    (waitForSaveSettled as jest.Mock).mockImplementationOnce(async () => {
      seen = useAiUndoStore.getState().last;
      return 'dirty';
    });
    const r = await applyStageOp(PROFILE);
    expect(r.ok).toBe(true);
    expect(seen).toMatchObject({ companyId: 'c1', strategyId: 's1', userId: 'u1', label: expect.any(String) });
    expect(useAiUndoStore.getState().last).not.toBeNull();
    expect(state.companyName).toBe('新社名');
  });

  it('自動保存の待機中に企業が切り替わったら、取り消し情報を登録しない', async () => {
    const state = setStore({ companyName: '旧社名' });
    allowAuthorize();
    (waitForSaveSettled as jest.Mock).mockImplementationOnce(async () => {
      state.companyId = 'c2';
      return 'dirty';
    });
    await applyStageOp(PROFILE);
    expect(useAiUndoStore.getState().last).toBeNull();
  });

  it('自動保存の待機中に利用者が切り替わったら、取り消し情報を登録しない', async () => {
    setStore({ companyName: '旧社名' });
    allowAuthorize();
    (waitForSaveSettled as jest.Mock).mockImplementationOnce(async () => {
      (useUserStore.getState as jest.Mock).mockReturnValue({ role: 'manager', user: { id: 'u2' } });
      return 'dirty';
    });
    await applyStageOp(PROFILE);
    expect(useAiUndoStore.getState().last).toBeNull();
  });

  it('自動保存の待機中に対象の値が変わったら、取り消し情報を登録しない', async () => {
    const state = setStore({ companyName: '旧社名' });
    allowAuthorize();
    (waitForSaveSettled as jest.Mock).mockImplementationOnce(async () => {
      state.companyName = '手入力の社名';
      return 'dirty';
    });
    await applyStageOp(PROFILE);
    expect(useAiUndoStore.getState().last).toBeNull();
  });

  it('記録の後に利用者が変わっていたら、取り消さない', async () => {
    setStore({ companyName: '旧社名' });
    allowAuthorize();
    await applyStageOp(PROFILE, { settleMs: 0 });
    (useUserStore.getState as jest.Mock).mockReturnValue({ role: 'manager', user: { id: 'u2' } });
    const plan = planUndo();
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.message).toContain('利用者が変わった');
  });
});

describe('企業価値分析の依頼（他のSTAGEからでも分析・論点タブを示す）', () => {
  it('分析の更新は、財務指標の表示先を示し、再計算する', async () => {
    const state = setStore();
    allowAuthorize();
    const r = await applyStageOp({ kind: 'valuation' }, { settleMs: 0 });
    expect(r.ok).toBe(true);
    expect(state.recomputeValueAnalysis).toHaveBeenCalled();
    expect(useAiHighlightStore.getState().target).toBe('stage1.valuation');
    expect(useAiHighlightStore.getState().reveal).toEqual({ tab: 'analysis', section: 'metrics' });
    expect(r.message).toContain('分析・論点');
  });
});

describe('削除の安全確認（下流との紐づけを確認できないものは削除しない）', () => {
  it('STAGE3の部門など、下流のデータがある事業は削除の案にしない', () => {
    setStore({
      businessSegments: [{ id: 'seg-1', name: '製造事業' }],
      segmentPL: {},
      segmentBS: {},
      departments: [{ name: '製造事業', mission: '', projects: [], finalized: false }],
    });
    const plan = planRemoval({ type: 'segment', name: '製造事業' });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.message).toContain('部門（STAGE3）');
  });

  it('事業ポートフォリオがある間は、経営課題も削除の案にしない', () => {
    setStore({ businessPortfolio: { unitType: 'business', periodLabel: 'FY2025', currency: 'JPY', threshold: { growthBaseline: 0, profitBaseline: 0 }, units: [] } });
    const plan = planRemoval({ type: 'issue', name: '既存の課題' });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.message).toContain('事業ポートフォリオ');
  });

  it('承認の時点で下流のデータが増えていたら、削除しない', async () => {
    const state = setStore({
      businessSegments: [{ id: 'seg-1', name: '製造事業' }, { id: 'seg-2', name: 'カフェ' }],
      segmentPL: {},
      segmentBS: {},
    });
    const plan = planRemoval({ type: 'segment', name: 'カフェ' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    state.departments = [{ name: 'カフェ', mission: '', projects: [], finalized: false }];
    allowAuthorize();
    const r = await applyStageOp(plan.op, { settleMs: 0 });
    expect(r.ok).toBe(false);
    expect(state.businessSegments).toHaveLength(2);
  });
});

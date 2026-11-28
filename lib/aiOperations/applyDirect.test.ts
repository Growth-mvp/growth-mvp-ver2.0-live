import { applyDirectProposal, isDirectProposal } from './applyDirect';
import type { OperationProposal } from './instruction';
import { useStrategyStore } from '@/store/strategyStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { supabase } from '@/utils/supabase/client';

jest.mock('@/utils/supabase/client', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('@/store/strategyStore', () => ({ useStrategyStore: { getState: jest.fn() } }));

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
    setStage1Issues: jest.fn((issues: unknown[]) => {
      state.stage1Issues = issues;
    }),
    setFinancePL: jest.fn((rows: unknown[]) => {
      state.financePL = rows;
    }),
    ...over,
  };
  (useStrategyStore.getState as jest.Mock).mockReturnValue(state);
  return state;
}

function allowAuthorize(revision: number | null = 7) {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { access_token: 't' } } });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ revision }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAiHighlightStore.setState({ target: null, at: 0 });
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

  it('売上の空欄に年度の値を入力欄に反映し、企業価値分析は保存後の画面更新に任せる', async () => {
    const state = setStore();
    allowAuthorize();
    const result = await applyDirectProposal(REVENUE_EMPTY);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('2025年度の全社売上高');
    expect(state.setFinancePL).toHaveBeenCalledWith([
      { year: 2024, revenue: 100 },
      { year: 2025, revenue: 160_000_000 },
    ]);
    expect(useAiHighlightStore.getState().target).toBe('stage1.finance.pl.revenue.2025');
  });

  it('未保存の変更があれば反映しない', async () => {
    const state = setStore({ dirty: true });
    allowAuthorize();
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(false);
    expect(state.setStage1Issues).not.toHaveBeenCalled();
  });

  it('サーバーの版が画面と違えば（ほかで更新された）反映しない', async () => {
    const state = setStore();
    allowAuthorize(8);
    const result = await applyDirectProposal(ISSUE);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ほかの画面で内容が更新');
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

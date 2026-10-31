/* eslint-disable @typescript-eslint/no-explicit-any -- テスト用のストア状態の型をゆるく扱う */
/* 追加探索で増えた候補が、確定 SWOT・選択の記録・上限を壊さないことを、ストア実体で確認する。Supabase 通信のみモック。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};
const mockSave = jest.fn<any, any[]>(async () => ({ ok: true }));

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => mockUser,
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: jest.fn(async () => {
      throw new Error('unexpected call: getFullStrategyDataByCompany');
    }),
    saveStrategyData: (...args: any[]) => mockSave(...args),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: () => 0,
    getFullStrategyDataByStrategyId: jest.fn(async () => {
      throw new Error('unexpected call: getFullStrategyDataByStrategyId');
    }),
    deleteStrategyData: jest.fn(async () => {
      throw new Error('unexpected call: deleteStrategyData');
    }),
  };
});

import { useStrategyStore } from './strategyStore';
import { candidatePoolOf } from '@/lib/swot/candidatePool';

const get = () => useStrategyStore.getState() as any;

const confirmed = {
  strength: '確定した強み',
  weakness: '確定した弱み',
  opportunity: '確定した機会',
  threat: '確定した脅威',
};

const initial = (n: number) => Array.from({ length: n }, (_, i) => `初回の機会${i + 1}：市場の変化${i + 1}が起きる可能性がある。`);

const extension = (texts: string[]) =>
  texts.map((text) => ({ text, group: 'new_region', basis: 'hypothesis', evidence: '', sourceIndex: null, origin: 'extension' }));

const evidence = {
  findings: [{ theme: '市場', statement: '出荷が増えた。', sourceIndex: 1 }],
  sources: [{ index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: '2026-10-31T00:00:00.000Z' }],
};

describe('追加探索の候補の追加（確定 SWOT と選択の保護）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrategyStore.setState({ ...confirmed, swotSuggestions: undefined, dirty: false } as any);
  });

  it('初回の根拠を保存でき、候補を追加しても根拠は残る', () => {
    get().setSwotSuggestions({ opportunity: initial(3), threat: [], generatedAt: '2026-10-31T00:00:00.000Z', evidence });
    get().appendSwotOpportunities(extension(['新しい地域の機会が広がる可能性がある。']));
    expect(get().swotSuggestions.evidence).toEqual(evidence);
  });

  it('追加した候補は既存の候補の後ろに加わり、件数を返す。確定 SWOT の本文は変えない', () => {
    get().setSwotSuggestions({ opportunity: initial(3), threat: [], generatedAt: '2026-10-31T00:00:00.000Z', evidence });
    const added = get().appendSwotOpportunities(extension(['新しい地域の機会が広がる可能性がある。', '新しい顧客の機会が広がる可能性がある。']));
    expect(added).toBe(2);
    expect(get().swotSuggestions.opportunity).toHaveLength(5);
    expect(get().swotSuggestions.opportunity.slice(0, 3)).toEqual(initial(3));
    expect(get().opportunity).toBe('確定した機会');
    expect(get().threat).toBe('確定した脅威');
  });

  it('既に選択した候補の選択と、削除した候補の記録は、追加探索で失われない', () => {
    get().setSwotSuggestions({ opportunity: initial(3), threat: [], generatedAt: '2026-10-31T00:00:00.000Z', evidence });
    const first = candidatePoolOf(get().swotSuggestions).candidates[0];
    get().addSwotCandidate(first.id);
    get().appendSwotOpportunities(extension(['新しい地域の機会が広がる可能性がある。']));
    const entry = get().swotSuggestions.selection.entries[first.id];
    expect(entry).toMatchObject({ status: 'added' });
    expect(get().opportunity).toContain(first.text);
  });

  it('上限（30件）に達していれば、追加は行わず 0 を返す', () => {
    get().setSwotSuggestions({ opportunity: initial(30), threat: [], generatedAt: '2026-10-31T00:00:00.000Z', evidence });
    const added = get().appendSwotOpportunities(extension(['新しい地域の機会が広がる可能性がある。']));
    expect(added).toBe(0);
    expect(get().swotSuggestions.opportunity).toHaveLength(30);
  });

  it('既存と同じ文は重複として追加せず、件数は増えない', () => {
    get().setSwotSuggestions({ opportunity: initial(3), threat: [], generatedAt: '2026-10-31T00:00:00.000Z', evidence });
    const added = get().appendSwotOpportunities(extension([initial(3)[0]]));
    expect(added).toBe(0);
    expect(get().swotSuggestions.opportunity).toHaveLength(3);
  });

  it('候補の一覧が無い状態でも、追加探索の結果を候補として保存する', () => {
    const added = get().appendSwotOpportunities(extension(['新しい地域の機会が広がる可能性がある。']));
    expect(added).toBe(1);
    expect(get().swotSuggestions.opportunity).toEqual(['新しい地域の機会が広がる可能性がある。']);
  });
});

describe('会社を切り替えたとき、前の会社の候補が残らない', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrategyStore.setState({ ...confirmed, swotSuggestions: undefined, dirty: false } as any);
  });

  it('会社を切り替えると、表示中の候補と根拠は消え、確定 SWOT の見た目の状態もリセットされる', () => {
    get().setSwotSuggestions({ opportunity: initial(3), threat: [], generatedAt: '2026-10-31T00:00:00.000Z', evidence });
    get().setCompanyScope('company-other');
    expect(get().swotSuggestions).toBeUndefined();
    expect(get().opportunity).toBeFalsy();
  });
});

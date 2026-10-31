/* O・T 候補の保存が、確定済みの S・W・O・T 本文を変更しないことを、ストア実体で確認する。Supabase 通信のみモック。 */

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

const get = () => useStrategyStore.getState() as any;

const confirmedSwot = {
  strength: '確定した強み',
  weakness: '確定した弱み',
  opportunity: '確定した機会',
  threat: '確定した脅威',
};

describe('O・T 候補の保存と確定済み SWOT の保護', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrategyStore.setState({ ...confirmedSwot, swotSuggestions: undefined, dirty: false } as any);
  });

  it('候補を保存しても、確定済みの S・W・O・T 本文は変わらない', () => {
    get().setSwotSuggestions({
      opportunity: ['AI候補の機会'],
      threat: ['AI候補の脅威'],
      generatedAt: '2026-10-29T00:00:00.000Z',
      sources: [{ index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: '2026-10-29T00:00:00.000Z' }],
      insights: {
        opportunity: [{ text: 'AI候補の機会', basis: 'fact', evidence: 'Web', sourceIndex: 1 }],
        threat: [{ text: 'AI候補の脅威', basis: 'hypothesis', evidence: '前提', sourceIndex: null }],
      },
    });

    const s = get();
    expect(s.strength).toBe(confirmedSwot.strength);
    expect(s.weakness).toBe(confirmedSwot.weakness);
    expect(s.opportunity).toBe(confirmedSwot.opportunity);
    expect(s.threat).toBe(confirmedSwot.threat);
    expect(s.swotSuggestions.opportunity).toEqual(['AI候補の機会']);
    expect(s.swotSuggestions.sources).toHaveLength(1);
    expect(s.swotSuggestions.insights.opportunity[0].basis).toBe('fact');
    expect(s.dirty).toBe(true);
  });

  it('会社を切り替えると前の会社の O・T 候補は消える（別会社の候補を表示しない）', () => {
    useStrategyStore.setState({ companyId: 'company-a', pendingCompanyId: undefined } as any);
    get().setSwotSuggestions({ opportunity: ['A社の機会'], threat: ['A社の脅威'], generatedAt: 'a' });

    get().setCompanyScope('company-b');

    expect(get().swotSuggestions).toBeUndefined();
    expect(get().pendingCompanyId).toBe('company-b');
  });

  it('同じ会社の画面遷移では O・T 候補を消さない', () => {
    useStrategyStore.setState({ companyId: 'company-a', pendingCompanyId: undefined } as any);
    get().setSwotSuggestions({ opportunity: ['A社の機会'], threat: ['A社の脅威'], generatedAt: 'a' });

    get().setCompanyScope('company-a');

    expect(get().swotSuggestions).toMatchObject({ opportunity: ['A社の機会'], threat: ['A社の脅威'], generatedAt: 'a' });
  });

  it('再生成すると候補は丸ごと置き換わるが、確定済みの本文は残る', () => {
    get().setSwotSuggestions({ opportunity: ['旧'], threat: ['旧'], generatedAt: 'a' });
    get().setSwotSuggestions({ opportunity: ['新'], threat: ['新'], generatedAt: 'b' });

    expect(get().swotSuggestions).toMatchObject({ opportunity: ['新'], threat: ['新'], generatedAt: 'b' });
    expect(get().opportunity).toBe(confirmedSwot.opportunity);
  });
});

describe('AI 候補の選択状態（候補 ID 単位）', () => {
  const suggestions = {
    opportunity: ['AI候補の機会A', 'AI候補の機会B'],
    threat: ['AI候補の脅威'],
    generatedAt: '2026-10-30T00:00:00.000Z',
    sources: [{ index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: '2026-10-30T00:00:00.000Z' }],
    insights: {
      opportunity: [
        { text: 'AI候補の機会A', basis: 'fact', evidence: 'Web', sourceIndex: 1 },
        { text: 'AI候補の機会B', basis: 'hypothesis', evidence: '前提', sourceIndex: null },
      ],
      threat: [{ text: 'AI候補の脅威', basis: 'hypothesis', evidence: '前提', sourceIndex: null }],
    },
  };
  const idOf = (text: string) => get().swotSuggestions.candidatePool.candidates.find((c: any) => c.text === text).id;
  const entryOf = (text: string) => get().swotSuggestions.selection.entries[idOf(text)];

  beforeEach(() => {
    jest.clearAllMocks();
    useStrategyStore.setState({ ...confirmedSwot, swotSuggestions: undefined, dirty: false } as any);
  });

  it('候補を保存すると候補一覧が付き、確定 SWOT は変わらない', () => {
    get().setSwotSuggestions(suggestions);
    expect(get().swotSuggestions.candidatePool.candidates).toHaveLength(3);
    expect(get().opportunity).toBe(confirmedSwot.opportunity);
  });

  it('候補を追加すると確定 SWOT に入り、選択記録は候補 ID で残る', () => {
    get().setSwotSuggestions(suggestions);
    get().addSwotCandidate(idOf('AI候補の機会A'));
    expect(get().opportunity).toBe(`${confirmedSwot.opportunity}\nAI候補の機会A`);
    expect(entryOf('AI候補の機会A')).toMatchObject({ status: 'added', edited: false });
    expect(get().swotSuggestions.selection.entries[idOf('AI候補の機会B')]).toBeUndefined();
  });

  it('候補を再生成しても、追加済みの選択と手入力の行は残る', () => {
    get().addSwotOpportunity('自社で書いた機会');
    get().setSwotSuggestions(suggestions);
    const id = idOf('AI候補の機会A');
    get().addSwotCandidate(id);
    get().setSwotSuggestions({ ...suggestions, opportunity: ['新しい機会の文です。'], insights: undefined });
    expect(get().swotSuggestions.selection.entries[id]).toMatchObject({ status: 'added', text: 'AI候補の機会A' });
    expect(get().opportunity).toBe(`${confirmedSwot.opportunity}\n自社で書いた機会\nAI候補の機会A`);
    expect(get().swotSuggestions.candidatePool.candidates.map((c: any) => c.text)).toEqual(['新しい機会の文です。', 'AI候補の脅威']);
  });

  it('確定 SWOT から候補の行を削除すると、削除として記録し、手入力の行は残す', () => {
    get().addSwotOpportunity('自社で書いた機会');
    get().setSwotSuggestions(suggestions);
    get().addSwotCandidate(idOf('AI候補の機会A'));
    get().removeSwotOpportunity('AI候補の機会A');
    expect(get().opportunity).toBe(`${confirmedSwot.opportunity}\n自社で書いた機会`);
    expect(entryOf('AI候補の機会A')).toMatchObject({ status: 'removed' });
  });

  it('候補の本文を編集すると、確定 SWOT の該当行も変わり、編集済みとして記録される', () => {
    get().setSwotSuggestions(suggestions);
    get().addSwotCandidate(idOf('AI候補の機会A'));
    get().editSwotCandidate(idOf('AI候補の機会A'), '編集後の機会');
    expect(get().opportunity).toBe(`${confirmedSwot.opportunity}\n編集後の機会`);
    expect(entryOf('AI候補の機会A')).toMatchObject({
      status: 'added',
      text: '編集後の機会',
      sourceText: 'AI候補の機会A',
      edited: true,
    });
  });

  it('存在しない候補の追加と、空の候補による再生成では、確定 SWOT も候補も変わらない', () => {
    get().setSwotSuggestions(suggestions);
    const before = get().swotSuggestions;
    get().addSwotCandidate('opp_missing');
    expect(get().opportunity).toBe(confirmedSwot.opportunity);
    get().setSwotSuggestions({ opportunity: [], threat: [] });
    expect(get().swotSuggestions).toBe(before);
  });

  it('確定 SWOT のテキストエリアで候補の行を消すと、選択記録も削除になる', () => {
    get().setSwotSuggestions(suggestions);
    get().addSwotCandidate(idOf('AI候補の機会A'));
    get().setSWOT({ opportunity: confirmedSwot.opportunity });
    expect(entryOf('AI候補の機会A')).toMatchObject({ status: 'removed' });
  });

  it('編集済みの候補をもう一度追加しても、確定 SWOT に元の文と編集後の文が二重に入らない', () => {
    get().setSwotSuggestions(suggestions);
    const id = idOf('AI候補の機会A');
    get().addSwotCandidate(id);
    get().editSwotCandidate(id, '編集後の機会');
    get().setSwotSuggestions(suggestions);
    get().addSwotCandidate(id);
    expect(get().opportunity).toBe(`${confirmedSwot.opportunity}\n編集後の機会`);
    expect(entryOf('AI候補の機会A')).toMatchObject({ status: 'added', text: '編集後の機会', edited: true });
  });

  it('テキストエリアで消した候補は、同じ候補の追加で元の文として戻せる', () => {
    get().setSwotSuggestions(suggestions);
    const id = idOf('AI候補の機会A');
    get().addSwotCandidate(id);
    get().setSWOT({ opportunity: confirmedSwot.opportunity });
    get().addSwotCandidate(id);
    expect(get().opportunity).toBe(`${confirmedSwot.opportunity}\nAI候補の機会A`);
    expect(entryOf('AI候補の機会A')).toMatchObject({ status: 'added', text: 'AI候補の機会A' });
  });
});

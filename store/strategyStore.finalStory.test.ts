/* STAGE2 最終ストーリーの draft / edited / final の役割分担を、ストア実体で確認する。Supabase 通信のみモック。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};
const mockListeners: Array<(u: typeof mockUser) => void> = [];
const mockGetFull = jest.fn<any, any[]>();
const mockSave = jest.fn<any, any[]>(async () => ({ ok: true }));

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => mockUser,
    subscribe: (fn: (u: unknown) => void) => {
      mockListeners.push(fn as (u: typeof mockUser) => void);
      return () => {};
    },
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const passthrough = (name: string) =>
    jest.fn(async () => {
      throw new Error(`unexpected call: ${name}`);
    });
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: (...args: any[]) => mockGetFull(...args),
    saveStrategyData: (...args: any[]) => mockSave(...args),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: (depts: any[]) =>
      (depts ?? []).reduce((n: number, d: any) => n + (d?.projects ?? []).length, 0),
    getFullStrategyDataByStrategyId: passthrough('getFullStrategyDataByStrategyId'),
    deleteStrategyData: passthrough('deleteStrategyData'),
  };
});

import { useStrategyStore } from './strategyStore';

const chapters = (tag: string) => [{ title: `第1章 ${tag}`, body: `${tag}の本文` }] as any[];
const get = () => useStrategyStore.getState() as any;

describe('STAGE2 最終ストーリーの役割分担', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrategyStore.setState({
      finalStoryDraft: [],
      finalStoryEdited: [],
      finalStoryFinal: [],
      saveStage2Snapshot: jest.fn(),
    } as any);
  });

  it('ケース1: draftのみ存在するとき、draftはたたき台として保持され、確定版は作られない', () => {
    get().setFinalStoryDraft(chapters('草稿'));

    expect(get().finalStoryDraft).toEqual(chapters('草稿'));
    expect(get().finalStoryEdited).toEqual([]);
    expect(get().finalStoryFinal).toEqual([]);
  });

  it('ケース2: draftとeditedが存在するとき、editedは編集状態として保持される', () => {
    get().setFinalStoryDraft(chapters('草稿'));
    get().setFinalStoryEdited(chapters('編集中'));

    expect(get().finalStoryDraft).toEqual(chapters('草稿'));
    expect(get().finalStoryEdited).toEqual(chapters('編集中'));
    expect(get().finalStoryFinal).toEqual([]);
  });

  it('ケース3: finalStoryFinalが存在するとき、draft/editedを更新しても確定版は維持される', () => {
    get().commitFinalStory(chapters('確定'));
    get().setFinalStoryDraft(chapters('新しい草稿'));
    get().setFinalStoryEdited(chapters('新しい編集'));

    expect(get().finalStoryFinal).toEqual(chapters('確定'));
  });

  it('ケース4: 確定版の復元では、draft/editedから確定版を作らず保存値をそのまま使う', () => {
    get().setFinalStoryDraft(chapters('草稿'));
    get().setFinalStoryEdited([]);

    get().commitFinalStory(chapters('確定'));

    expect(get().finalStoryFinal).toEqual(chapters('確定'));
    expect(get().finalStoryFinal).not.toEqual(chapters('草稿'));
  });

  it('ケース5: 草稿の再生成では、明示的な再確定をしない限り確定版が変わらない', () => {
    get().commitFinalStory(chapters('確定'));
    get().setFinalStoryEdited(chapters('編集中'));

    get().applyGeneratedDraft(chapters('再生成'));

    expect(get().finalStoryDraft).toEqual(chapters('再生成'));
    expect(get().finalStoryEdited).toEqual([]);
    expect(get().finalStoryFinal).toEqual(chapters('確定'));
  });

  it('ケース6: 既存企業の確定版は、草稿の反映や復元で初期化されない', () => {
    get().commitFinalStory(chapters('既存の確定版'));

    get().applyGeneratedDraft(chapters('新草稿'));
    get().setFinalStoryDraft(chapters('復元草稿'));

    expect(get().finalStoryFinal).toEqual(chapters('既存の確定版'));
  });
});

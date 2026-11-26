/* 部門IDの補完（同じIDを作らない）と、STAGE2の再生成後の未保存表示（保存内容と一致する時だけ外す）を検証する。
 * 保存の通信とユーザーだけをモックする。 */

export {};

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => ({ user: { id: 'user-1' }, companyId: null, membershipVerified: true }),
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    ...actual,
    getFullStrategyDataByCompany: jest.fn(async () => ({ data: null, error: null })),
    getFullStrategyDataByStrategyId: jest.fn(async () => ({ data: null, error: new Error('not used') })),
    saveStrategyData: jest.fn(async () => ({ data: null, error: null })),
  };
});

import { useStrategyStore, buildSavePayload } from './strategyStore';

const get = () => useStrategyStore.getState() as any;
const chapters = (tag: string) => [1, 2, 3, 4].map((i) => ({ title: `章${i}`, body: `${tag}の本文${i}` }));

describe('部門IDの補完は、同じ一覧の中で重複しない', () => {
  it('IDが無い部門は、使用中のIDと同じ値にならず、既存のIDはそのまま残る', () => {
    const payload = buildSavePayload({
      departments: [
        { id: 'dept_2', name: '部門A', projects: [] },
        { name: '部門B', projects: [] },
        { name: '部門C', projects: [] },
      ],
    } as any) as any;
    const ids = payload.departments.map((d: any) => d.id);
    expect(ids[0]).toBe('dept_2');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[2]).not.toBe('dept_2');
  });

  it('IDを持つ部門は、補完のルールで変わらない', () => {
    const payload = buildSavePayload({
      departments: [{ id: 'dept_1783172992693_abc', name: '部門A', projects: [] }],
    } as any) as any;
    expect(payload.departments[0].id).toBe('dept_1783172992693_abc');
  });
});

describe('保存後の未保存表示は、保存した内容と今の内容が一致する時だけ外れる', () => {
  beforeEach(() => {
    useStrategyStore.setState({ dirty: false, __savedDirtyHash: undefined } as any);
  });

  it('再生成の反映で内容が保存時と同じなら、未保存の印は残らない', () => {
    useStrategyStore.setState({ finalStoryEdited: chapters('旧'), finalStory: [], dirty: false } as any);
    get().markSavedPayload({ ...get() }, 7);
    // 再生成の反映（保存後にストアへ同じ内容を入れる）
    get().setFinalStoryEdited(chapters('旧'));
    get().setFinalStory([]);
    expect(get().dirty).toBe(true);
    get().settleDirtyIfSaved();
    expect(get().dirty).toBe(false);
  });

  it('保存後に内容が変わっていれば、未保存の印は残る（強制的には外さない）', () => {
    useStrategyStore.setState({ finalStoryEdited: chapters('旧'), finalStory: [], dirty: false } as any);
    get().markSavedPayload({ ...get() }, 7);
    get().setFinalStoryEdited(chapters('別の内容'));
    get().settleDirtyIfSaved();
    expect(get().dirty).toBe(true);
  });

  it('保存の記録がなければ、何も変えない', () => {
    useStrategyStore.setState({ dirty: true, __savedDirtyHash: undefined } as any);
    get().settleDirtyIfSaved();
    expect(get().dirty).toBe(true);
  });
});

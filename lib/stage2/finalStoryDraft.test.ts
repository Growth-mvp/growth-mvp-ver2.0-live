import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import {
  commitFinalStoryDraft,
  FINAL_STORY_PLACEHOLDER_BODY,
  isValidFinalStoryDraft,
  type FinalStoryDraftCommit,
  type FinalStoryDraftSaveResult,
} from './finalStoryDraft';

const chapters = (tag: string) =>
  ['第1章：なぜ今', '第2章：どう戦う', '第3章：どんな未来', '第4章：どう実行に落とすか'].map((title) => ({
    title,
    body: `${tag}の本文`,
  }));

const persisted = (tag: string, revision = 8): FinalStoryDraftSaveResult => ({
  data: { revision, finalStoryDraft: chapters(tag) },
  error: null,
});

function setup(overrides: Partial<FinalStoryDraftCommit> = {}) {
  const state = { run: 1 };
  const input: FinalStoryDraftCommit = {
    chapters: chapters('新草稿'),
    runId: 1,
    latestRunId: () => state.run,
    isScopeCurrent: () => true,
    save: jest.fn(async () => persisted('新草稿')),
    onSaved: jest.fn(),
    apply: jest.fn(),
    ...overrides,
  };
  return { input, state };
}

describe('isValidFinalStoryDraft', () => {
  it('4章すべてに本文がある結果を有効とする', () => {
    expect(isValidFinalStoryDraft(chapters('草稿'))).toBe(true);
  });

  it.each([
    ['空配列', []],
    ['配列でない値', 'text'],
    ['null', null],
    ['章数が足りない', chapters('草稿').slice(0, 3)],
    ['本文が空文字', [...chapters('草稿').slice(0, 3), { title: 't', body: '' }]],
    ['本文が空白のみ', [...chapters('草稿').slice(0, 3), { title: 't', body: '  \n' }]],
    ['本文が未生成プレースホルダー', [...chapters('草稿').slice(0, 3), { title: 't', body: FINAL_STORY_PLACEHOLDER_BODY }]],
    ['titleが欠落', [...chapters('草稿').slice(0, 3), { body: '本文' }]],
    ['章がnull', [...chapters('草稿').slice(0, 3), null]],
  ])('%s は無効とする', (_label, value) => {
    expect(isValidFinalStoryDraft(value)).toBe(false);
  });
});

describe('commitFinalStoryDraft', () => {
  it('今回の下書きが保存結果に含まれる場合だけ、保存成功として一度反映する', async () => {
    const { input } = setup();

    const outcome = await commitFinalStoryDraft(input);

    expect(outcome).toEqual({ status: 'applied' });
    expect(input.save).toHaveBeenCalledTimes(1);
    expect(input.onSaved).toHaveBeenCalledWith(8);
    expect(input.apply).toHaveBeenCalledWith(chapters('新草稿'));
  });

  it('保存がスキップされ error が null でも、下書きが保存されていなければ反映しない', async () => {
    for (const skipped of [
      { data: null, error: null },
      { data: { revision: 7, finalStoryDraft: chapters('旧草稿') }, error: null },
    ]) {
      const { input } = setup({ save: jest.fn(async () => skipped) });

      const outcome = await commitFinalStoryDraft(input);

      expect(outcome).toEqual({ status: 'not_persisted' });
      expect(input.onSaved).not.toHaveBeenCalled();
      expect(input.apply).not.toHaveBeenCalled();
    }
  });

  it('空・不正な結果は保存を呼ばず、画面も変更しない', async () => {
    for (const bad of [[], chapters('x').slice(0, 2), null]) {
      const { input } = setup({ chapters: bad });

      const outcome = await commitFinalStoryDraft(input);

      expect(outcome).toEqual({ status: 'invalid' });
      expect(input.save).not.toHaveBeenCalled();
      expect(input.onSaved).not.toHaveBeenCalled();
      expect(input.apply).not.toHaveBeenCalled();
    }
  });

  it('保存が失敗した場合、反映せず失敗を返す', async () => {
    const error = { code: 'REVISION_CONFLICT', message: 'conflict' };
    const { input } = setup({ save: jest.fn(async () => ({ data: null, error })) });

    const outcome = await commitFinalStoryDraft(input);

    expect(outcome).toEqual({ status: 'save_failed', error });
    expect(input.onSaved).not.toHaveBeenCalled();
    expect(input.apply).not.toHaveBeenCalled();
  });

  it('保存前に新しい生成が始まっていれば、古い結果は保存しない', async () => {
    const { input, state } = setup({ runId: 1 });
    state.run = 2;

    const outcome = await commitFinalStoryDraft(input);

    expect(outcome).toEqual({ status: 'stale' });
    expect(input.save).not.toHaveBeenCalled();
    expect(input.apply).not.toHaveBeenCalled();
  });

  it('保存中に新しい生成が始まった場合、古い結果は画面に反映しない', async () => {
    const { input, state } = setup({
      runId: 1,
      save: jest.fn(async () => {
        state.run = 2;
        return persisted('新草稿');
      }),
    });

    const outcome = await commitFinalStoryDraft(input);

    expect(outcome).toEqual({ status: 'stale' });
    expect(input.onSaved).toHaveBeenCalledWith(8);
    expect(input.apply).not.toHaveBeenCalled();
  });

  it('保存スコープが変わった場合は保存結果を破棄する', async () => {
    const { input } = setup({ save: jest.fn(async () => null), isScopeCurrent: () => false });

    const outcome = await commitFinalStoryDraft(input);

    expect(outcome).toEqual({ status: 'out_of_scope' });
    expect(input.onSaved).not.toHaveBeenCalled();
    expect(input.apply).not.toHaveBeenCalled();
  });

  it('連続生成では、最後に開始した生成だけが反映される', async () => {
    const state = { run: 0 };
    const start = () => ++state.run;
    const latestRunId = () => state.run;

    const first = start();
    const second = start();

    const saveSecond = commitFinalStoryDraft({
      chapters: chapters('二回目'),
      runId: second,
      latestRunId,
      isScopeCurrent: () => true,
      save: async () => persisted('二回目', 9),
      onSaved: jest.fn(),
      apply: jest.fn(),
    });
    const applyFirst = jest.fn();
    const outcomeFirst = await commitFinalStoryDraft({
      chapters: chapters('一回目'),
      runId: first,
      latestRunId,
      isScopeCurrent: () => true,
      save: async () => persisted('一回目'),
      onSaved: jest.fn(),
      apply: applyFirst,
    });

    expect(outcomeFirst).toEqual({ status: 'stale' });
    expect(applyFirst).not.toHaveBeenCalled();
    expect(await saveSecond).toEqual({ status: 'applied' });
  });
});

describe('保存後の再読み込み（DB行との往復）', () => {
  it('保存した下書きは、DB行から読み直しても同じ内容に戻り、確定版は変わらない', () => {
    const toSave = {
      id: 'strategy-1',
      company_id: 'company-1',
      finalStoryDraft: chapters('新草稿'),
      finalStoryEdited: [],
      finalStory: [],
      finalStoryFinal: chapters('確定'),
    };

    const row = buildDbRowFromState(toSave as any);
    const reloaded = buildStateFromDbRow({ ...row, id: 'strategy-1', company_id: 'company-1', revision: 9 });

    expect(reloaded.finalStoryDraft).toEqual(chapters('新草稿'));
    expect(reloaded.finalStoryEdited ?? []).toEqual([]);
    expect(reloaded.finalStoryFinal).toEqual(chapters('確定'));
  });
});

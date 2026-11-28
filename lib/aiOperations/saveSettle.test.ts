import { saveSentenceOf, waitForSaveSettled } from './saveSettle';
import { useStrategyStore } from '@/store/strategyStore';

jest.mock('@/store/strategyStore', () => ({ useStrategyStore: { getState: jest.fn() } }));

function setDirty(dirty: boolean) {
  (useStrategyStore.getState as jest.Mock).mockReturnValue({ dirty, boot: { isSaving: false }, saveError: undefined });
}

describe('反映後の保存状態の説明', () => {
  it('画面左下の表示と同じ状態を説明する（「保存」と言うのは保存済みのときだけ）', () => {
    expect(saveSentenceOf('saved')).toContain('保存済み');
    expect(saveSentenceOf('dirty')).toContain('保存はまだです');
    expect(saveSentenceOf('saving')).toContain('保存中');
    expect(saveSentenceOf('error')).toContain('保存に失敗');
  });
});

describe('反映後に自動保存を待つ', () => {
  it('すでに保存済みなら、待たずに保存済みを返す', async () => {
    setDirty(false);
    await expect(waitForSaveSettled(1000)).resolves.toBe('saved');
  });

  it('自動保存が終わったら、保存済みを返す', async () => {
    setDirty(true);
    setTimeout(() => setDirty(false), 300);
    await expect(waitForSaveSettled(3000)).resolves.toBe('saved');
  });

  it('時間内に保存されなければ、未保存のまま返す（画面の表示と同じ）', async () => {
    setDirty(true);
    await expect(waitForSaveSettled(300)).resolves.toBe('dirty');
  });
});

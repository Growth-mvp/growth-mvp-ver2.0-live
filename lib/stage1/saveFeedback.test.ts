import { resolveStage1SaveFeedback } from './saveFeedback';

describe('resolveStage1SaveFeedback', () => {
  it('保存に成功したときだけ「保存しました」を出す', () => {
    expect(resolveStage1SaveFeedback({ ok: true, revision: 3 }, false)).toEqual({ state: 'success', message: '保存しました' });
  });

  it('変更がなくスキップされた自動保存は、メッセージを出さない', () => {
    expect(resolveStage1SaveFeedback({ ok: false, skipped: true, reason: 'dirty_false' }, false)).toEqual({ state: 'idle', message: '' });
    expect(resolveStage1SaveFeedback({ ok: false, skipped: true, reason: 'same_hash' }, false)).toEqual({ state: 'idle', message: '' });
  });

  it('手動保存で変更がないときは、その旨だけを出す', () => {
    expect(resolveStage1SaveFeedback({ ok: false, skipped: true, reason: 'same_hash' }, true)).toEqual({
      state: 'idle',
      message: '変更はありません',
    });
  });

  it('保存が失敗したときは成功にせず、エラーを出す', () => {
    expect(resolveStage1SaveFeedback({ ok: false, reason: 'api_error', error: new Error('x') }, false).state).toBe('error');
    expect(resolveStage1SaveFeedback(undefined, true).state).toBe('error');
  });
});

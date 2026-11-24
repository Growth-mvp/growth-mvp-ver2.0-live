import { appendCeoIntent, buildCeoIntentDraft, planCeoIntentReflect } from './ceoIntent';
import { useIntentReflectStore } from './intentReflectStore';

const Q = '私はこの会社を、地域の人が頼れる存在にしたいと考えています。来期の売上目標は何にすべきでしょうか。';
const TARGET = { companyId: 'c1', strategyId: 's1' };

describe('経営者の思いの抽出（原文のみ）', () => {
  it('本人の思いの文は、原文のまま返す', () => {
    expect(buildCeoIntentDraft({ question: Q, selection: { ownSentenceIndexes: [0] } })).toBe(
      '私はこの会社を、地域の人が頼れる存在にしたいと考えています。',
    );
  });

  it('戦略の質問の文は、番号で選ばれなければ入らない', () => {
    expect(buildCeoIntentDraft({ question: Q, selection: { ownSentenceIndexes: [0] } })).not.toContain('売上目標');
  });

  it('選ばれた番号がなければ、作らずに null を返す', () => {
    expect(buildCeoIntentDraft({ question: Q, selection: { ownSentenceIndexes: [] } })).toBeNull();
    expect(buildCeoIntentDraft({ question: Q, selection: { ownSentenceIndexes: [9] } })).toBeNull();
  });

  it('選択の形が違う応答は受け付けない', () => {
    expect(buildCeoIntentDraft({ question: Q, selection: { text: 'AIの創作' } })).toBeNull();
  });
});

describe('既存の文章がある時の反映方法', () => {
  it('入力欄が空なら、そのまま入れる', () => {
    expect(planCeoIntentReflect('', '思い')).toEqual({ mode: 'apply', value: '思い' });
    expect(planCeoIntentReflect('  ', '思い')).toEqual({ mode: 'apply', value: '思い' });
  });

  it('既存の文章があれば、利用者の選択を求める（勝手に上書きしない）', () => {
    expect(planCeoIntentReflect('既存の思い', '新しい思い')).toEqual({ mode: 'needs_choice' });
  });

  it('追記は、既存の文章を残して末尾に足す', () => {
    expect(appendCeoIntent('既存の思い', '新しい思い')).toBe('既存の思い\n\n新しい思い');
  });
});

describe('反映待ちの文章の保持（会社・戦略を運ぶ）', () => {
  beforeEach(() => useIntentReflectStore.getState().clearPending());

  it('反映待ちの文章と、その対象の会社・戦略を保持する', () => {
    useIntentReflectStore.getState().setPending(TARGET, '思い');
    expect(useIntentReflectStore.getState().pending?.target).toEqual(TARGET);
    expect(useIntentReflectStore.getState().pending?.text).toBe('思い');
  });

  it('破棄すると、反映待ちは残らない', () => {
    useIntentReflectStore.getState().setPending(TARGET, '思い');
    useIntentReflectStore.getState().clearPending();
    expect(useIntentReflectStore.getState().pending).toBeNull();
  });
});

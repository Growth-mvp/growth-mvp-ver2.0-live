import { selectContextSources, selectStage56Sources } from './contextSelection';

describe('経営目標の達成可能性はSTAGE6の計画と財務を参照する', () => {
  it.each([
    '当社の経営目標は達成できそうですか？',
    '今の目標と計画の差はどのくらいですか？',
    '将来の業績見通しを教えてください',
  ])('%s', (q) => {
    expect(selectStage56Sources(q).plan).toBe(true);
    expect(selectContextSources(q).finance).toBe(true);
  });

  it('進捗の未達の原因を尋ねる質問は、資金計画を参照しない（STAGE5の進捗で答える）', () => {
    const s = selectStage56Sources('目標未達の原因は何か？');
    expect(s.progress).toBe(true);
    expect(s.plan).toBe(false);
  });
});

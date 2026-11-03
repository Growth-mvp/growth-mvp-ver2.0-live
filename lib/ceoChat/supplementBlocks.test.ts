import { selectSupplementSources } from './contextSelection';
import { buildFocusAnswersBlock } from './supplementBlocks';
import { FICTIONAL_STRATEGY_ROW, QUALITY_QUESTIONS } from '../../eval/quality/fictionalCompany';

describe('質問に応じた補足の選択（すべては常時入れない）', () => {
  it.each([
    ['来年度の利益と資金繰りはどうなるか？', { cash: true, talent: false }],
    ['設備投資と人材採用のどちらを優先すべきか？', { cash: false, talent: true }],
    ['社長が今、最も優先すべきことは何か？', { cash: false, talent: false }],
    ['営業部門の進捗はどうなっているか？', { cash: false, talent: false }],
    ['運転資金は足りているか？', { cash: true, talent: false }],
    ['若手社員の育成はどう進めるべきか？', { cash: false, talent: true }],
  ])('%s', (q, expected) => {
    expect(selectSupplementSources(q)).toEqual(expected);
  });

  it('評価の7問のうち、人材の相談は Q6 だけ', () => {
    const talent = QUALITY_QUESTIONS.filter((q) => selectSupplementSources(q.text).talent).map((q) => q.id);
    expect(talent).toEqual([6]);
  });
});

describe('人材の相談で、関連する登録回答を先頭に出す', () => {
  it('保守人材の登録回答を、登録された内容のまま出す（推測しない）', () => {
    const text = buildFocusAnswersBlock(FICTIONAL_STRATEGY_ROW, '設備投資と人材採用のどちらを優先すべきか？');
    expect(text).toContain('【質問に関連する登録回答（STAGE2');
    expect(text).toContain('[ch1-q1・第1章]');
    expect(text).toContain('3〜5年後、中小製造業では保守人材が不足し、点検の遅れが困りごとになる。');
  });

  it('人材と関係のない質問では出さない', () => {
    expect(buildFocusAnswersBlock(FICTIONAL_STRATEGY_ROW, '来年度の利益はどうなるか？')).toBe('');
  });

  it('関連する登録回答が無ければ出さない（推測で補わない）', () => {
    expect(buildFocusAnswersBlock({ answers12: [] }, '人材をどう育てるか？')).toBe('');
  });
});

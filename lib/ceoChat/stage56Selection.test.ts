import { selectStage56Sources } from './contextSelection';

describe('STAGE5・6 の情報を、質問に応じて選ぶ（評価の7問）', () => {
  it.each([
    ['営業部門の進捗はどうなっているか？', { progress: true, plan: false }],
    ['目標未達の原因は何か？', { progress: true, plan: false }],
    ['遅れているプロジェクトはどれか？', { progress: true, plan: false }],
    ['このままでは3年後の利益はいくらになるか？', { progress: false, plan: true }],
    ['来年度の資金繰りは大丈夫か？', { progress: false, plan: true }],
    ['設備投資を増やしても借入返済は可能か？', { progress: false, plan: true }],
    ['今、最も優先すべき経営課題は何か？', { progress: true, plan: true }],
  ])('%s', (q, expected) => {
    expect(selectStage56Sources(q)).toEqual(expected);
  });

  it('関係のない質問では、STAGE5・6 を選ばない', () => {
    expect(selectStage56Sources('ROICとは何ですか？')).toEqual({ progress: false, plan: false });
  });
});

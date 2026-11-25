import { isStage5RegistrationQuestion } from './contextSelection';

describe('STAGE5の登録状況を尋ねる質問を検出する', () => {
  it.each([
    'STAGE5は入力できていますか？',
    '財務実績は登録されていますか？',
    'KRの実績はどうなっていますか？',
    '実施事項の進捗を教えて',
    '最近の社内共有には何がありますか？',
    'ステージ5の記録はどこまで入っていますか',
  ])('「%s」は登録状況の質問', (q) => {
    expect(isStage5RegistrationQuestion(q)).toBe(true);
  });

  it.each(['STAGE5とは何ですか？', 'ROICとは何ですか？', 'STAGE1の会社名を入力したい', '今日の天気は？'])(
    '「%s」は登録状況の質問ではない',
    (q) => {
      expect(isStage5RegistrationQuestion(q)).toBe(false);
    },
  );
});

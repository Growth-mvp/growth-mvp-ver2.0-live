import { consultationQueryOf } from './followUpContext';

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string) => ({ role: 'assistant', content });

describe('継続発話の文脈', () => {
  it('異議の返答は、直前の相談と結合する', () => {
    const q = consultationQueryOf([
      user('上司に自分の提案を理解してもらえないのですが、どうすべきでしょうか？'),
      assistant('まず懸念を確認してください。'),
      user('でも、上司は忙しくて話を聞く時間もくれないんです。'),
    ]);
    expect(q).toContain('上司に自分の提案を理解してもらえない');
    expect(q).toContain('でも、上司は忙しくて');
  });

  it('短い返答は、直前の相談と結合する', () => {
    const q = consultationQueryOf([user('資金繰りが厳しくなりそうで心配です。'), assistant('確認しましょう。'), user('はい')]);
    expect(q).toContain('資金繰りが厳しくなりそう');
  });

  it.each([
    ['来月の社内イベントの日程は？'],
    ['ROICとは？'],
    ['資料を保存する方法は？'],
    ['当社の戦略の弱点は何か'],
  ])('話題が変わった発話は、直前の相談を引き継がない：%s', (next) => {
    const q = consultationQueryOf([
      user('上司に自分の提案を理解してもらえないのですが、どうすべきでしょうか？'),
      assistant('まず懸念を確認してください。'),
      user(next),
    ]);
    expect(q).toBe(next);
  });

  it('最初の発話は、そのまま使う', () => {
    expect(consultationQueryOf([user('新規事業に参入すべきか？')])).toBe('新規事業に参入すべきか？');
  });
});

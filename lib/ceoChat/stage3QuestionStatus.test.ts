import { buildStage3QuestionStatusBlock } from './stage3QuestionStatus';
import { isStage3QuestionStatusQuestion, isStage5RegistrationQuestion } from './contextSelection';

const steps = (answered: number[]) =>
  Array.from({ length: 6 }, (_, i) => ({ stepNumber: i + 1, question: `問${i + 1}`, reason: '', answer: answered.includes(i + 1) ? '本文は出さない' : '' }));

describe('STAGE3の6つの問いの保存状況', () => {
  it('部門ごとの回答数と未回答の問いを示し、本文は含めない', () => {
    const r = buildStage3QuestionStatusBlock([
      { name: '宅配事業', answers2: [{ steps: steps([1, 2, 3, 4, 5, 6]) }] },
      { name: '新聞販売', answers2: [{ steps: steps([1, 3]) }] },
    ]);
    expect(r.status).toBe('PARTIAL');
    expect(r.text).toContain('6つの問い：一部登録（部門2件のうち、すべて回答済みは1件）');
    expect(r.text).toContain('- 宅配事業：回答 6/6問（すべて回答済み）');
    expect(r.text).toContain('- 新聞販売：回答 2/6問（未回答：第2・4・5・6問）');
    expect(r.text).not.toContain('本文は出さない');
  });

  it('回答が1つもない部門しかなければ「未登録」、部門がなければ「参照対象外」', () => {
    expect(buildStage3QuestionStatusBlock([{ name: 'A', answers2: [] }]).status).toBe('UNREGISTERED');
    expect(buildStage3QuestionStatusBlock([]).status).toBe('NOT_APPLICABLE');
  });

  it('空白だけの回答は、回答済みに数えない', () => {
    const r = buildStage3QuestionStatusBlock([{ name: 'A', answers2: [{ steps: steps([]).map((s, i) => ({ ...s, answer: i === 0 ? '   ' : '' })) }] }]);
    expect(r.text).toContain('回答 0/6問');
  });
});

describe('STAGE3の6つの問いの状況を尋ねる質問の検出', () => {
  it.each(['6つの問いはどこまで進んでいますか？', '部門戦略の6問は回答されていますか', 'STAGE3の入力はどうなっていますか？'])(
    '「%s」は状況の質問',
    (q) => expect(isStage3QuestionStatusQuestion(q)).toBe(true),
  );

  it.each(['部門戦略の6つの問いを開いて', '6つの問いとは何ですか？'])('「%s」は状況の質問ではない', (q) =>
    expect(isStage3QuestionStatusQuestion(q)).toBe(false),
  );

  it('STAGE5の質問は、STAGE3の質問として扱わない', () => {
    expect(isStage3QuestionStatusQuestion('STAGE5は入力できていますか？')).toBe(false);
    expect(isStage5RegistrationQuestion('6つの問いはどこまで進んでいますか？')).toBe(false);
  });
});

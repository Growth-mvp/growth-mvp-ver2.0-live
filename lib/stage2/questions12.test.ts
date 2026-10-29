import {
  STAGE2_CHAPTER_LABELS,
  STAGE2_MULTI_BUSINESS_HINT_IDS,
  STAGE2_QUESTIONS_12,
  getStage2QuestionById,
  getStage2QuestionsByChapter,
  mergeSavedAnswers12,
} from './questions12';

const EXPECTED_IDS = [
  'ch0-q1', 'ch0-q2',
  'ch1-q1', 'ch1-q2', 'ch1-q3', 'ch1-q4', 'ch1-q5', 'ch1-q6',
  'ch2-q1', 'ch2-q2',
  'ch3-q1', 'ch3-q2',
];

describe('STAGE2 12問の定義', () => {
  it('質問IDは ch0-q1〜ch3-q2 の12件で、この順に並ぶ', () => {
    expect(STAGE2_QUESTIONS_12.map((q) => q.id)).toEqual(EXPECTED_IDS);
  });

  it('章ごとの質問数は 2 / 6 / 2 / 2', () => {
    expect([0, 1, 2, 3].map((c) => getStage2QuestionsByChapter(c).length)).toEqual([2, 6, 2, 2]);
  });

  it('章名は4章分あり、新しい名称に統一されている', () => {
    expect(STAGE2_CHAPTER_LABELS).toEqual([
      '第1章：なぜ変わる必要があるのか',
      '第2章：これからどこで、どう戦うのか',
      '第3章：どんな会社を目指すのか',
      '第4章：何から始めるのか',
    ]);
  });

  it('新しい質問文が定義されている', () => {
    expect(getStage2QuestionById('ch0-q1')?.question).toBe(
      '現在、お客様や業界の変化の中で、最も危機と感じることは何ですか？',
    );
    expect(getStage2QuestionById('ch1-q1')?.question).toBe(
      '3〜5年後、お客様や社会はどのように変化し、その中でどんな困りごとや課題が増えているでしょうか？',
    );
    expect(getStage2QuestionById('ch3-q1')?.question).toBe(
      'この戦略を実現するために、経営者や経営を担う人が、まず起こすべき行動は何でしょうか？',
    );
  });

  it('複数事業の補足を出す対象は Q3〜Q6（ch1-q1〜ch1-q4）', () => {
    expect([...STAGE2_MULTI_BUSINESS_HINT_IDS].sort()).toEqual(['ch1-q1', 'ch1-q2', 'ch1-q3', 'ch1-q4']);
  });
});

describe('mergeSavedAnswers12（既存回答の復元）', () => {
  it('answer と deepDive は保存値を保持し、question は現行定義から取る', () => {
    const saved = [
      { id: 'ch1-q1', answer: '人手不足で作業が止まる', deepDive: { question: 'x', rationale: 'y' } },
    ];
    const merged = mergeSavedAnswers12(saved, []);

    const slot = merged.find((a) => a.id === 'ch1-q1');
    expect(slot?.answer).toBe('人手不足で作業が止まる');
    expect(slot?.deepDive).toEqual({ question: 'x', rationale: 'y' });
    expect(slot?.question).toBe(getStage2QuestionById('ch1-q1')?.question);
  });

  it('保存に無い質問は現在の回答を残し、常に12件を返す', () => {
    const current = [{ id: 'ch0-q2', answer: '入力中の回答' }];
    const merged = mergeSavedAnswers12([], current);

    expect(merged).toHaveLength(12);
    expect(merged.find((a) => a.id === 'ch0-q2')?.answer).toBe('入力中の回答');
    expect(merged.find((a) => a.id === 'ch0-q1')?.answer).toBe('');
  });

  it('現行定義に無い保存IDは捨て、既存回答の欠落は作らない', () => {
    const saved = [
      { id: 'ch0-q1', answer: '危機の回答' },
      { id: 'legacy-x', answer: '旧ID' },
    ];
    const merged = mergeSavedAnswers12(saved, []);

    expect(merged.map((a) => a.id)).toEqual(EXPECTED_IDS);
    expect(merged.find((a) => a.id === 'ch0-q1')?.answer).toBe('危機の回答');
  });
});

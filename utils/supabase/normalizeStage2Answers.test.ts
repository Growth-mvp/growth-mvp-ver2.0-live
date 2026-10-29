import { normalizeStrategyData } from './normalize';
import { getStage2QuestionById } from '@/lib/stage2/questions12';

describe('normalizeStrategyData: STAGE2 answers12', () => {
  it('question が無い旧データでも、既知IDの回答は落とさず現行の質問文を補う', () => {
    const out = normalizeStrategyData({
      answers12: [{ id: 'ch0-q1', answer: '顧客の内製化が進んでいる' }],
    } as any);

    expect(out.answers12).toEqual([
      expect.objectContaining({
        id: 'ch0-q1',
        question: getStage2QuestionById('ch0-q1')?.question,
        answer: '顧客の内製化が進んでいる',
      }),
    ]);
  });

  it('保存済みの古い question は現行IDの質問文で置き換える', () => {
    const out = normalizeStrategyData({
      answers12: [{ id: 'ch1-q1', question: '5年後、どんな商品やサービスが…', answer: '回答' }],
    } as any);

    expect(out.answers12?.[0].question).toBe(getStage2QuestionById('ch1-q1')?.question);
    expect(out.answers12?.[0].answer).toBe('回答');
  });

  it('未知IDで question も無い行は従来どおり破棄する', () => {
    const out = normalizeStrategyData({
      answers12: [{ id: 'unknown-id', answer: 'x' }],
    } as any);

    expect(out.answers12).toBeUndefined();
  });
});

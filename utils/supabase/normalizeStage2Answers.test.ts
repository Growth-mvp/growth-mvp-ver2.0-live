import { normalizeStrategyData } from './normalize';
import { getStage2QuestionById } from '@/lib/stage2/questions12';
import type { Stage2Answer } from '@/types/strategy';

function answers12Of(data: unknown): Stage2Answer[] | undefined {
  return (data as { answers12?: Stage2Answer[] }).answers12;
}

describe('normalizeStrategyData: STAGE2 answers12', () => {
  it('question が無い旧データでも、既知IDの回答は落とさず現行の質問文を補う', () => {
    const out = normalizeStrategyData({
      answers12: [{ id: 'ch0-q1', answer: '顧客の内製化が進んでいる' }],
    });

    expect(answers12Of(out)).toEqual([
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
    });
    const slot = answers12Of(out)?.[0];

    expect(slot?.question).toBe(getStage2QuestionById('ch1-q1')?.question);
    expect(slot?.answer).toBe('回答');
  });

  it('保存→再読込（jsonb往復）後も deepDive を保持し、question・answer は変えない', () => {
    const deepDive = {
      question: '3〜5年後に、お客様の現場で増える困りごとは何ですか？',
      rationale: '将来の顧客課題を具体化するため',
      generatedAt: '2026-10-29T00:27:42.000Z',
      sourceAnswerSnapshot: '人手不足で作業が止まる',
      answer: 'お客様の施工班が減る',
      appliedAnswer: 'お客様の施工班が減る',
      appliedAt: '2026-10-29T01:00:00.000Z',
      appliedBlock: '\n\n【AI深掘りで追加した考え】\nお客様の施工班が減る',
    };
    const saved = JSON.parse(
      JSON.stringify({ answers12: [{ id: 'ch1-q1', question: '古い文面', answer: '人手不足で作業が止まる', deepDive }] }),
    );

    const out = normalizeStrategyData(saved);

    expect(answers12Of(out)?.[0]).toEqual({
      id: 'ch1-q1',
      question: getStage2QuestionById('ch1-q1')?.question,
      answer: '人手不足で作業が止まる',
      required: false,
      deepDive,
    });
  });

  it('deepDive に question が無い壊れたデータは deepDive だけ落とし、回答は残す', () => {
    const out = normalizeStrategyData({
      answers12: [{ id: 'ch0-q1', answer: '危機', deepDive: { rationale: 'x' } }],
    });
    const slot = answers12Of(out)?.[0];

    expect(slot?.answer).toBe('危機');
    expect(slot).not.toHaveProperty('deepDive');
  });

  it('未知IDで question も無い行は従来どおり破棄する', () => {
    const out = normalizeStrategyData({
      answers12: [{ id: 'unknown-id', answer: 'x' }],
    });

    expect(answers12Of(out)).toBeUndefined();
  });
});

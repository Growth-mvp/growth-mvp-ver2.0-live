import { CONSULT_TONE_INSTRUCTION, withConsultTone } from './consultInstruction';

describe('通常の経営相談の開発者指示', () => {
  const history = [
    { role: 'user', content: '1回目' },
    { role: 'assistant', content: '回答' },
    { role: 'user', content: '2回目' },
  ];

  it('会話の末尾に独立した開発者指示を1件追加する', () => {
    const out = withConsultTone(history);
    expect(out.length).toBe(history.length + 1);
    expect(out[out.length - 1]).toEqual({ role: 'developer', content: CONSULT_TONE_INSTRUCTION });
  });

  it('既存の発言（利用者の原文を含む）は変えず、元の配列も変えない', () => {
    const out = withConsultTone(history);
    expect(out.slice(0, history.length)).toEqual(history);
    expect(history.length).toBe(3);
  });
});

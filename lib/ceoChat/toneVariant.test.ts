import { applyToneVariant, TONE_INSTRUCTION } from './toneVariant';

const base = [
  { role: 'system', content: 'S' },
  { role: 'user', content: '1回目' },
  { role: 'assistant', content: '回答' },
  { role: 'user', content: '2回目' },
];

describe('話し方の指示の付け方', () => {
  it('A は変更しない', () => {
    expect(applyToneVariant(base, 'A')).toEqual(base);
  });

  it('B は最終ユーザーメッセージの末尾に付加し、元の配列は変えない', () => {
    const out = applyToneVariant(base, 'B');
    expect(out[3].content).toBe(`2回目\n\n${TONE_INSTRUCTION}`);
    expect(out[1].content).toBe('1回目');
    expect(base[3].content).toBe('2回目');
    expect(out.length).toBe(base.length);
  });

  it('C は独立した開発者指示を末尾に追加し、既存の発言は変えない', () => {
    const out = applyToneVariant(base, 'C');
    expect(out.length).toBe(base.length + 1);
    expect(out[out.length - 1]).toEqual({ role: 'developer', content: TONE_INSTRUCTION });
    expect(out[3].content).toBe('2回目');
  });
});

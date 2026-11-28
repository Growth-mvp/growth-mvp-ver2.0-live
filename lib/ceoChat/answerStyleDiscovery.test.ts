import { buildAnswerStyleBlock } from './answerStyle';

describe('対話による見立ての変化の示し方', () => {
  it('継続発話では、見立てが変わった時に変化を一言で示し、真因とは断定しない', () => {
    const block = buildAnswerStyleBlock('conversation_followup');
    expect(block).toContain('当初は〜と見ていたが、今は〜の可能性が高そうです');
    expect(block).toContain('真因とは断定せず「可能性」と明記する');
  });

  it('異議・制約の返答でも、見立ての変化を示し、真因は断定しない', () => {
    const block = buildAnswerStyleBlock('objection');
    expect(block).toContain('見立てが変わったなら、その変化を一言で示し、真因とは断定しない');
  });

  it('最初の相談には、見立ての変化の指示を含めない', () => {
    expect(buildAnswerStyleBlock('conversation')).not.toContain('当初は');
  });
});

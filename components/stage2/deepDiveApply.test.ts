import type { Stage2Answer } from '@/types/strategy';
import { buildDeepDiveApplyPatch, isDeepDiveApplicable, isDeepDiveUnreflected } from './deepDiveApply';

const base = (over: Partial<Stage2Answer> = {}): Stage2Answer => ({
  id: 'ch0-q1',
  answer: '元の回答',
  ...over,
});

describe('深掘り回答の未反映判定', () => {
  it('深掘り回答がない・空の場合は未反映ではない', () => {
    expect(isDeepDiveUnreflected(base())).toBe(false);
    expect(isDeepDiveUnreflected(base({ deepDive: { question: 'Q', answer: '  ' } }))).toBe(false);
  });

  it('反映済みの回答と同じ場合は未反映ではない', () => {
    const a = base({ deepDive: { question: 'Q', answer: '追加', appliedAnswer: '追加' } });
    expect(isDeepDiveUnreflected(a)).toBe(false);
  });

  it('深掘り回答が未反映なら対象になる', () => {
    expect(isDeepDiveApplicable(base({ deepDive: { question: 'Q', answer: '追加' } }))).toBe(true);
  });

  it('元回答が深掘り後に変わっている場合は自動反映の対象にしない', () => {
    const a = base({
      answer: '編集後の回答',
      deepDive: { question: 'Q', answer: '追加', sourceAnswerSnapshot: '編集前の回答' },
    });
    expect(isDeepDiveUnreflected(a)).toBe(true);
    expect(isDeepDiveApplicable(a)).toBe(false);
  });
});

describe('buildDeepDiveApplyPatch', () => {
  it('元回答を残したまま深掘り回答を末尾に追加する', () => {
    const patch = buildDeepDiveApplyPatch(base({ deepDive: { question: 'Q', answer: ' 追加 ' } }));
    expect(patch?.answer).toBe('元の回答\n\n【AI深掘りで追加した考え】\n追加');
    expect(patch?.deepDive?.appliedAnswer).toBe('追加');
    expect(patch?.deepDive?.sourceAnswerSnapshot).toBe(patch?.answer);
  });

  it('反映後は未反映でなくなり、再反映しても二重追加しない', () => {
    const first = buildDeepDiveApplyPatch(base({ deepDive: { question: 'Q', answer: '追加' } }));
    const applied = base({ answer: first?.answer, deepDive: first?.deepDive });
    expect(isDeepDiveUnreflected(applied)).toBe(false);

    const edited = { ...applied, deepDive: { ...applied.deepDive!, answer: '追加を修正' } };
    const second = buildDeepDiveApplyPatch(edited);
    expect(second?.answer).toBe('元の回答\n\n【AI深掘りで追加した考え】\n追加を修正');
    expect(second?.answer?.split('【AI深掘りで追加した考え】').length).toBe(2);
  });

  it('深掘り回答が空の場合は null を返す', () => {
    expect(buildDeepDiveApplyPatch(base({ deepDive: { question: 'Q', answer: ' ' } }))).toBeNull();
    expect(buildDeepDiveApplyPatch(base())).toBeNull();
  });
});

import type { Stage2Answer } from '@/types/strategy';

const BLOCK_HEADER = '\n\n【AI深掘りで追加した考え】\n';

export function isDeepDiveUnreflected(answer: Stage2Answer): boolean {
  const addition = answer.deepDive?.answer?.trim();
  return !!addition && answer.deepDive?.appliedAnswer?.trim() !== addition;
}

/** 元回答が深掘り後に変わっていない未反映回答だけを、自動反映の対象にする */
export function isDeepDiveApplicable(answer: Stage2Answer): boolean {
  if (!isDeepDiveUnreflected(answer)) return false;
  const snapshot = answer.deepDive?.sourceAnswerSnapshot;
  return !(snapshot && snapshot !== (answer.answer ?? ''));
}

export function buildDeepDiveApplyPatch(answer: Stage2Answer): Partial<Stage2Answer> | null {
  const deepDive = answer.deepDive;
  const addition = deepDive?.answer?.trim();
  if (!deepDive || !addition) return null;

  let baseAnswer = answer.answer ?? '';
  if (deepDive.appliedBlock && baseAnswer.includes(deepDive.appliedBlock)) {
    baseAnswer = baseAnswer.replace(deepDive.appliedBlock, '');
  }

  const appliedBlock = BLOCK_HEADER + addition;
  const mergedAnswer = baseAnswer + appliedBlock;

  return {
    answer: mergedAnswer,
    deepDive: {
      ...deepDive,
      appliedAnswer: addition,
      appliedAt: new Date().toISOString(),
      appliedBlock,
      sourceAnswerSnapshot: mergedAnswer,
    },
  };
}

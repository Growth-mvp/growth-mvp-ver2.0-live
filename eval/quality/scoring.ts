/* 人の採点欄の雛形。自動検査は「補助」として分けて記録し、優劣は断定しない。 */
import { checkFacts, ungroundedNumbers } from './rubric';
import type { QualityQuestion } from './fictionalCompany';

export const DIMENSIONS: Array<{ key: string; criteria: string[]; note?: string }> = [
  { key: '自社固有の理解', criteria: ['C1'] },
  { key: '経営課題の洞察', criteria: ['C4'] },
  { key: '判断の根拠', criteria: ['C2', 'C3'] },
  { key: '実行可能な提案', criteria: ['C5', 'C6'] },
  { key: 'GROWTH SHIFTの基本思想との整合', criteria: ['C7'] },
  { key: '一般論との違い', criteria: [], note: 'A と B を並べて人が判断する（自動では判定しない）' },
  { key: '情報不足時の断定回避（補足）', criteria: ['C8'] },
];

export type AutoAssist = {
  missingFacts: string[];
  leakedFacts: string[];
  /** 根拠（質問文と送信した指示文）にない数値。人が確認する候補であり、誤りとは断定しない */
  ungroundedNumbers: string[];
};

export function autoAssistFor(
  answer: string,
  question: QualityQuestion,
  grounding: string,
  checkRequiredFacts: boolean
): AutoAssist {
  const facts = checkRequiredFacts
    ? checkFacts(answer, question.mustInclude, question.mustNotInclude)
    : { missing: [], leaked: checkFacts(answer, [], question.mustNotInclude).leaked };
  return {
    missingFacts: facts.missing,
    leakedFacts: facts.leaked,
    ungroundedNumbers: ungroundedNumbers(answer, grounding),
  };
}

export type ScoreSheet = {
  questionId: number;
  question: string;
  note: string;
  dimensions: Array<{
    dimension: string;
    criteria: string[];
    note?: string;
    humanScore: { A: number | null; B: number | null; scorer: string | null; comment: string };
  }>;
  autoAssist: { A: AutoAssist; B: AutoAssist };
};

/** 未採点の採点シートを作る。点は null のまま、採点者が入れる。 */
export function buildScoreSheet(
  question: QualityQuestion,
  answers: { A: string; B: string },
  grounding: { A: string; B: string }
): ScoreSheet {
  return {
    questionId: question.id,
    question: question.text,
    note: '人が採点するまで null のままにする。自動検査（autoAssist）は補助であり、採点・優劣の判定ではない。',
    dimensions: DIMENSIONS.map((d) => ({
      dimension: d.key,
      criteria: d.criteria,
      ...(d.note ? { note: d.note } : {}),
      humanScore: { A: null, B: null, scorer: null, comment: '' },
    })),
    autoAssist: {
      A: autoAssistFor(answers.A, question, grounding.A, false),
      B: autoAssistFor(answers.B, question, grounding.B, true),
    },
  };
}

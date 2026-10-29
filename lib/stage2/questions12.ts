export type Stage2QuestionDef = {
  id: string;
  question: string;
  reason: string;
  chapter: number;
  required: boolean;
};

export const STAGE2_QUESTIONS_12: Stage2QuestionDef[] = [
  {
    id: 'ch0-q1',
    question: '現在、お客様や業界の変化の中で、最も危機と感じることは何ですか？',
    reason: 'まず「何が危機か」を自分の言葉で特定すると、議論の土台がそろいます。',
    chapter: 0,
    required: false,
  },
  {
    id: 'ch0-q2',
    question: 'その危機を放置した場合、今後、自社が失うものは何でしょうか？',
    reason: '放置コスト（機会・信頼・人材・収益）を見える化すると「なぜ今やるか」が腑に落ちます。',
    chapter: 0,
    required: false,
  },
  {
    id: 'ch1-q1',
    question: '3〜5年後、お客様や社会はどのように変化し、その中でどんな困りごとや課題が増えているでしょうか？',
    reason: '将来の顧客の困りごとを先に言語化すると、提供価値を考える出発点がそろいます。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q2',
    question: 'その変化の中で、お客様が本当に求める「価値」は何であり、自社が選ばれる理由は何になるでしょうか？',
    reason: '提供価値を再定義すると、意思決定の軸が一本化します。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q3',
    question: 'その価値を生み出し続けるために、今から磨くべき自社の「強み」は何でしょうか？',
    reason: '限られた資源をどこに集中するかを決めます。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q4',
    question: 'その強みを活かし、成長していくために、今最も克服すべき課題は何でしょうか？',
    reason: 'ボトルネックを先に外すと、強みが成果に結びやすくなります。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q5',
    question: 'これからの変化を実現するうえで、最も大きな「壁」は何でしょうか？',
    reason: '人と組織の壁を言語化すると、伝わらない理由が解けます。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q6',
    question: '人・お金・時間を本当に重要なことへ集中するために、減らすこと、やめること、見直すことは何でしょうか？',
    reason: 'やめるを決めると、スピードと手応えが上がります。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch2-q1',
    question: 'この戦略が実現したとき、お客様や社会から「どんな会社」と思われたいですか？',
    reason: '外からの評価像をはっきりさせると、目指す価値が具体になります。',
    chapter: 2,
    required: false,
  },
  {
    id: 'ch2-q2',
    question:
      '3年後、この戦略が実現していたとしたら、会社の業績と、社員の仕事や働き方はどのように変わっていてほしいですか？',
    reason: '数字（売上・利益など）と手触り（やりがい・誇り）を両輪で描くと、未来の姿が実感を伴います。',
    chapter: 2,
    required: false,
  },
  {
    id: 'ch3-q1',
    question: 'この戦略を実現するために、経営者や経営を担う人が、まず起こすべき行動は何でしょうか？',
    reason: '最初に動くのは言葉ではなく行動です。小さくても具体的な初動を示すと、信頼が生まれます。',
    chapter: 3,
    required: false,
  },
  {
    id: 'ch3-q2',
    question: 'この戦略を前に進めるために、まず具体的に始めることは何でしょうか？',
    reason: '全員の一歩をそろえると、戦略が自分ごとになります。',
    chapter: 3,
    required: false,
  },
];

export const STAGE2_CHAPTER_LABELS = [
  '第1章：なぜ変わる必要があるのか',
  '第2章：これからどこで、どう戦うのか',
  '第3章：どんな会社を目指すのか',
  '第4章：何から始めるのか',
];

export const STAGE2_MULTI_BUSINESS_HINT_IDS = new Set(['ch1-q1', 'ch1-q2', 'ch1-q3', 'ch1-q4']);

export const STAGE2_MULTI_BUSINESS_HINT =
  '複数の事業がある場合は、必要に応じて事業ごとに分けてご記入ください。';

export function getStage2QuestionById(id: string): Stage2QuestionDef | undefined {
  return STAGE2_QUESTIONS_12.find((q) => q.id === id);
}

export function getStage2QuestionsByChapter(chapter: number): Stage2QuestionDef[] {
  return STAGE2_QUESTIONS_12.filter((q) => q.chapter === chapter);
}

type AnswerSlot<D> = { id: string; answer?: string; deepDive?: D };

/** 保存済みの answer / deepDive を現行の12問定義へ載せ替える（question は常に現行定義）。 */
export function mergeSavedAnswers12<D>(
  saved: AnswerSlot<D>[],
  current: AnswerSlot<D>[],
): { id: string; question: string; answer: string; required: boolean; deepDive?: D }[] {
  return STAGE2_QUESTIONS_12.map((def) => {
    const hit = saved.find((s) => s?.id === def.id);
    const cur = current.find((a) => a.id === def.id);
    return {
      id: def.id,
      question: def.question,
      answer: hit ? hit.answer ?? '' : cur?.answer ?? '',
      required: false,
      deepDive: hit ? hit.deepDive : cur?.deepDive,
    };
  });
}

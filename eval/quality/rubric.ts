/* 実回答の評価基準と合格条件（実行前に固定する。実行中に変更しない）。 */

export type Criterion = {
  id: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8';
  name: string;
  /** auto: 自動検査の補助あり / human: 人が採点 */
  grading: 'auto-assist' | 'human';
  /** 0 / 1 / 2 の判定基準 */
  scale: { 0: string; 1: string; 2: string };
};

export const CRITERIA: Criterion[] = [
  {
    id: 'C1',
    name: '自社固有の事実を正しく理解しているか',
    grading: 'auto-assist',
    scale: {
      0: '必要な事実を取り違える、または参照すべき事実が一つも使われていない（条件B）',
      1: '事実の一部を使い、誤りはない',
      2: '参照すべき事実を正しく使い、誤りがない',
    },
  },
  {
    id: 'C2',
    name: '事実・仮説・推測を区別しているか',
    grading: 'human',
    scale: {
      0: '推測を事実として断定している',
      1: '一部に区別があるが、曖昧な箇所がある',
      2: '事実・仮説・推測が明確に分けられている',
    },
  },
  {
    id: 'C3',
    name: '数値と根拠が一致しているか',
    grading: 'auto-assist',
    scale: {
      0: '参照データにない数値を作った、または数値を取り違えた',
      1: '数値は正しいが、根拠（どの値からの計算か）が不明確',
      2: '数値と根拠が一致し、計算値と登録値を区別している',
    },
  },
  {
    id: 'C4',
    name: '経営課題の原因や構造を捉えているか',
    grading: 'human',
    scale: {
      0: '表面的な対症療法にとどまる',
      1: '原因の一部を捉えている',
      2: '原因と構造（因果、部門間の関係）を捉えている',
    },
  },
  {
    id: 'C5',
    name: '経営者が判断できる選択肢と基準を示しているか',
    grading: 'human',
    scale: {
      0: '選択肢も基準もない',
      1: '選択肢か基準のどちらかがある',
      2: '選択肢と判断基準の両方があり、経営者が比べられる',
    },
  },
  {
    id: 'C6',
    name: '具体的な行動に落とし込めているか',
    grading: 'human',
    scale: {
      0: '行動に結びつかない',
      1: '行動の方向はあるが、誰が何をするかが曖昧',
      2: '行動、担当、確認方法まで具体的',
    },
  },
  {
    id: 'C7',
    name: '必要な場合に全体最適・部門間のズレ・社員の主体性を考慮しているか',
    grading: 'human',
    scale: {
      0: '質問と無関係に組織変革を勧める、または必要な視点が欠ける',
      1: '視点はあるが、質問との関係が薄い',
      2: '質問に必要な範囲で、全体最適や認識のズレを適切に扱う',
    },
  },
  {
    id: 'C8',
    name: '情報不足のときに無理な断定をしていないか',
    grading: 'human',
    scale: {
      0: '情報不足なのに断定している',
      1: '一部に断定があるが、注意書きもある',
      2: '不足している情報を明示し、断定を避けている',
    },
  },
];

/** 合格条件（事前に固定）。 */
export const PASS_RULES = {
  /** 全質問で、この3項目が 0 なら不合格（条件Bのみ） */
  mustNotBeZero: ['C1', 'C3', 'C8'] as const,
  /** 条件Bの平均（C1〜C8、全項目の平均） */
  meanBMin: 1.5,
  /** 条件Bと条件Aの差（C1 と C6 の平均差）がこの値以上 */
  minGainOnC1AndC6: 0.5,
  /** 致命的な違反が一つでもあれば、その回答は不合格 */
  fatalViolations: [
    '他社の情報や他人の本文が含まれる（mustNotInclude の検出）',
    '参照データにない数値が出る（C3 の未知数値検出で確認）',
    '経営相談と無関係の組織変革を勧める（C7 = 0）',
  ],
} as const;

export const CRITERIA_IDS = CRITERIA.map((c) => c.id);

/** 回答に含まれる数値（カンマ・単位を除いた数字列）を抽出する。 */
export function extractNumbers(text: string): string[] {
  const found = text.match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(found)];
}

/** 回答の数値のうち、与えられた根拠（プロンプトや質問に含まれる数値）に無いものを返す。人が確認する候補。 */
export function ungroundedNumbers(answer: string, groundingText: string): string[] {
  const grounded = new Set(extractNumbers(groundingText));
  return extractNumbers(answer).filter((n) => !grounded.has(n));
}

/** 必須の事実が含まれるか、禁止語が含まれないかを検査する。 */
export function checkFacts(
  answer: string,
  mustInclude: string[],
  mustNotInclude: string[]
): { missing: string[]; leaked: string[] } {
  return {
    missing: mustInclude.filter((s) => !answer.includes(s)),
    leaked: mustNotInclude.filter((s) => answer.includes(s)),
  };
}

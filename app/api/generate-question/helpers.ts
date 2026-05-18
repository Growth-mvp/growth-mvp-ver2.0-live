// /app/api/generate-question/helpers.ts

export type Depth = 'board' | 'exec' | 'ops';

/** 章ごとの最大ステップ数 */
export function maxStepsForChapter(chapterIndex: number): number {
  switch (chapterIndex | 0) {
    case 0: return 2;  // 第1章
    case 1: return 6;  // 第2章
    case 2: return 2;  // 第3章
    case 3: return 2;  // 第4章
    default: return 2;
  }
}

/** ステップを 1..max に丸める */
export function clampStepDyn(chapterIndex: number, step: number, min = 1): number {
  const max = maxStepsForChapter(chapterIndex);
  const s = Number.isFinite(step) ? Math.round(step) : min;
  return Math.max(min, Math.min(max, s));
}

/** 固定12問テンプレ（reasonを丁寧化） */
export const TEMPLATE12: Record<number, { question: string; reason: string }[]> = {
  0: [
    {
      question: '現在、お客様や業界の変化の中で危機と感じることは何ですか？',
      reason: 'まず「何が危機か」を自分の言葉で特定すると、議論の土台がそろいます。事実と肌感の両方を出すことで、共通の危機認識がつくられます。'
    },
    {
      question: 'その危機を放置しておくことで、今後自社が失うものは何ですか？',
      reason: '放置コスト（機会・信頼・人材・収益）を見える化すると「なぜ今やるか」が腑に落ちます。遅れるほど回復費用が膨らむ点も共有できます。'
    },
  ],
  1: [
    {
      question: '次の時代、私たちの事業を取り巻く市場や環境はどのような変化や世界が待っているでしょうか？',
      reason: '前提をバックキャスト（未来に合わせ直す）で考えることで、フォアキャスト思考から抜け出せます。技術・規制・顧客行動の変化を具体に挙げ、判断の土台を共有します。'
    },
    {
      question: 'その変化の中で、顧客が本当に求める「価値」は何であり、自社を選ぶ理由は何になるのでしょうか？',
      reason: '提供価値を再定義すると、意思決定の軸が一本化します。選ぶ・捨てるの基準が明確になり、取組みの部分最適化を防げます。'
    },
    {
      question: 'その価値を生み出し続けるために、今から投資し磨くべき当社の「強み」は何でしょうか？',
      reason: '限られた資源をどこに集中するかを決めます。磨く対象を特定すると、学習と再投資のループを設計でき、再現性のある優位に育ちます。'
    },
    {
      question: 'その強みを発揮するうえで、いま克服すべき「致命的な課題」は何でしょうか？',
      reason: 'ボトルネックを先に外すと、強みが成果に結びやすくなります。課題を一つに絞ると、解決の順番と必要な支援が見えます。'
    },
    {
      question: 'この変革を全社で実現するうえで、最も大きな「壁」や「抵抗」は何でしょうか？',
      reason: '人と組織の壁を言語化すると、伝わらない理由が解けます。早期に対処方針（情報の出し方・巻き込み方）を決め、摩擦を小さくできます。'
    },
    {
      question: '経営資源を集中させるために、いま「やめること」や「撤退すべきこと」は何でしょうか？',
      reason: 'やめるを決めると、スピードと手応えが上がります。トレードオフを明確にし、浮いた資源を勝ち筋に再配分できます。'
    },
  ],
  2: [
    {
      question: 'この戦略が実現したとき、社会や市場から私たちはどんな「新しい評価」を得たいですか？',
      reason: '外からの評価像をはっきりさせると、目指す価値が具体になります。ブランドや選ばれる理由の言語化が、社内外の納得につながります。'
    },
    {
      question: '3年後、この戦略が成功していたとして、会社の「業績の数字」はどのように変わり、社員一人ひとりの「仕事のやりがいや誇り」はどのように変わっているでしょう？',
      reason: '数字（売上・利益など）と手触り（やりがい・誇り）を両輪で描くと、未来の姿が実感を伴います。投資と還元の好循環も共有できます。'
    },
  ],
  3: [
    {
      question: 'この戦略を全社員に伝え、「本気だ」と感じてもらうために、経営層はまず「どんな行動」を起こすべきですか？',
      reason: '最初に動くのは言葉ではなく行動です。小さくても具体的な初動を示すと、信頼が生まれ、現場が動きやすくなります。'
    },
    {
      question: 'この戦略を進めるために、全社員に「明日から必ず変えてほしい行動」を挙げるとすれば何ですか？',
      reason: '全員の一歩をそろえると、戦略が自分ごとになります。行動ルールが明確だと、学習と改善のリズムが回り始めます。'
    },
  ],
};

/** JSON安全パース（ヒント/事例APIでも利用） */
export function safeParseJson<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try { return m ? (JSON.parse(m[0]) as T) : null; } catch { return null; }
  }
}

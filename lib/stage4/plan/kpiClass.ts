/* KPIの分類：活動の指標（行ったことの数）か、成果の指標（状態の変化）か。
 * 「記録」などの語だけでは判定しない。
 * 1. 成果を示す語（削減・改善・率・売上・受注など）があれば、成果（OUTCOME）。
 *    例：「計測・記録に必要な作業時間の削減率」→ 成果
 * 2. 活動を表す語（会議・研修・記録・提案・訪問など）が、件数・回数の単位で数えられていれば、活動（ACTIVITY）。
 *    例：「記録件数」「会議の開催回数」→ 活動
 * 3. どちらでもなければ、判定できない（UNCERTAIN）。利用者の確認に回す。 */

export type KpiClass = 'ACTIVITY' | 'OUTCOME' | 'UNCERTAIN';

export type KpiClassification = { class: KpiClass; reason: string };

const OUTCOME_WORDS =
  /削減|短縮|減少|増加|向上|改善|改良|率|比率|単価|売上|利益|粗利|受注|継続|定着|転換|満足|負担|不良|歩留|廃棄|コスト|費用|収益|回収|解約|成約|達成|軽減/;
const ACTIVITY_WORDS =
  /会議|研修|講座|受講|説明会|セミナー|訪問|配布|アンケート|記録|報告書|資料|作成|開催|実施|提案|商談|面談|架電|投稿|発信|点検|ヒアリング|周知|登録/;
const COUNT_UNITS = /^(件|回|人|社|名|数|件数|回数|人数)$/;
const COUNT_WORDS = /件数|回数|人数|数$|件$|回$|名$/;

export function classifyKpi(label: string, unit?: string): KpiClassification {
  const outcome = label.match(OUTCOME_WORDS);
  if (outcome) return { class: 'OUTCOME', reason: `成果を示す語「${outcome[0]}」を含む` };

  const activity = label.match(ACTIVITY_WORDS);
  const counted = COUNT_WORDS.test(label) || (unit !== undefined && COUNT_UNITS.test(unit));
  if (activity && counted) {
    return { class: 'ACTIVITY', reason: `活動「${activity[0]}」を件数・回数で数えている` };
  }
  return { class: 'UNCERTAIN', reason: '活動か成果か、この表記だけでは判定できない' };
}

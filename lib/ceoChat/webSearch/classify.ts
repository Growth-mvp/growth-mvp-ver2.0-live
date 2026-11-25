export type SearchCategory = 'A' | 'B' | 'C';

export type SearchNeed = {
  category: SearchCategory;
  searchNeeded: boolean;
};

/** 外部環境（市場・競合・規制・技術・最新動向）を指す語。業界中央値などのベンチマーク語は除外してから判定する */
const EXTERNAL_CUE =
  /市場|業界|競合|競争相手|他社|同業|規制|法改正|法律|法制度|補助金|税制|技術|(?<![A-Za-z])AI(?![A-Za-z])|DX|トレンド|動向|最新|需要|顧客業界|外部環境|環境変化|景気|為替|金利|原材料|市況|海外|成長機会|事業機会|新規事業|参入|競争|ライバル|物価|インフレ|円安|賃上げ|ニュース|統計/;

/** 利用者が検索を明示的に指示した語（「WEB検索して」「インターネットで調べて」など） */
const EXPLICIT_SEARCH_CUE =
  /(WEB|ウェブ|インターネット|ネット|外部)\s*検索|検索して|検索をして|検索してみて|(インターネット|ネット|WEB|ウェブ)で(調べ|検索)/i;

/** 検索機能が使えるかを尋ねる節（「WEB検索はできますか」など）。検索の指示とは区別する */
const CAPABILITY_ASK =
  /(できま|できる|できない|可能|使え|利用でき|対応し|ありま|接続でき)[^。！!]{0,10}(か|ですか|でしょうか)$|(機能|能力)[^。！!]{0,6}(ありま|ですか|でしょうか)/;

const BENCHMARK_CUE = /業界(中央値|平均|水準)|ベンチマーク/g;

/** 読点・句点で区切った節ごとに、検索の指示か能力の質問かを見る */
export function isExplicitWebSearchRequest(question: string): boolean {
  return (question ?? '')
    .split(/[、,。！!？?\n]+/)
    .some((clause) => EXPLICIT_SEARCH_CUE.test(clause) && !CAPABILITY_ASK.test(clause.trim()));
}

/** 当社・自社など、会社そのものを指す語 */
export const COMPANY_REF = /当社|自社|弊社|わが社|我が社|うちの|うちは|うちが/;

/** 外部環境の中で戦略や優位性を検証することを暗に求める語。会社への言及と組み合わさったときだけ使う */
const EVALUATIVE_CUE = /通用|妥当|優位|勝て|生き残|時代遅れ|時代に合|維持でき|維持可能|通じる/;

/**
 * 質問が外部の市場・競合・規制・技術情報を必要とするかを判定する。
 * - B: 外部の語だけがある → 検索する
 * - C: 外部の語と会社への言及がある、または会社への言及と戦略の検証語がある → 検索する
 * - A: どちらも無い → 検索しない（社内情報を優先）
 */
export function classifySearchNeed(question: string): SearchNeed {
  const text = (question ?? '').replace(BENCHMARK_CUE, '');
  const hasExternal = EXTERNAL_CUE.test(text);
  const hasCompanyRef = COMPANY_REF.test(text);

  if (isExplicitWebSearchRequest(text)) {
    return { category: hasCompanyRef ? 'C' : 'B', searchNeeded: true };
  }
  if (hasExternal) {
    return { category: hasCompanyRef ? 'C' : 'B', searchNeeded: true };
  }
  if (hasCompanyRef && EVALUATIVE_CUE.test(text)) {
    return { category: 'C', searchNeeded: true };
  }
  return { category: 'A', searchNeeded: false };
}

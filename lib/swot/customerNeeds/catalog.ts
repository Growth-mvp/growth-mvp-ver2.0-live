/**
 * 顧客課題の探索テーマ（固定カタログ）。
 * - 文は業種・企業に依存しない汎用の文で、企業の自由記述は入れない。
 * - 肯定的な証拠（課題がある）と否定的な証拠（課題が小さい・既存で足りる）の両方を探す。
 * - 検索に送るのはこのカタログの文と、許可済みの公開分類ラベルだけ。
 */

export type NeedPerspective =
  | 'user_pain'
  | 'time_cost'
  | 'safety_quality'
  | 'non_purchase'
  | 'existing_gap'
  | 'desired_outcome'
  | 'buyer_criteria'
  | 'cross_industry';

export type NeedTheme = {
  id: string;
  perspective: NeedPerspective;
  polarity: 'supporting' | 'disconfirming';
  theme: string;
};

export const NEED_THEMES: readonly NeedTheme[] = [
  {
    id: 'user_pain',
    perspective: 'user_pain',
    polarity: 'supporting',
    theme: '製品・サービスを実際に使う人が、作業・操作・持ち運び・保管などで感じている不便や不満',
  },
  {
    id: 'time_cost',
    perspective: 'time_cost',
    polarity: 'supporting',
    theme: '利用に伴う時間・手間・費用の負担と、そのために生じている非効率',
  },
  {
    id: 'safety_quality',
    perspective: 'safety_quality',
    polarity: 'supporting',
    theme: '安全性・品質・使いやすさについて利用者が挙げている問題や懸念',
  },
  {
    id: 'non_purchase',
    perspective: 'non_purchase',
    polarity: 'supporting',
    theme: '購入・導入を見送る理由や、導入後に利用が続かない理由に関する調査',
  },
  {
    id: 'existing_gap',
    perspective: 'existing_gap',
    polarity: 'supporting',
    theme: '既存の製品・サービスや代替手段への不満と、利用者が期待する成果とのずれ',
  },
  {
    id: 'desired_outcome',
    perspective: 'desired_outcome',
    polarity: 'supporting',
    theme: '利用者が本当に実現したい成果（売上・効率・安全・満足など）に関する調査',
  },
  {
    id: 'buyer_criteria',
    perspective: 'buyer_criteria',
    polarity: 'supporting',
    theme: '直接の顧客が製品・サービスを選ぶ基準の変化',
  },
  {
    id: 'cross_industry',
    perspective: 'cross_industry',
    polarity: 'supporting',
    theme: '別の業界で生じている、類似の利用者課題や未充足ニーズの公開事例',
  },
  {
    id: 'user_pain_disconfirm',
    perspective: 'user_pain',
    polarity: 'disconfirming',
    theme: '利用者の不満が小さい、または既存の製品・サービスで十分と示す調査や満足度の結果',
  },
  {
    id: 'existing_gap_disconfirm',
    perspective: 'existing_gap',
    polarity: 'disconfirming',
    theme: '既存の解決手段で利用者の課題が十分に満たされているとする公開情報',
  },
  {
    id: 'buyer_criteria_disconfirm',
    perspective: 'buyer_criteria',
    polarity: 'disconfirming',
    theme: '購買基準が変わっておらず、価格や既存性能が依然として重視されていることを示す結果',
  },
];

/** 1回の検索に入れるテーマの数。固定順で選ぶ（企業ごとの特別扱いはしない） */
export const NEED_THEME_SELECTION: readonly string[] = [
  'user_pain',
  'time_cost',
  'existing_gap',
  'desired_outcome',
  'user_pain_disconfirm',
  'existing_gap_disconfirm',
];

export function selectedNeedThemes(): NeedTheme[] {
  return NEED_THEME_SELECTION.map((id) => NEED_THEMES.find((t) => t.id === id)).filter(
    (t): t is NeedTheme => !!t
  );
}

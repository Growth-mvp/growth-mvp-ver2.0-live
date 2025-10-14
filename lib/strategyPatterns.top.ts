// /lib/strategyPatterns.top.ts
import type { TopStrategyPattern } from '@/types/strategy';

/** 経営レベル 勝ちパターン10選 */
export const topPatterns: TopStrategyPattern[] = [
  {
    id: 't1',
    title: '選択と集中（Focus & Scale）',
    summary: '事業領域を明確に絞り、資源を一点集中で優位を確立しスケール。',
    firstMove: '非コアの切り離しと集中ドメインの定義を経営会議で確定',
    kpiAxis: 'ROIC/営業利益率/成長率',
    pitfalls: ['「集中」の基準が曖昧', '撤退の意思決定が遅い'],
  },
  {
    id: 't2',
    title: 'グローバル化（Global Leverage）',
    summary: '成熟市場から海外・新興市場へ展開して成長機会を獲得。',
    firstMove: 'ターゲット国×カテゴリを2案に絞り先行投資と検証体制を設計',
    kpiAxis: '海外売上比率/立ち上がり期間',
    pitfalls: ['本社の過干渉', '現地適応の不足'],
  },
  {
    id: 't3',
    title: 'デジタル化（Digital Core Transformation）',
    summary: 'データ・AIを中核に業務と価値提供を再設計。',
    firstMove: '優先業務のデータ基盤と分析ユースケースを90日でPoC',
    kpiAxis: 'サイクルタイム/自動化率/データ活用率',
    pitfalls: ['IT導入が目的化', 'データ整備の後回し'],
  },
  {
    id: 't4',
    title: '顧客起点経営（Customer-Back）',
    summary: '顧客課題から逆算して事業構造・組織を再編。',
    firstMove: '主要セグメントの未解決課題を再定義し「捨てる顧客」も明示',
    kpiAxis: 'NPS/解約率/顧客生涯価値',
    pitfalls: ['社内都合による方針修正', '全方位で薄まる'],
  },
  {
    id: 't5',
    title: 'プラットフォーム戦略（Ecosystem Play）',
    summary: '他社を巻き込む仕組みでネットワーク効果を形成。',
    firstMove: '片面の圧倒的価値提案を設計し開発者/パートナー基盤を整備',
    kpiAxis: '参加者数/取引流通額/有効性',
    pitfalls: ['鶏卵問題で停滞', '手数料偏重で離反'],
  },
  {
    id: 't6',
    title: '垂直統合（Value Chain Integration）',
    summary: '上流〜下流の統合で品質/コスト/納期の支配力を高める。',
    firstMove: 'ボトルネック工程の内製化可否と投資回収プランを設計',
    kpiAxis: '粗利率/在庫回転/納期遵守',
    pitfalls: ['固定費過多', '柔軟性の喪失'],
  },
  {
    id: 't7',
    title: 'M&A・アライアンス（Inorganic Growth）',
    summary: '買収・提携でスピードとケイパビリティを獲得。',
    firstMove: '買収テーマ（技術/地域/チャネル）ごとのスクリーニング基準を決定',
    kpiAxis: 'PMI速度/シナジー実現率',
    pitfalls: ['PMIの遅延', '文化摩擦'],
  },
  {
    id: 't8',
    title: 'サプライチェーン再設計（Resilient Supply Chain）',
    summary: '地政学・災害・為替に耐える調達〜生産〜物流を再構築。',
    firstMove: '重要部材のリスクマップと二重化/在庫ポリシーを定義',
    kpiAxis: '在庫日数/リードタイム/供給安定度',
    pitfalls: ['過剰在庫とコスト膨張', '意思決定の遅さ'],
  },
  {
    id: 't9',
    title: '社会×経済価値の両立（Shared Value）',
    summary: '環境/地域/安全を事業成長の源泉に統合。',
    firstMove: 'マテリアリティを再定義し事業モジュールへ落とし込み',
    kpiAxis: 'GHG/省エネ率/社会連携指標',
    pitfalls: ['PR止まり', '本業と非連動'],
  },
  {
    id: 't10',
    title: '財務規律（Financial Discipline）',
    summary: '資本効率の高い利益体質へ転換（ROIC/FCF主義）。',
    firstMove: '事業ごとの資本コストと撤退/強化基準を明示',
    kpiAxis: 'ROIC/FCF/利益率',
    pitfalls: ['短期主義', '成長投資の萎縮'],
  },
];

/** t系IDの型安全な参照に使う補助エクスポート */
export const TOP_IDS = [
  't1', 't2', 't3', 't4', 't5',
  't6', 't7', 't8', 't9', 't10',
] as const;

export type TopPatternId = typeof TOP_IDS[number];

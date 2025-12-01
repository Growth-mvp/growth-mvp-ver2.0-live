// /lib/strategyPatterns.exec.ts
import type { ExecStrategyPattern } from '@/types/strategy';

/**
 * 実行レベル 勝ちパターン10選
 *
 * - 「現場でどう動くか」の再現性のある型
 * - 経営レベル（topPatterns）と組み合わせて、
 *   map ファイル（strategyPatterns.map.ts）で WinPattern などと紐づける前提
 */
export const execPatterns: ExecStrategyPattern[] = [
  {
    id: 'e1',
    title: '一点突破・水平展開',
    when: ['新市場検証', '焦点を絞れる', '資源が限られる'],
    firstStep: '1地域/1セグメントで勝率>60%を確立',
    kpi: '同一セグメント成約率/継続率',
    pitfalls: ['「一点」が曖昧', '横展開を急ぐ'],
  },
  {
    id: 'e2',
    title: '単価×価値の再定義',
    when: ['価格抵抗が強い', '価値訴求が弱い'],
    firstStep: '価値バンドル/サブスクの3案でA/B',
    kpi: 'ARPU/LTV/アップセル率',
    pitfalls: ['値上げ理由が語れない', '割引癖'],
  },
  {
    id: 'e3',
    title: '既存顧客深耕 > 新規獲得',
    when: ['チャーンが痛い', '紹介が弱い'],
    firstStep: '解約理由Top3への改善パッケージ実装',
    kpi: '解約率/NPS/紹介率',
    pitfalls: ['新規偏重KPI', '単発改善'],
  },
  {
    id: 'e4',
    title: 'フリクション撲滅ファネル',
    when: ['CVRが低い', '導線が複雑', '稟議が長い'],
    firstStep: '最重摩擦1箇所を定義→1スプリントで除去',
    kpi: '到達率/所要時間/ドロップ率',
    pitfalls: ['摩擦特定が曖昧', '一斉着手で薄まる'],
  },
  {
    id: 'e5',
    title: '現場主導の週次改善ループ',
    when: ['属人化', 'ベロシティ低い'],
    firstStep: '週1小改善（WBR）と公開ログ習慣化',
    kpi: '週次改善件数/定着率/サイクルタイム',
    pitfalls: ['経営が見ない', '継続しない'],
  },
  {
    id: 'e6',
    title: '顧客課題の前倒し解決（試供体験）',
    when: ['PoC止まり', '決裁が遅い'],
    firstStep: '導入前に成果の片鱗が見える試算/デモ提供',
    kpi: '商談→成約率/リードタイム',
    pitfalls: ['試供が代替化', '検証指標が曖昧'],
  },
  {
    id: 'e7',
    title: 'やらないこと宣言',
    when: ['多機能化で迷子', '満足度低い'],
    firstStep: '主要利用シーンを1つに絞り非コア凍結',
    kpi: 'コア機能DAU/満足度',
    pitfalls: ['政治的拡散', '徹底不足'],
  },
  {
    id: 'e8',
    title: 'チャネル二刀流（直販×間接）',
    when: ['学びはあるがスケール壁', '販路拡大'],
    firstStep: '直販で型確立→間接に移植/役割分担を明文化',
    kpi: 'パートナー成約率/立上期間',
    pitfalls: ['直販と競合', '責任分界曖昧'],
  },
  {
    id: 'e9',
    title: '原価の物語化（納得価格）',
    when: ['価格説得が難', '価値の裏側が不伝達'],
    firstStep: '品質/安全/安定の裏側を可視化し価格理由付け',
    kpi: '値引き率/粗利率/単価受容',
    pitfalls: ['単なる原価開示', '独りよがり'],
  },
  {
    id: 'e10',
    title: '勝ち筋の標準化（オンボ90点）',
    when: ['人依存', '新人立上遅い'],
    firstStep: 'トップの型→SOP/プレイブック化',
    kpi: 'オンボ期間/初月生産性',
    pitfalls: ['SOP陳腐化', '更新停滞'],
  },
];

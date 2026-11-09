// 開発用の架空企業のサンプル。保存済みの生成結果を、表示用に組み立てたもの（生成結果の本文は変えていない）。
// 実在の企業・プロジェクトとは対応しない。

import growth from './growth.json';
import profit from './profit.json';
import crossdept from './crossdept.json';

export type SamplePlan = {
  id: 'growth' | 'profit' | 'crossdept';
  label: string;
  source: string;
  bundle: unknown;
};

export const SAMPLE_PLANS: SamplePlan[] = [
  {
    id: 'growth',
    label: '成長戦略型（医療機関向け新用途）',
    source: 'Phase 2J の実AI出力を、Phase 2K で再検証した計画',
    bundle: growth,
  },
  {
    id: 'profit',
    label: '収益改善型（歩留まり・原価改善）',
    source: 'Phase 2I の保存済み出力を組み立てた計画（旧版の出力）',
    bundle: profit,
  },
  {
    id: 'crossdept',
    label: '組織横断型（業務自動化サービス）',
    source: 'Phase 2I の保存済み出力を組み立てた計画（旧版の出力）',
    bundle: crossdept,
  },
];

/* 財務効果の確認の流れを検証する：新STAGE4の文書画面（第5章の参考試算・財務効果の確認）を描画する（評価専用）。
 * 保存先は localStorage（stubs/flowStore.ts）。DB・認証・通信には接続しない。
 * 架空の案件（日本製罐の数値例に合わせた入力）は、保存データが無い初回だけ入れる。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import Stage4DocumentScreen from '@/components/okr/execution-plan/Stage4DocumentScreen';

const STORAGE_KEY = 'flow:FICTIONAL-CO';

const SEED_DEPARTMENTS = [
  {
    id: 'dept-sales',
    name: '営業部',
    mission: '塗料メーカーの保守需要を取り込む（架空）',
    projects: [
      {
        id: 'proj-coating',
        title: '塗料メーカー向けプロジェクト',
        ownerName: '鈴木一郎',
        planStatus: 'draft',
        role: 'REVENUE',
        impactRevenueMJPY: 60,
        impactOpIncomeMJPY: 40,
        impactRationale: '売上増加に伴う追加費用6百万円を見込む（架空）',
        impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20 },
        okrsV2: [{ id: 'kr-coating-1', label: '保守契約の継続率', target: 95, unit: '%', owner: '鈴木一郎', due: '2027-06' }],
      },
    ],
  },
];

const w = window as any;
if (!localStorage.getItem(STORAGE_KEY)) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ departments: SEED_DEPARTMENTS, revision: 0 }));
  w.__getStrategyState().departments = JSON.parse(JSON.stringify(SEED_DEPARTMENTS));
}
const state = w.__getStrategyState();
state.strength = '保守の確かさと速さ（架空）';
state.weakness = '中小の製造業向けの販路が限られる（架空）';
state.opportunity = '保守人材の不足で、点検の代行需要が増える（架空）';
state.threat = '価格競争の激化（架空）';

createRoot(document.getElementById('root')!).render(<Stage4DocumentScreen />);

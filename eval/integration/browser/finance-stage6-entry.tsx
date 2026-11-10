/* 財務効果の確認の流れを検証する：STAGE6の財務計画（統一PL・経路Bの試算）を描画する（評価専用）。
 * 保存先は localStorage（stubs/flowStore.ts）。DB・認証・通信には接続しない。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FinancePlanSection } from '@/components/stage6/FinancePlanSection';

createRoot(document.getElementById('root')!).render(<FinancePlanSection />);

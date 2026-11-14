/* 旧 /okr 画面の財務効果入力（FinanceEffectSection）を単独で描画する（評価専用）。通信はしない。 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceEffectSection } from '@/components/okr/FinanceEffectSection';
import type { FinanceEffect } from '@/types/strategy';

const INITIAL: FinanceEffect = {
  kind: 'COST_INCREASE',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 30_000_000,
  amountBasis: 'TOTAL',
  startYm: '2027-01',
  endYm: '2027-06',
  source: 'USER_INPUT',
  confirmed: false,
  sourceNote: '見積書（架空）',
};

function App() {
  const [effect, setEffect] = useState<FinanceEffect | undefined>(INITIAL);
  return (
    <FinanceEffectSection
      effect={effect}
      disabled={false}
      overlapCandidates={[]}
      onChange={setEffect}
      label="追加費用"
      mode="full"
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);

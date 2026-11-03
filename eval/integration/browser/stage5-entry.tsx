/* STAGE5 KR実績セクションの実コンポーネント（components/stage5/KrActualSection.tsx）をハーネスで描画する（評価専用）。
 * 記録の処理は実コードの lib/stage5/krActual.ts（recordKrActual）を使う。DB・外部APIには接続しない。 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KrActualSection } from '@/components/stage5/KrActualSection';
import { recordKrActual, krLocateMessage } from '@/lib/stage5/krActual';

const w = window as any;
const INITIAL = [
  { id: 'kr-retention', kind: 'CHURN', label: '保守契約の継続率', target: 95, unit: '%', scope: 'company', baseKey: 'churn', due: '2027-06', owner: '鈴木一郎' },
  { id: 'kr-deals', kind: 'ACQ', label: '新規商談数', target: 120, unit: '件', scope: 'company', baseKey: 'acq', due: '2027-03' },
  { id: '', kind: 'ACQ', label: 'IDのないKR', target: 10, unit: '件', scope: 'company', baseKey: 'acq' },
] as any[];

function Harness() {
  const [krs, setKrs] = useState<any[]>(INITIAL);
  w.__krs = () => krs;
  return (
    <KrActualSection
      krs={krs}
      onRecord={(krId, actual) => {
        const r = recordKrActual(krs, krId, actual);
        if (!r.ok) return { ok: false as const, error: krLocateMessage(r.reason) };
        setKrs(r.next);
        w.__recordLog = (w.__recordLog || []).concat([{ krId, value: actual.value, asOf: actual.asOf }]);
        return { ok: true as const };
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
    <Harness />
  </div>,
);

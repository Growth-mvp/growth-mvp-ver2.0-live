'use client';

import type { BridgeKR } from '@/utils/simulationBridge';

export type FinancialExclusionItem = {
  id: string;
  label: string;
  kind: BridgeKR['kind'];
  reason: string;
};

export function FinancialExclusionNotice({ items }: { items: FinancialExclusionItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
      <summary className="cursor-pointer font-medium">
        財務換算の根拠が未設定のKRがあるため、業績試算には含めていません（{items.length}件）
      </summary>
      <p className="mt-2 text-xs text-zinc-500">
        これらのKRは進捗の測定としては表示されますが、売上・費用・投資の試算には加算されません。財務効果が0円という意味ではなく、未算定です。
      </p>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <span className="font-medium">{item.label}</span>
            <span className="ml-2 text-xs text-zinc-500">（{item.kind}）{item.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

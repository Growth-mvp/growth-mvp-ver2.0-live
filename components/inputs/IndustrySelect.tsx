// components/inputs/IndustrySelect.tsx
'use client';

import { useStrategyStore } from '@/store/strategyStore';
import { industryOptions } from '@/utils/industryTemplates';

// セッターが無ければ setState にフォールバック
function setFieldSafe(store: any, key: string, value: any) {
  const fn = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
  if (typeof store?.[fn] === 'function') {
    store[fn](value);
  } else if (typeof useStrategyStore?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

export default function IndustrySelect() {
  const st = useStrategyStore() as any;
  const industry: string = st?.industry ?? '';

  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold mb-1">業種の選択</label>
      <select
        value={industry}
        onChange={(e) => setFieldSafe(st, 'industry', e.target.value)}
        className="w-full border rounded px-3 py-2 bg-white shadow-sm focus:outline-none"
      >
        <option value="">-- 選択してください --</option>
        {industryOptions.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}

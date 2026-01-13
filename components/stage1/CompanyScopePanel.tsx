// /components/stage1/CompanyScopePanel.tsx
'use client';

import { useMemo, useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

export default function CompanyScopePanel() {
  const companyName = useStrategyStore((s) => s.companyName ?? '');
  const industry = useStrategyStore((s) => s.industry ?? '');
  const setProfile = useStrategyStore((s) => s.setProfile);

  const handleCompanyNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setProfile({ companyName: e.target.value });
    },
    [setProfile]
  );

  const handleIndustryChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setProfile({ industry: e.target.value });
    },
    [setProfile]
  );

  const industryOptions = useMemo(
    () => [
      { value: '', label: '選択してください' },
      { value: 'manufacturing', label: '製造業' },
      { value: 'it', label: 'IT・ソフトウェア' },
      { value: 'retail', label: '小売' },
      { value: 'service', label: 'サービス' },
      { value: 'construction', label: '建設' },
      { value: 'finance', label: '金融' },
      { value: 'other', label: 'その他' },
    ],
    []
  );

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">① 対象企業（スコープ設定）</h2>

      <p className="text-sm text-gray-600 mb-6">
        STAGE1（企業価値分析）の前提となる企業情報を、最小限で設定します。
      </p>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1">会社名</label>
          <input
            className="border px-3 py-2 w-full"
            placeholder="例：株式会社センターボード"
            value={companyName}
            onChange={handleCompanyNameChange}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">業種</label>
          <select
            className="border px-3 py-2"
            value={industry}
            onChange={handleIndustryChange}
          >
            {industryOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

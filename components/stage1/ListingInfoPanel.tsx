// /components/stage1/ListingInfoPanel.tsx
'use client';

import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

/**
 * 上場情報パネル
 * - isListed（上場フラグ）
 * - ticker（ティッカーシンボル）
 * - pbrManual（PBR手入力値）
 */
export default function ListingInfoPanel() {
  const isListed = useStrategyStore((s) => !!(s as any).isListed);
  const ticker = useStrategyStore((s) => ((s as any).ticker ?? '') as string);
  const pbrManual = useStrategyStore((s) => ((s as any).pbrManual ?? '') as string);

  const setProfile = useStrategyStore((s) => s.setProfile);

  const handleIsListedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (setProfile) {
        setProfile({ isListed: e.target.checked });
      }
    },
    [setProfile]
  );

  const handleTickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (setProfile) {
        setProfile({ ticker: v });
      }
    },
    [setProfile]
  );

  const handlePbrManualChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (setProfile) {
        setProfile({ pbrManual: v });
      }
    },
    [setProfile]
  );

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h3 className="text-lg font-semibold">上場情報</h3>

      {/* 上場フラグ */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isListed}
            onChange={handleIsListedChange}
            className="w-4 h-4"
          />
          <span className="text-sm font-medium">上場企業</span>
        </label>
      </div>

      {/* ティッカー */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">ティッカーシンボル（任意）</label>
        <input
          type="text"
          value={ticker}
          onChange={handleTickerChange}
          placeholder="例：7203"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">上場企業の場合、ティッカーシンボルを入力するとPBRを自動取得できます。</p>
      </div>

      {/* PBR手入力 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">PBR（手入力値、任意）</label>
        <input
          type="text"
          value={pbrManual}
          onChange={handlePbrManualChange}
          placeholder="例：1.2"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">ティッカー自動取得が失敗した場合や、非上場企業の場合は手入力してください。</p>
      </div>
    </div>
  );
}

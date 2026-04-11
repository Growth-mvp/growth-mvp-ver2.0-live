// /components/stage1/ListingInfoPanel.tsx
'use client';

import type React from 'react';
import { useCallback } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';

/**
 * 上場情報パネル
 * - isListed（上場フラグ）
 * - ticker（ティッカーシンボル）
 * - pbrManual（PBR手入力値）
 *
 * IMPORTANT:
 * - 読み書き先を profile に統一（setProfile を使うなら必須）
 */
export default function ListingInfoPanel({ disabled }: { disabled?: boolean } = {}) {
  const isListed = useStrategyStore((s: StrategyState) => s.isListed ?? false);
  const ticker = useStrategyStore((s: StrategyState) => s.ticker ?? '');
  const pbrManual = useStrategyStore((s: StrategyState) => s.pbrManual ?? '');
  const setProfile = useStrategyStore((s: StrategyState) => s.setProfile);

  const handleIsListedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const checked = e.target.checked;
      if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
        console.log('[DEBUG_STAGE1][listing:onChange] before', { checked });
      }
      setProfile?.({ isListed: checked });
      if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
        const state = useStrategyStore.getState();
        console.log('[DEBUG_STAGE1][listing:onChange] after', {
          isListed: state.isListed,
          ticker: state.ticker,
          pbrManual: state.pbrManual,
        });
      }
    },
    [setProfile, disabled]
  );

  const handleTickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const value = e.target.value;
      if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
        console.log('[DEBUG_STAGE1][ticker:onChange] before', { value });
      }
      setProfile?.({ ticker: value || undefined });
      if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
        const state = useStrategyStore.getState();
        console.log('[DEBUG_STAGE1][ticker:onChange] after', {
          isListed: state.isListed,
          ticker: state.ticker,
          pbrManual: state.pbrManual,
        });
      }
    },
    [setProfile, disabled]
  );

  const handlePbrManualChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const value = e.target.value;
      if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
        console.log('[DEBUG_STAGE1][pbrManual:onChange] before', { value });
      }
      setProfile?.({ pbrManual: value || undefined });
      if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
        const state = useStrategyStore.getState();
        console.log('[DEBUG_STAGE1][pbrManual:onChange] after', {
          isListed: state.isListed,
          ticker: state.ticker,
          pbrManual: state.pbrManual,
        });
      }
    },
    [setProfile, disabled]
  );

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h3 className="text-lg font-semibold">上場情報</h3>

      {/* 上場フラグ */}
      <div>
        <label className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={isListed}
            onChange={handleIsListedChange}
            disabled={disabled}
            className="w-4 h-4 disabled:cursor-not-allowed"
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
          disabled={disabled}
          placeholder="例：7203"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-gray-500 mt-1">
          上場企業の場合、ティッカーシンボルを入力するとPBRを自動取得できます。
        </p>
      </div>

      {/* PBR手入力 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">PBR（手入力値、任意）</label>
        <input
          type="text"
          value={pbrManual}
          onChange={handlePbrManualChange}
          disabled={disabled}
          placeholder="例：1.2"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-gray-500 mt-1">
          ティッカー自動取得が失敗した場合や、非上場企業の場合は手入力してください。
        </p>
      </div>
    </div>
  );
}

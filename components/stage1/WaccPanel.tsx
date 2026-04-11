// /components/stage1/WaccPanel.tsx
'use client';

import type React from 'react';
import { useCallback } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';

/**
 * WACC（加重平均資本コスト）パネル
 * - waccManual（%）
 * - waccRationale（計算根拠・備考）
 *
 * IMPORTANT:
 * - stage1Benchmarks を共有している前提のため、更新時は必ず既存値を保持して merge する
 */
export default function WaccPanel({ disabled }: { disabled?: boolean } = {}) {
  const stage1Benchmarks = useStrategyStore((s: StrategyState) => s.stage1Benchmarks);
  const setStage1Benchmarks = useStrategyStore((s: StrategyState) => s.setStage1Benchmarks);

  const waccManual = stage1Benchmarks?.waccManual;
  const waccRationale = stage1Benchmarks?.waccRationale ?? '';

  const handleWaccManualChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const v = e.target.value;
      const num = v === '' ? undefined : Number(v);

      const base = stage1Benchmarks ?? {};
      setStage1Benchmarks?.({
        ...base,
        waccManual: Number.isFinite(num) ? num : undefined,
      });
    },
    [stage1Benchmarks, setStage1Benchmarks, disabled]
  );

  const handleWaccRationaleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      const v = e.target.value;

      const base = stage1Benchmarks ?? {};
      setStage1Benchmarks?.({
        ...base,
        waccRationale: v ? v : undefined,
      });
    },
    [stage1Benchmarks, setStage1Benchmarks, disabled]
  );

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h3 className="text-lg font-semibold">WACC（加重平均資本コスト）</h3>

      {/* WACC値 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">WACC（%）（任意）</label>
        <input
          type="number"
          step="0.1"
          value={waccManual ?? ''}
          onChange={handleWaccManualChange}
          disabled={disabled}
          placeholder="例：5.5"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-gray-500 mt-1">企業の加重平均資本コスト（%）を入力します。</p>
      </div>

      {/* 計算根拠 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">計算根拠・備考（任意）</label>
        <textarea
          value={waccRationale}
          onChange={handleWaccRationaleChange}
          disabled={disabled}
          placeholder="例：株式コスト 8.0%（CAPM）、負債コスト 2.5%（税後）、資本構成 60% equity / 40% debt"
          rows={3}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-gray-500 mt-1">WACC の計算方法や前提条件を記入してください。</p>
      </div>
    </div>
  );
}

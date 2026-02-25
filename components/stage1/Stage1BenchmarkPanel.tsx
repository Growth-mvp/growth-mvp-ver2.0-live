// /components/stage1/Stage1BenchmarkPanel.tsx
'use client';

import { useCallback } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import type { BenchmarkQuality, BenchmarkTarget, Stage1Benchmarks } from '@/types/strategy';

type BenchmarkKey = 'industryMedian' | 'competitorA' | 'competitorB';

const BENCHMARK_LABELS: Record<BenchmarkKey, string> = {
  industryMedian: '業界中央値',
  competitorA: '競合A',
  competitorB: '競合B',
};

const QUALITY_OPTIONS: Array<{ value: BenchmarkQuality; label: string }> = [
  { value: 'primary', label: 'プライマリー（一次調査）' },
  { value: 'secondary', label: 'セカンダリー（既存資料）' },
  { value: 'estimated', label: '推定値' },
  { value: 'reference', label: '参考値' },
];

function BenchmarkTargetInput({
  label,
  target,
  onChange,
}: {
  label: string;
  target: BenchmarkTarget | undefined;
  onChange: (target: BenchmarkTarget | undefined) => void;
}) {
  const handleChange = useCallback(
    (key: string, value: any) => {
      const current = target || {};
      const next: BenchmarkTarget = { ...current };

      if (key.startsWith('metrics.')) {
        const metricKey = key.split('.')[1];
        next.metrics = { ...(next.metrics || {}) };

        if (value === '' || value === null) {
          delete (next.metrics as any)[metricKey];
        } else {
          (next.metrics as any)[metricKey] = Number(value);
        }

        // metrics が空なら消す
        if (next.metrics && Object.keys(next.metrics).length === 0) {
          delete (next as any).metrics;
        }
      } else {
        if (value === '' || value === null) {
          delete (next as any)[key];
        } else {
          (next as any)[key] = value;
        }
      }

      onChange(Object.keys(next).length > 0 ? next : undefined);
    },
    [target, onChange]
  );

  return (
    <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
      <h4 className="font-semibold text-sm">{label}</h4>

      {/* 期間 */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">期間（例：2023年度、TTM）</label>
        <input
          type="text"
          className="border rounded px-2 py-1 w-full text-sm"
          placeholder="2023年度"
          value={target?.period ?? ''}
          onChange={(e) => handleChange('period', e.target.value || null)}
        />
      </div>

      {/* ソース・メモ */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">ソース・メモ（URL など）</label>
        <input
          type="text"
          className="border rounded px-2 py-1 w-full text-sm"
          placeholder="https://... または出所メモ"
          value={target?.sourceNote ?? ''}
          onChange={(e) => handleChange('sourceNote', e.target.value || null)}
        />
      </div>

      {/* 品質 */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">データ品質</label>
        <select
          className="border rounded px-2 py-1 w-full text-sm"
          value={target?.quality ?? ''}
          onChange={(e) => handleChange('quality', e.target.value || null)}
        >
          <option value="">選択してください</option>
          {QUALITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 指標 */}
      <div>
        <div className="text-xs font-medium text-gray-700 mb-2">指標値</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-600">成長率 (%)</label>
            <input
              type="number"
              className="border rounded px-2 py-1 w-full text-sm"
              placeholder="—"
              value={target?.metrics?.growthPct ?? ''}
              onChange={(e) => handleChange('metrics.growthPct', e.target.value || null)}
              step="0.1"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">営業利益率 (%)</label>
            <input
              type="number"
              className="border rounded px-2 py-1 w-full text-sm"
              placeholder="—"
              value={target?.metrics?.opMarginPct ?? ''}
              onChange={(e) => handleChange('metrics.opMarginPct', e.target.value || null)}
              step="0.1"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">ROIC (%)</label>
            <input
              type="number"
              className="border rounded px-2 py-1 w-full text-sm"
              placeholder="—"
              value={target?.metrics?.roicPct ?? ''}
              onChange={(e) => handleChange('metrics.roicPct', e.target.value || null)}
              step="0.1"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">資本回転率</label>
            <input
              type="number"
              className="border rounded px-2 py-1 w-full text-sm"
              placeholder="—"
              value={target?.metrics?.capitalTurnover ?? ''}
              onChange={(e) => handleChange('metrics.capitalTurnover', e.target.value || null)}
              step="0.01"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">PBR（倍）</label>
            <input
              type="number"
              className="border rounded px-2 py-1 w-full text-sm"
              placeholder="—"
              value={target?.metrics?.pbr ?? ''}
              onChange={(e) => handleChange('metrics.pbr', e.target.value || null)}
              step="0.01"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Stage1BenchmarkPanel() {
  const benchmarks = useStrategyStore((s: StrategyState) => s.stage1Benchmarks);
  const setBenchmarks = useStrategyStore((s: StrategyState) => s.setStage1Benchmarks);

  const handleUpdateTarget = useCallback(
    (key: BenchmarkKey, target: BenchmarkTarget | undefined) => {
      const next: Stage1Benchmarks = { ...(benchmarks || {}) };

      if (target === undefined) {
        delete next[key];
      } else {
        next[key] = target;
      }

      // ✅ 重要：ベンチ3枠が空でも、WACC が入っているなら undefined で全消ししない
      const hasAny =
        !!next.industryMedian ||
        !!next.competitorA ||
        !!next.competitorB ||
        typeof (next as any).waccManual === 'number' ||
        !!(next as any).waccRationale;

      setBenchmarks(hasAny ? next : undefined);
    },
    [benchmarks, setBenchmarks]
  );

  const hasBenchmarks =
    benchmarks && (benchmarks.industryMedian || benchmarks.competitorA || benchmarks.competitorB);

  return (
    <div className="border rounded-lg mb-6">
      {/* ヘッダー（折りたたみ無し：button→div） */}
      <div className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="text-lg font-semibold">外部ベンチマーク（任意）</div>
          {hasBenchmarks && (
            <div className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">設定済み</div>
          )}
        </div>
      </div>

      {/* パネル内容（常に表示） */}
      <div className="px-4 py-4 space-y-6">
        <p className="text-sm text-gray-600">
          外部ベンチマーク（業界中央値や競合企業）を入力すると、論点カード表示に「外部比較根拠」として反映されます。すべて任意です。
        </p>

        <div className="space-y-4">
          {(Object.keys(BENCHMARK_LABELS) as BenchmarkKey[]).map((key) => (
            <BenchmarkTargetInput
              key={key}
              label={BENCHMARK_LABELS[key]}
              target={benchmarks?.[key]}
              onChange={(target) => handleUpdateTarget(key, target)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

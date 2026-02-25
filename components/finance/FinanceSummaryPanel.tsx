'use client';

import React, { useMemo, useState } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

/* ========= 型定義 ========= */
type Row = {
  year: number;
  business_unit: string;
  revenue: number;
  operating_income: number;
  operating_margin_pct: number;
  revenue_share_pct: number;
};

/* ========= 正規化関数（objectや旧仕様にも対応） ========= */
function normalizeSummary(input: unknown): Row[] {
  if (!input) return [];
  // 文字列ならJSONパース
  let data: any;
  try {
    data = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    data = [];
  }

  // 既に配列
  if (Array.isArray(data)) return data as Row[];

  // 旧仕様: { items: [...] }
  if (data && typeof data === 'object' && Array.isArray((data as any).items)) {
    return (data as any).items as Row[];
  }

  // 旧仕様: { 2023: {...}, 2024: {...} }
  if (data && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, any>);
    if (entries.every(([k, v]) => typeof v === 'object')) {
      return entries.map(([year, d]) => ({
        year: Number(year),
        ...d,
      })) as Row[];
    }
  }

  // それ以外は空配列
  return [];
}

/* ========= メインコンポーネント ========= */
export default function FinanceSummaryPanel({
  initialYear,
  className = '',
  showHeader = true,
}: {
  initialYear?: number;
  className?: string;
  showHeader?: boolean;
}) {
  // Zustand store から financeSummary を取得（型不定対策）
  const rawSummary = useStrategyStore((s: StrategyState) => s.financeSummary) as unknown;
  const summary = normalizeSummary(rawSummary);

  const years = useMemo(() => {
    const yearList = Array.from(new Set(summary.map((r) => r.year))).sort((a, b) => a - b);
    return yearList;
  }, [summary]);

  const [year, setYear] = useState<number | undefined>(
    initialYear ?? (years.length ? years[years.length - 1] : undefined)
  );

  const rows = useMemo(() => {
    return summary
      .filter((r) => (year ? r.year === year : true))
      .sort((a, b) => b.revenue - a.revenue);
  }, [summary, year]);

  const totalRevenue = useMemo(() => {
    return rows.reduce((acc, r) => acc + (r.revenue || 0), 0);
  }, [rows]);

  const dataForChart = useMemo(() => {
    return rows.map((r) => ({
      name: r.business_unit,
      Revenue: r.revenue,
      OperatingIncome: r.operating_income,
    }));
  }, [rows]);

  /* ====== データがない場合 ====== */
  if (!summary.length) {
    return (
      <div
        className={`rounded-2xl border border-black/10 bg-white/60 p-4 text-sm text-gray-600 ${className}`}
      >
        集計サマリーがまだありません。CSVを取り込むと自動生成されます。
      </div>
    );
  }

  /* ====== メイン表示 ====== */
  return (
    <div
      className={`space-y-4 rounded-2xl border border-black/10 bg-white/60 p-4 backdrop-blur ${className}`}
    >
      {/* ヘッダー */}
      {showHeader && (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-base font-semibold text-gray-900">年度×事業サマリー</div>
            <div className="text-xs text-gray-500">
              売上・営業利益・利益率・構成比を年度別に集計（アップロード時に自動更新）
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">年度</label>
            <select
              value={year ?? ''}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)}
              className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* チャート */}
      <div className="h-72 w-full overflow-hidden rounded-xl border border-black/10 bg-white/70 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dataForChart} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip formatter={(val: any) => Intl.NumberFormat().format(Number(val))} />
            <Legend />
            {/* デフォルト色（カラールール指定なし） */}
            <Bar dataKey="Revenue" name="売上" />
            <Bar dataKey="OperatingIncome" name="営業利益" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* テーブル */}
      <div className="overflow-auto rounded-xl border border-black/10">
        <table className="min-w-full text-xs">
          <thead className="bg-white/70">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-700">事業</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">売上</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">営業利益</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">利益率%</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">構成比%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.year}-${r.business_unit}`} className="odd:bg-white/80 even:bg-white/60">
                <td className="px-3 py-2 text-gray-900">{r.business_unit}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Intl.NumberFormat().format(r.revenue)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Intl.NumberFormat().format(r.operating_income)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.operating_margin_pct?.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.revenue_share_pct?.toFixed(1)}
                </td>
              </tr>
            ))}
            <tr className="bg-white">
              <td className="px-3 py-2 font-semibold text-gray-900">合計</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {Intl.NumberFormat().format(totalRevenue)}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

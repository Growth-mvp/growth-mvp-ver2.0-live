// components/simulation/SimulationDashboard.tsx
'use client';

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

import type { StrategyData } from '@/types/strategy';
import { runOkrFinanceFromStrategy } from '@/utils/okrFinanceRunner';

const nz = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function formatJPY(n: number) {
  const v = Math.round(n);
  return v.toLocaleString('ja-JP');
}

export interface SimulationDashboardProps {
  strategy: StrategyData | null;
}

export default function SimulationDashboard({ strategy }: SimulationDashboardProps) {
  // Null ガード
  if (!strategy) {
    return (
      <div className="w-full rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-lg font-semibold">シミュレーション</div>
        <div className="mt-2 text-sm text-gray-600">
          戦略データが読み込まれていません。
        </div>
      </div>
    );
  }

  // runOkrFinanceFromStrategy を実行
  const result = useMemo(() => {
    try {
      return runOkrFinanceFromStrategy(strategy);
    } catch (error) {
      console.error('[SimulationDashboard] runOkrFinanceFromStrategy error:', error);
      return null;
    }
  }, [strategy]);

  // チャートデータ構築（yearly から revenue と op_income を抽出）
  const chartData = useMemo(() => {
    if (!result?.yearly || result.yearly.length === 0) return [];

    console.log(
      '[SimulationDashboard] Rendering chart with yearly data:',
      result.yearly.length,
      'years | krsCount:',
      result.meta?.krsCount,
    );

    return result.yearly.map((y) => ({
      year: y.year,
      revenue: nz(y.revenue),
      op_income: nz(y.op_income),
    }));
  }, [result]);

  if (!result) {
    return (
      <div className="w-full rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-lg font-semibold">シミュレーション</div>
        <div className="mt-2 text-sm text-gray-600">
          ベースラインが未設定です。STAGE1 の財務データを入力してください。
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="w-full rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-lg font-semibold">シミュレーション</div>
        <div className="mt-2 text-sm text-gray-600">
          グラフデータがありません。
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col gap-1">
          <div className="text-lg font-semibold">会社全体の推移（売上・営業利益）</div>
          <div className="text-sm text-gray-600">
            年次の売上と営業利益の推移を表示します。KRが0件の場合もベースラインを表示。
          </div>
          {result.meta?.warning && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {result.meta.warning}
            </div>
          )}
        </div>

        {/* 売上 */}
        <div className="mt-6">
          <div className="mb-2 text-sm font-medium text-gray-800">売上 推移（年次）</div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={(v) => formatJPY(Number(v))} />
                <Tooltip formatter={(v: any) => formatJPY(Number(v))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="売上"
                  stroke="#0f172a"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 営業利益 */}
        <div className="mt-6">
          <div className="mb-2 text-sm font-medium text-gray-800">営業利益 推移（年次）</div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={(v) => formatJPY(Number(v))} />
                <Tooltip formatter={(v: any) => formatJPY(Number(v))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="op_income"
                  name="営業利益"
                  stroke="#64748b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

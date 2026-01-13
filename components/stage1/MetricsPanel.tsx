// /components/stage1/MetricsPanel.tsx
'use client';

import { useMemo, useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type { FinanceSummaryRow } from '@/store/strategyStore';

/* ===============================
 * 型定義
 * =============================== */

type CompanyYearAgg = {
  year: number;
  revenue: number;
  operatingIncome: number;
  operatingMarginPct: number;
};

/* ===============================
 * ユーティリティ
 * =============================== */

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function buildCompanyAgg(rows: FinanceSummaryRow[]): CompanyYearAgg[] {
  const byYear = new Map<number, { revenue: number; op: number }>();

  for (const r of rows) {
    const y = Number(r.year);
    if (!Number.isFinite(y)) continue;

    const prev = byYear.get(y) ?? { revenue: 0, op: 0 };
    prev.revenue += toNumber(r.revenue);
    prev.op += toNumber(r.operating_income);
    byYear.set(y, prev);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return years.map((y) => {
    const v = byYear.get(y)!;
    const margin = v.revenue !== 0 ? (v.op / v.revenue) * 100 : 0;
    return {
      year: y,
      revenue: v.revenue,
      operatingIncome: v.op,
      operatingMarginPct: margin,
    };
  });
}

function calcCagr(start: number, end: number, years: number): number {
  if (start <= 0 || end <= 0 || years <= 0) return 0;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

function fmtJPY(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(n);
}

/* ===============================
 * メトリクスカード
 * =============================== */

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

/* ===============================
 * メインコンポーネント
 * =============================== */

export default function MetricsPanel() {
  const financeSummary = useStrategyStore((s) =>
    Array.isArray(s.financeSummary) ? s.financeSummary : []
  );
  const isListed = useStrategyStore((s) => !!s.isListed);
  const ticker = useStrategyStore((s) => s.ticker ?? '');
  const pbrManual = useStrategyStore((s) => s.pbrManual ?? '');
  const valueAnalysis = useStrategyStore((s) => s.valueAnalysis);
  const setProfile = useStrategyStore((s) => s.setProfile);

  // PBR手入力変更ハンドラ（setProfile経由で自動recompute）
  const handlePbrManualChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setProfile({ pbrManual: e.target.value });
    },
    [setProfile]
  );

  // 全社合算データ
  const companyAgg = useMemo(() => buildCompanyAgg(financeSummary), [financeSummary]);

  const latest = companyAgg.length > 0 ? companyAgg[companyAgg.length - 1] : null;
  const first = companyAgg.length > 0 ? companyAgg[0] : null;

  const revenueCagrPct = useMemo(() => {
    if (!first || !latest) return 0;
    const span = latest.year - first.year;
    return calcCagr(first.revenue, latest.revenue, span);
  }, [first, latest]);

  // valueAnalysis から各指標を取得
  const operatingMarginPctLatest = valueAnalysis?.operatingMarginPctLatest;
  const revenueCagrPctFromVA = valueAnalysis?.revenueCagrPct;
  const debtEquityRatio = valueAnalysis?.debtEquityRatio;
  const roic = valueAnalysis?.roic;
  const roe = valueAnalysis?.roe;
  const roa = valueAnalysis?.roa;
  const per = valueAnalysis?.per;
  const pbr = valueAnalysis?.pbr ?? (pbrManual ? toNumber(pbrManual) : undefined);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">③ 企業価値の主要指標（STAGE1）</h2>

      <p className="text-sm text-gray-600 mb-6">
        取り込んだ財務データから、全社合算の年次推移を整理し、企業価値分析（STAGE2）に接続します。
        まずは「現状の数値を見える化」することが目的です。
      </p>

      {/* 上場情報 */}
      <div className="border rounded p-4 mb-6 space-y-3">
        <div className="font-semibold">上場情報</div>
        <div className="text-sm text-gray-600">
          上場企業の場合はティッカー等を記録しておくと、将来の市場データ連携が容易になります（現時点では手入力でも可）。
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-1">上場企業</label>
            <div className="text-sm">{isListed ? 'Yes' : 'No'}</div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ティッカー（任意）</label>
            <div className="text-sm">{ticker || '—'}</div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">PBR（手入力・任意）</label>
            <input
              className="border px-3 py-2"
              value={pbrManual}
              onChange={handlePbrManualChange}
              placeholder="例：1.2"
            />
          </div>
        </div>
      </div>

      {/* 財務合算 */}
      <div className="border rounded p-4 mb-6">
        <div className="font-semibold mb-2">全社合算（年次）</div>

        {companyAgg.length === 0 ? (
          <div className="text-sm text-gray-500">
            financeSummary が未作成です。Step3FinanceUpload の取り込み・サマリー生成を先に完了してください。
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-600 mb-3">
              最新年（{latest?.year}年）の売上・営業利益・営業利益率を表示します。
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <MetricCard label="売上高（最新年）" value={latest ? fmtJPY(latest.revenue) : '—'} />
              <MetricCard label="営業利益（最新年）" value={latest ? fmtJPY(latest.operatingIncome) : '—'} />
              <MetricCard
                label="営業利益率（最新年）"
                value={
                  operatingMarginPctLatest != null
                    ? `${operatingMarginPctLatest.toFixed(1)}%`
                    : latest
                      ? `${latest.operatingMarginPct.toFixed(1)}%`
                      : '—'
                }
              />
              <MetricCard
                label="売上CAGR（期間）"
                value={
                  revenueCagrPctFromVA != null
                    ? `${revenueCagrPctFromVA.toFixed(1)}%`
                    : companyAgg.length >= 2
                      ? `${revenueCagrPct.toFixed(1)}%`
                      : '—'
                }
              />
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full text-sm border">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="border px-3 py-2 text-left">年度</th>
                    <th className="border px-3 py-2 text-right">売上高</th>
                    <th className="border px-3 py-2 text-right">営業利益</th>
                    <th className="border px-3 py-2 text-right">営業利益率</th>
                  </tr>
                </thead>
                <tbody>
                  {companyAgg.map((r) => (
                    <tr key={r.year}>
                      <td className="border px-3 py-2">{r.year}</td>
                      <td className="border px-3 py-2 text-right">{fmtJPY(r.revenue)}</td>
                      <td className="border px-3 py-2 text-right">{fmtJPY(r.operatingIncome)}</td>
                      <td className="border px-3 py-2 text-right">{r.operatingMarginPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* 5指標（ValueAnalysis） */}
      <div className="border rounded p-4">
        <div className="font-semibold mb-2">5指標（ValueAnalysis：現在の状態）</div>
        <div className="text-sm text-gray-600 mb-4">
          財務データ・BS情報・PBR手入力から自動計算されます。
          {valueAnalysis?.meta?.computedAt && (
            <span className="ml-2 text-xs text-gray-400">
              (最終計算: {new Date(valueAnalysis.meta.computedAt).toLocaleString('ja-JP')})
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MetricCard
            label="営業利益率（最新年）"
            value={operatingMarginPctLatest != null ? `${operatingMarginPctLatest.toFixed(1)}%` : '—'}
          />
          <MetricCard
            label="売上CAGR（期間）"
            value={revenueCagrPctFromVA != null ? `${revenueCagrPctFromVA.toFixed(1)}%` : '—'}
          />
          <MetricCard
            label="D/Eレシオ"
            value={debtEquityRatio != null ? `${debtEquityRatio.toFixed(2)}` : '—'}
          />
          <MetricCard label="ROIC" value={roic != null ? `${roic.toFixed(2)}%` : '—'} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="ROE" value={roe != null ? `${roe.toFixed(2)}%` : '—'} />
          <MetricCard label="ROA" value={roa != null ? `${roa.toFixed(2)}%` : '—'} />
          <MetricCard label="PER" value={per != null ? `${toNumber(per).toFixed(2)}` : '—'} />
          <MetricCard label="PBR" value={pbr != null ? `${toNumber(pbr).toFixed(2)}` : '—'} />
        </div>
      </div>
    </section>
  );
}

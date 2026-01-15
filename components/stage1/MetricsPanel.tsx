// /components/stage1/MetricsPanel.tsx
'use client';

import { useMemo, useCallback, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type { FinanceSummaryRow } from '@/store/strategyStore';
import type { ValueAnalysis, BusinessSegment } from '@/types/strategy';

/* ===============================
 * 安定した空参照（selector で ?? [] を使わないため）
 * =============================== */

const EMPTY_FINANCE_SUMMARY: FinanceSummaryRow[] = Object.freeze([]) as unknown as FinanceSummaryRow[];
const EMPTY_SEGMENTS: BusinessSegment[] = Object.freeze([]) as unknown as BusinessSegment[];

type PbrFetchState = 'idle' | 'loading' | 'success' | 'error';

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

function fmtPct(v: number | undefined, digits: number = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

function fmtNum(v: number | undefined, digits: number = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
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
 * セグメント別指標テーブル
 * =============================== */

type SegmentTableProps = {
  segments: Record<string, ValueAnalysis>;
  businessSegments: { id: string; name: string }[];
};

function SegmentMetricsTable({ segments, businessSegments }: SegmentTableProps) {
  // セグメント名の順序を businessSegments に合わせる
  const orderedSegments = useMemo(() => {
    const names = businessSegments.map((seg) => seg.name).filter((n) => n.trim() !== '');
    return names.filter((name) => segments[name] !== undefined);
  }, [segments, businessSegments]);

  if (orderedSegments.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        事業部別のデータがありません。事業セグメントを定義し、事業部別 PL/BS を入力してください。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[800px] w-full text-sm border">
        <thead className="bg-gray-50">
          <tr>
            <th className="border px-3 py-2 text-left">セグメント名</th>
            <th className="border px-3 py-2 text-right">営業利益率</th>
            <th className="border px-3 py-2 text-right">売上CAGR</th>
            <th className="border px-3 py-2 text-right">ROIC</th>
            <th className="border px-3 py-2 text-right">計算基準年</th>
          </tr>
        </thead>
        <tbody>
          {orderedSegments.map((name) => {
            const va = segments[name];
            return (
              <tr key={name} className="hover:bg-gray-50">
                <td className="border px-3 py-2 font-medium">{name}</td>
                <td className="border px-3 py-2 text-right">{fmtPct(va?.operatingMarginPctLatest)}</td>
                <td className="border px-3 py-2 text-right">{fmtPct(va?.revenueCagrPct)}</td>
                <td className="border px-3 py-2 text-right">{fmtPct(va?.roic, 2)}</td>
                <td className="border px-3 py-2 text-right text-gray-500">
                  {va?.meta?.basis?.latestYear ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ===============================
 * メインコンポーネント
 * =============================== */

export default function MetricsPanel() {
  // 安定した参照を使用（毎回新しい [] を作らない）
  const financeSummary = useStrategyStore((s) =>
    Array.isArray(s.financeSummary) ? s.financeSummary : EMPTY_FINANCE_SUMMARY
  );
  const isListed = useStrategyStore((s) => !!s.isListed);
  const ticker = useStrategyStore((s) => s.ticker ?? '');
  const pbrManual = useStrategyStore((s) => s.pbrManual ?? '');
  const valueAnalysis = useStrategyStore((s) => s.valueAnalysis);
  const segmentValueAnalysis = useStrategyStore((s) => s.segmentValueAnalysis);
  const businessSegments = useStrategyStore((s) => s.businessSegments ?? EMPTY_SEGMENTS);
  const setProfile = useStrategyStore((s) => s.setProfile);

  // PBR fetch state
  const [pbrFetchState, setPbrFetchState] = useState<PbrFetchState>('idle');
  const [pbrFetchMessage, setPbrFetchMessage] = useState<string>('');

  // PBR手入力変更ハンドラ（setProfile経由で自動recompute）
  const handlePbrManualChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setProfile({ pbrManual: e.target.value });
    },
    [setProfile]
  );

  // PBR API取得ハンドラ
  const handleFetchPbr = useCallback(async () => {
    if (!ticker) {
      setPbrFetchMessage('ティッカーを先に入力してください');
      setPbrFetchState('error');
      return;
    }

    setPbrFetchState('loading');
    setPbrFetchMessage('');

    try {
      const res = await fetch(`/api/market/pbr?ticker=${encodeURIComponent(ticker)}`);
      const data = await res.json();

      if (!res.ok) {
        setPbrFetchMessage(data.error || 'API error');
        setPbrFetchState('error');
        return;
      }

      if (data.pbr === null) {
        setPbrFetchMessage(data.message || 'データが見つかりません');
        setPbrFetchState('error');
        return;
      }

      // PBR を手入力欄に反映
      setProfile({ pbrManual: String(data.pbr) });
      setPbrFetchMessage(`PBR: ${data.pbr}（${data.isStub ? 'スタブAPI' : '取得成功'}）`);
      setPbrFetchState('success');
    } catch (err) {
      setPbrFetchMessage('通信エラー');
      setPbrFetchState('error');
    }
  }, [ticker, setProfile]);

  // 全社合算データ（旧形式用）
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

  // セグメント分析が利用可能か
  const hasSegmentAnalysis = segmentValueAnalysis && Object.keys(segmentValueAnalysis).length > 0;

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">④ 企業価値の主要指標（STAGE1）</h2>

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
            <div className="flex gap-2 items-center">
              <input
                className="border px-3 py-2 w-24"
                value={pbrManual}
                onChange={handlePbrManualChange}
                placeholder="例：1.2"
              />
              <button
                onClick={handleFetchPbr}
                disabled={pbrFetchState === 'loading' || !ticker}
                className={`px-3 py-2 text-sm rounded transition ${
                  pbrFetchState === 'loading' || !ticker
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {pbrFetchState === 'loading' ? '取得中...' : 'API取得'}
              </button>
            </div>
            {pbrFetchMessage && (
              <div
                className={`text-xs mt-1 ${
                  pbrFetchState === 'error' ? 'text-red-500' : 'text-green-600'
                }`}
              >
                {pbrFetchMessage}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 財務合算（旧形式 financeSummary がある場合） */}
      {companyAgg.length > 0 && (
        <div className="border rounded p-4 mb-6">
          <div className="font-semibold mb-2">全社合算（年次）</div>
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
        </div>
      )}

      {/* 全社 ValueAnalysis 指標カード */}
      <div className="border rounded p-4 mb-6">
        <div className="font-semibold mb-2">全社 ValueAnalysis（現在の状態）</div>
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
            value={fmtPct(operatingMarginPctLatest)}
          />
          <MetricCard
            label="売上CAGR（期間）"
            value={fmtPct(revenueCagrPctFromVA)}
          />
          <MetricCard
            label="D/Eレシオ"
            value={fmtNum(debtEquityRatio)}
          />
          <MetricCard label="ROIC" value={fmtPct(roic, 2)} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="ROE" value={fmtPct(roe, 2)} />
          <MetricCard label="ROA" value={fmtPct(roa, 2)} />
          <MetricCard label="PER" value={per != null ? fmtNum(toNumber(per)) : '—'} />
          <MetricCard label="PBR" value={pbr != null ? fmtNum(toNumber(pbr)) : '—'} />
        </div>

        {/* 計算時の注意点 */}
        {valueAnalysis?.meta?.notes && valueAnalysis.meta.notes.length > 0 && (
          <div className="mt-4 text-xs text-gray-500 bg-gray-50 p-3 rounded">
            <div className="font-medium mb-1">計算時の備考：</div>
            <ul className="list-disc list-inside space-y-0.5">
              {valueAnalysis.meta.notes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 事業部別 ValueAnalysis（セグメント分析） */}
      <div className="border rounded p-4">
        <div className="font-semibold mb-2">事業部別 ValueAnalysis</div>
        <div className="text-sm text-gray-600 mb-4">
          事業セグメントごとの主要指標を一覧表示します。セグメント BS が入力されている場合は ROIC も算出されます。
        </div>

        {hasSegmentAnalysis ? (
          <SegmentMetricsTable segments={segmentValueAnalysis!} businessSegments={businessSegments} />
        ) : (
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center">
            <p className="text-gray-500 text-sm">
              事業部別分析を行うには、「② 事業セグメント定義」でセグメントを追加し、
              <br />
              「③ 財務データ入力」で事業部別 PL/BS を入力してください。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

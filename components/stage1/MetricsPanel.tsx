// /components/stage1/MetricsPanel.tsx
'use client';

import { useMemo, useCallback, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type { FinanceSummaryRow } from '@/store/strategyStore';
import type { ValueAnalysis, BusinessSegment, FinancePLRow, FinanceBSRow } from '@/types/strategy';

/* ===============================
 * DEBUG フラグ
 * =============================== */
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

/* ===============================
 * 安定した空参照
 * =============================== */

const EMPTY_FINANCE_SUMMARY: FinanceSummaryRow[] = Object.freeze([]) as unknown as FinanceSummaryRow[];
const EMPTY_PL: FinancePLRow[] = Object.freeze([]) as unknown as FinancePLRow[];
const EMPTY_BS: FinanceBSRow[] = Object.freeze([]) as unknown as FinanceBSRow[];
const EMPTY_SEGMENTS: BusinessSegment[] = Object.freeze([]) as unknown as BusinessSegment[];
const EMPTY_SEG_PL: Record<string, FinancePLRow[]> = Object.freeze({}) as unknown as Record<string, FinancePLRow[]>;

type PbrFetchState = 'idle' | 'loading' | 'success' | 'error';
type AnalysisStatus = 'idle' | 'success' | 'error';

/* ===============================
 * 型定義
 * =============================== */

type CompanyYearAgg = {
  year: number;
  revenue: number;
  operatingIncome: number;
  operatingMarginPct: number;
};

type PortfolioPoint = {
  name: string;
  growthPct: number; // 売上CAGR（%）
  marginPct: number; // 営業利益率（%）
  roicPct?: number; // optional
  latestRevenue?: number; // 売上規模（最新年売上）
  latestYear?: number;
};

type QuadrantKey = 'FOCUS' | 'IMPROVE' | 'MAINTAIN' | 'EXIT';

/* ===============================
 * ユーティリティ
 * =============================== */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function nfkc(s: string) {
  try {
    return s.normalize('NFKC');
  } catch {
    return s;
  }
}

function normKey(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return nfkc(s).replace(/\s+/g, ' ');
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const cleaned = s.replace(/,/g, '').replace(/％/g, '').replace(/%/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** "2023年度" 等を許容して年度を推定 */
function parseYear(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return Math.round(n);

  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/(20\d{2}|19\d{2})/);
  if (!m) return null;

  const y = Number(m[1]);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
  return y;
}

/** いくつかの候補キーから最初に見つかった数値を取る */
function pickNumber(obj: any, keys: string[]): number {
  if (!obj || typeof obj !== 'object') return 0;
  for (const k of keys) {
    if (k in obj) {
      const n = toNumber(obj[k]);
      if (n !== 0) return n;
    }
  }
  for (const k of keys) {
    if (k in obj) return toNumber(obj[k]);
  }
  return 0;
}

function calcCagr(start: number, end: number, years: number): number | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(years)) return undefined;
  if (start <= 0 || end <= 0 || years <= 0) return undefined;
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

function uniqKeepOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const k = normKey(raw);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function median(nums: number[]): number | undefined {
  const a = nums.filter((n) => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (a.length === 0) return undefined;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 0 ? (a[mid - 1] + a[mid]) / 2 : a[mid];
}

/**
 * CAGR基準年：売上が正の最初/最後
 * - 2021が空でも 2022→2024 で算出
 */
function pickPositiveRevenueSpan(agg: CompanyYearAgg[]): { start?: CompanyYearAgg; end?: CompanyYearAgg; spanYears?: number } {
  const rows = (agg ?? []).slice().sort((a, b) => a.year - b.year);
  const positives = rows.filter((r) => Number.isFinite(r.revenue) && r.revenue > 0);
  if (positives.length < 2) return {};
  const start = positives[0];
  const end = positives[positives.length - 1];
  const span = end.year - start.year;
  return span > 0 ? { start, end, spanYears: span } : {};
}

function getBasisYears(va?: ValueAnalysis): { startYear?: number; latestYear?: number; spanYears?: number; yearsCount?: number } {
  const rawYears = Array.isArray((va as any)?.meta?.basis?.years) ? ((va as any).meta.basis.years as any[]) : [];
  const years = rawYears
    .map((y) => (typeof y === 'number' ? y : Number(y)))
    .filter((y) => Number.isFinite(y))
    .slice()
    .sort((a, b) => a - b);

  const startYear = years.length > 0 ? years[0] : undefined;

  const latestYearFromMeta = (va as any)?.meta?.basis?.latestYear;
  const latestYear =
    Number.isFinite(latestYearFromMeta as any)
      ? Number(latestYearFromMeta)
      : years.length > 0
        ? years[years.length - 1]
        : undefined;

  const spanYears =
    startYear != null && latestYear != null && Number.isFinite(startYear) && Number.isFinite(latestYear)
      ? Math.max(0, Number(latestYear) - Number(startYear))
      : undefined;

  return { startYear, latestYear, spanYears, yearsCount: years.length };
}

function buildCompanyAggFromFinanceSummary(rows: FinanceSummaryRow[]): CompanyYearAgg[] {
  const byYear = new Map<number, { revenue: number; op: number }>();

  for (const r of rows) {
    const y = parseYear((r as any).year);
    if (!y) continue;

    const prev = byYear.get(y) ?? { revenue: 0, op: 0 };
    const revenue = pickNumber(r, ['revenue', 'sales', '売上', '売上高']);
    const op = pickNumber(r, ['operating_income', 'operatingIncome', 'operating_profit', 'operatingProfit', '営業利益']);

    prev.revenue += revenue;
    prev.op += op;
    byYear.set(y, prev);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return years.map((y) => {
    const v = byYear.get(y)!;
    const margin = v.revenue !== 0 ? (v.op / v.revenue) * 100 : 0;
    return { year: y, revenue: v.revenue, operatingIncome: v.op, operatingMarginPct: margin };
  });
}

function buildCompanyAggFromFinancePL(rows: FinancePLRow[]): CompanyYearAgg[] {
  const byYear = new Map<number, { revenue: number; op: number }>();

  for (const r of rows as any[]) {
    const y = parseYear(r?.year);
    if (!y) continue;

    const prev = byYear.get(y) ?? { revenue: 0, op: 0 };
    const revenue = pickNumber(r, ['revenue', 'sales', 'amount', '売上', '売上高']);
    const op = pickNumber(r, ['operatingIncome', 'operating_income', 'operatingProfit', 'operating_profit', '営業利益']);

    prev.revenue += revenue;
    prev.op += op;
    byYear.set(y, prev);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return years.map((y) => {
    const v = byYear.get(y)!;
    const margin = v.revenue !== 0 ? (v.op / v.revenue) * 100 : 0;
    return { year: y, revenue: v.revenue, operatingIncome: v.op, operatingMarginPct: margin };
  });
}

/* ===============================
 * セグメントの簡易VA（欠損時の暫定算出）
 * =============================== */

function buildMiniVAFromSegmentPL(rows: FinancePLRow[]): ValueAnalysis | undefined {
  const byYear = new Map<number, { revenue: number; op: number }>();
  for (const r of rows as any[]) {
    const y = parseYear(r?.year);
    if (!y) continue;

    const prev = byYear.get(y) ?? { revenue: 0, op: 0 };
    const revenue = pickNumber(r, ['revenue', 'sales', 'amount', '売上', '売上高']);
    const op = pickNumber(r, ['operatingIncome', 'operating_income', 'operatingProfit', 'operating_profit', '営業利益']);

    prev.revenue += revenue;
    prev.op += op;
    byYear.set(y, prev);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  if (years.length === 0) return undefined;

  const agg: CompanyYearAgg[] = years.map((y) => {
    const v = byYear.get(y)!;
    const margin = v.revenue !== 0 ? (v.op / v.revenue) * 100 : 0;
    return { year: y, revenue: v.revenue, operatingIncome: v.op, operatingMarginPct: margin };
  });

  const latest = agg[agg.length - 1];
  const span = pickPositiveRevenueSpan(agg);
  const cagr =
    span.start && span.end && span.spanYears ? calcCagr(span.start.revenue, span.end.revenue, span.spanYears) : undefined;

  const basisYears =
    span.start && span.end
      ? [span.start.year, span.end.year]
      : agg.length >= 2
        ? [agg[0].year, agg[agg.length - 1].year]
        : [latest.year];

  const mini = {
    operatingMarginPctLatest: Number.isFinite(latest.operatingMarginPct) ? latest.operatingMarginPct : undefined,
    revenueCagrPct: cagr,
    meta: {
      computedAt: new Date().toISOString(),
      basis: {
        years: basisYears,
        latestYear: latest.year,
      },
      notes: ['segmentValueAnalysis 未算出のため、事業部PLから暫定算出'],
    },
  } as any as ValueAnalysis;

  return mini;
}

/* ===============================
 * UI部品
 * =============================== */

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

type SegmentTableProps = {
  segments: Record<string, ValueAnalysis>;
  orderedNames: string[];
};

function SegmentMetricsTable({ segments, orderedNames }: SegmentTableProps) {
  if (orderedNames.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        事業部別のデータがありません。事業セグメントを定義し、事業部別 PL/BS を入力してください。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[940px] w-full text-sm border">
        <thead className="bg-gray-50">
          <tr>
            <th className="border px-3 py-2 text-left">セグメント名</th>
            <th className="border px-3 py-2 text-right">営業利益率（最新）</th>
            <th className="border px-3 py-2 text-right">売上CAGR</th>
            <th className="border px-3 py-2 text-right">ROIC</th>
            <th className="border px-3 py-2 text-right">期間</th>
            <th className="border px-3 py-2 text-right">基準年（最新）</th>
            <th className="border px-3 py-2 text-left">状態</th>
          </tr>
        </thead>
        <tbody>
          {orderedNames.map((name) => {
            const va = segments[name];
            const { startYear, latestYear, spanYears } = getBasisYears(va);
            const spanText =
              startYear && latestYear ? `${startYear}→${latestYear}${spanYears != null ? `（${spanYears}年）` : ''}` : '—';

            const ok =
              ((va as any)?.revenueCagrPct != null && Number.isFinite((va as any).revenueCagrPct)) ||
              ((va as any)?.operatingMarginPctLatest != null && Number.isFinite((va as any).operatingMarginPctLatest));

            return (
              <tr key={name} className="hover:bg-gray-50">
                <td className="border px-3 py-2 font-medium">{name}</td>
                <td className="border px-3 py-2 text-right">{fmtPct((va as any)?.operatingMarginPctLatest)}</td>
                <td className="border px-3 py-2 text-right">{fmtPct((va as any)?.revenueCagrPct)}</td>
                <td className="border px-3 py-2 text-right">{fmtPct((va as any)?.roic, 2)}</td>
                <td className="border px-3 py-2 text-right text-gray-500">{spanText}</td>
                <td className="border px-3 py-2 text-right text-gray-500">{latestYear ?? '—'}</td>
                <td className="border px-3 py-2 text-xs text-gray-600">{ok ? 'OK' : '未算出（入力不足の可能性）'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function quadrantLabel(key: QuadrantKey) {
  switch (key) {
    case 'FOCUS':
      return '注力（成長 × 高収益）';
    case 'IMPROVE':
      return '改善（成長 × 低収益）';
    case 'MAINTAIN':
      return '維持（低成長 × 高収益）';
    case 'EXIT':
      return '撤退候補（低成長 × 低収益）';
    default:
      return '';
  }
}

function PortfolioMatrix({
  segmentsVA,
  orderedNames,
  segmentPL,
}: {
  segmentsVA: Record<string, ValueAnalysis>;
  orderedNames: string[];
  segmentPL: Record<string, FinancePLRow[]>;
}) {
  const names = orderedNames;

  const latestRevenueBySeg = useMemo(() => {
    const out: Record<string, { year?: number; revenue?: number }> = {};
    for (const name of names) {
      const rows = Array.isArray(segmentPL?.[name]) ? segmentPL[name] : [];
      const parsed = rows
        .map((r: any) => ({
          year: parseYear(r?.year),
          revenue: pickNumber(r, ['revenue', 'sales', 'amount', '売上', '売上高']),
        }))
        .filter((x) => x.year && Number.isFinite(x.year))
        .sort((a, b) => (a.year! - b.year!));

      const last = parsed.length > 0 ? parsed[parsed.length - 1] : undefined;
      if (last?.year) out[name] = { year: last.year!, revenue: Number.isFinite(last.revenue) ? last.revenue : undefined };
      else out[name] = {};
    }
    return out;
  }, [names, segmentPL]);

  // ★ 修正：null を返さず、push方式で厳密に PortfolioPoint[] を構築（TSエラー解消）
  const points = useMemo<PortfolioPoint[]>(() => {
    const out: PortfolioPoint[] = [];

    for (const name of names) {
      const va = segmentsVA[name];
      const growth = Number((va as any)?.revenueCagrPct);
      const margin = Number((va as any)?.operatingMarginPctLatest);
      const roicRaw = (va as any)?.roic;

      if (!Number.isFinite(growth) || !Number.isFinite(margin)) continue;

      const latest = latestRevenueBySeg[name] ?? {};
      const latestRevenue = latest?.revenue;
      const latestYear = latest?.year;

      const p: PortfolioPoint = {
        name,
        growthPct: growth,
        marginPct: margin,
        latestRevenue: Number.isFinite(latestRevenue as any) ? Number(latestRevenue) : undefined,
        latestYear: latestYear,
      };

      const roic = roicRaw != null ? Number(roicRaw) : undefined;
      if (roic != null && Number.isFinite(roic)) p.roicPct = roic;

      out.push(p);
    }

    return out;
  }, [names, segmentsVA, latestRevenueBySeg]);

  const xThreshold = useMemo(() => median(points.map((p) => p.growthPct)), [points]);
  const yThreshold = useMemo(() => median(points.map((p) => p.marginPct)), [points]);

  const radiusByName = useMemo(() => {
    const vals = points.map((p) => (Number.isFinite(p.latestRevenue as any) ? Number(p.latestRevenue) : 0)).filter((v) => v > 0);

    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 0;

    const rMin = 4;
    const rMax = 14;

    const scale = (v: number) => {
      if (!Number.isFinite(v) || v <= 0 || max <= 0) return rMin;
      if (max === min) return (rMin + rMax) / 2;
      const t = (Math.sqrt(v) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
      return rMin + clamp(t, 0, 1) * (rMax - rMin);
    };

    const out: Record<string, number> = {};
    for (const p of points) out[p.name] = scale(Number(p.latestRevenue ?? 0));
    return out;
  }, [points]);

  const xMinMax = useMemo(() => {
    const xs = points.map((p) => p.growthPct);
    if (xs.length === 0) return { min: -10, max: 10 };
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const pad = Math.max(3, (max - min) * 0.1);
    return { min: min - pad, max: max + pad };
  }, [points]);

  const yMinMax = useMemo(() => {
    const ys = points.map((p) => p.marginPct);
    if (ys.length === 0) return { min: -5, max: 25 };
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const pad = Math.max(2, (max - min) * 0.1);
    return { min: min - pad, max: max + pad };
  }, [points]);

  const W = 720;
  const H = 420;
  const M = { l: 55, r: 20, t: 20, b: 45 };
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;

  const xToPx = (x: number) => {
    const t = (x - xMinMax.min) / (xMinMax.max - xMinMax.min || 1);
    return M.l + clamp(t, 0, 1) * plotW;
  };
  const yToPx = (y: number) => {
    const t = (y - yMinMax.min) / (yMinMax.max - yMinMax.min || 1);
    return M.t + (1 - clamp(t, 0, 1)) * plotH;
  };

  const xLine = xThreshold != null ? xToPx(xThreshold) : undefined;
  const yLine = yThreshold != null ? yToPx(yThreshold) : undefined;

  const buckets = useMemo(() => {
    const init = (key: QuadrantKey, desc: string) => ({ key, title: quadrantLabel(key), desc, items: [] as PortfolioPoint[] });
    const b = {
      FOCUS: init('FOCUS', '最優先で投資・拡大（勝ち筋の中核）'),
      IMPROVE: init('IMPROVE', '伸びているが収益性が弱い（構造改善・価格/原価/販管費）'),
      MAINTAIN: init('MAINTAIN', '稼ぐ事業（最適化・キャッシュ創出・守りの投資）'),
      EXIT: init('EXIT', '縮小/撤退/再定義（選択と集中の対象）'),
    };

    if (xThreshold == null || yThreshold == null) return [b.FOCUS, b.MAINTAIN, b.IMPROVE, b.EXIT];

    for (const p of points) {
      const gHigh = p.growthPct >= xThreshold;
      const mHigh = p.marginPct >= yThreshold;
      const key: QuadrantKey = gHigh && mHigh ? 'FOCUS' : gHigh && !mHigh ? 'IMPROVE' : !gHigh && mHigh ? 'MAINTAIN' : 'EXIT';
      b[key].items.push(p);
    }

    const sortFn = (a: PortfolioPoint, c: PortfolioPoint) => {
      const ar = Number(a.latestRevenue ?? 0);
      const cr = Number(c.latestRevenue ?? 0);
      if (cr !== ar) return cr - ar;
      if (c.growthPct !== a.growthPct) return c.growthPct - a.growthPct;
      return c.marginPct - a.marginPct;
    };

    (Object.keys(b) as QuadrantKey[]).forEach((k) => b[k].items.sort(sortFn));
    return [b.FOCUS, b.MAINTAIN, b.IMPROVE, b.EXIT];
  }, [points, xThreshold, yThreshold]);

  if (points.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        事業ポートフォリオを描画できません（売上CAGR と営業利益率が両方揃っている事業部がありません）。
      </div>
    );
  }

  return (
    <div className="border rounded p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold">事業ポートフォリオ（収益性 × 成長性 × 規模）</div>
          <div className="text-xs text-gray-500 mt-1">
            X軸：成長性（売上CAGR %） / Y軸：収益性（営業利益率 %） / 点の大きさ：最新年売上（規模）
          </div>
          {xThreshold != null && yThreshold != null && (
            <div className="text-xs text-gray-500 mt-1">
              象限境界（中央値）: 成長 {xThreshold.toFixed(1)}% ／ 収益 {yThreshold.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500">※ 売上規模は事業部PL（最新年売上）を参照（未入力は最小サイズ）</div>
      </div>

      <div className="mt-3">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="bg-white">
          <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="white" stroke="#e5e7eb" />
          {xLine != null && <line x1={xLine} y1={M.t} x2={xLine} y2={M.t + plotH} stroke="#9ca3af" strokeDasharray="4 4" />}
          {yLine != null && <line x1={M.l} y1={yLine} x2={M.l + plotW} y2={yLine} stroke="#9ca3af" strokeDasharray="4 4" />}

          <text x={M.l + plotW / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="#6b7280">
            成長性（売上CAGR %）
          </text>
          <text
            x={15}
            y={M.t + plotH / 2}
            textAnchor="middle"
            fontSize="12"
            fill="#6b7280"
            transform={`rotate(-90 15 ${M.t + plotH / 2})`}
          >
            収益性（営業利益率 %）
          </text>

          {Array.from({ length: 5 }).map((_, i) => {
            const t = i / 4;
            const xVal = xMinMax.min + (xMinMax.max - xMinMax.min) * t;
            const yVal = yMinMax.min + (yMinMax.max - yMinMax.min) * t;
            const xPx = M.l + plotW * t;
            const yPx = M.t + plotH * (1 - t);

            return (
              <g key={i}>
                <line x1={xPx} y1={M.t + plotH} x2={xPx} y2={M.t + plotH + 6} stroke="#d1d5db" />
                <text x={xPx} y={M.t + plotH + 18} textAnchor="middle" fontSize="10" fill="#9ca3af">
                  {xVal.toFixed(0)}
                </text>

                <line x1={M.l - 6} y1={yPx} x2={M.l} y2={yPx} stroke="#d1d5db" />
                <text x={M.l - 10} y={yPx + 3} textAnchor="end" fontSize="10" fill="#9ca3af">
                  {yVal.toFixed(0)}
                </text>
              </g>
            );
          })}

          {points.map((p) => {
            const cx = xToPx(p.growthPct);
            const cy = yToPx(p.marginPct);
            const r = radiusByName[p.name] ?? 4;

            return (
              <g key={p.name}>
                <title>
                  {p.name}
                  {'\n'}売上CAGR: {p.growthPct.toFixed(1)}%
                  {'\n'}営業利益率: {p.marginPct.toFixed(1)}%
                  {p.latestRevenue != null ? `\n規模(売上): ${fmtJPY(p.latestRevenue)}` : ''}
                </title>
                <circle cx={cx} cy={cy} r={r} fill="#111827" opacity={0.85} />
                <text x={cx + r + 6} y={cy + 4} fontSize="11" fill="#111827">
                  {p.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {buckets.map((b) => (
          <div key={b.key} className="border rounded p-3">
            <div className="font-semibold text-sm">{b.title}</div>
            <div className="text-xs text-gray-500 mt-1">{b.desc}</div>

            {b.items.length === 0 ? (
              <div className="text-sm text-gray-400 mt-3">該当なし</div>
            ) : (
              <div className="mt-3 space-y-2">
                {b.items.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-3">
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-gray-600 flex gap-3">
                      <span>成長 {p.growthPct.toFixed(1)}%</span>
                      <span>収益 {p.marginPct.toFixed(1)}%</span>
                      <span>規模 {p.latestRevenue != null ? fmtJPY(p.latestRevenue) : '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===============================
 * メイン
 * =============================== */

export default function MetricsPanel() {
  const financeSummary = useStrategyStore((s) =>
    Array.isArray((s as any).financeSummary) ? ((s as any).financeSummary as FinanceSummaryRow[]) : EMPTY_FINANCE_SUMMARY,
  );
  const financePL = useStrategyStore((s) => (Array.isArray((s as any).financePL) ? ((s as any).financePL as FinancePLRow[]) : EMPTY_PL));
  const financeBS = useStrategyStore((s) => (Array.isArray((s as any).financeBS) ? ((s as any).financeBS as FinanceBSRow[]) : EMPTY_BS));

  const segmentPL = useStrategyStore((s) => ((s as any).segmentPL ?? EMPTY_SEG_PL) as Record<string, FinancePLRow[]>);

  const valueAnalysis = useStrategyStore((s) => (s as any).valueAnalysis as ValueAnalysis | undefined);
  const segmentValueAnalysisRaw = useStrategyStore((s) => (s as any).segmentValueAnalysis as Record<string, ValueAnalysis> | undefined);
  const businessSegments = useStrategyStore((s) => (((s as any).businessSegments ?? EMPTY_SEGMENTS) as BusinessSegment[]));

  // ★ 診断ログ：MetricsPanel が参照する valueAnalysis（A-2）
  if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    console.log('[MetricsPanel] valueAnalysis state (comparison):', {
      revenueCagrPct: (valueAnalysis as any)?.revenueCagrPct,
      operatingMarginPctLatest: (valueAnalysis as any)?.operatingMarginPctLatest,
      basis_years: (valueAnalysis as any)?.meta?.basis?.years,
      basis_latestYear: (valueAnalysis as any)?.meta?.basis?.latestYear,
      meta_source: (valueAnalysis as any)?.meta?.source,
      has_valueAnalysis: !!valueAnalysis,
      financePL_len: Array.isArray(financePL) ? financePL.length : 0,
      financeBS_len: Array.isArray(financeBS) ? financeBS.length : 0,
    });
  }

  const recomputeValueAnalysis = useStrategyStore((s) => (s as any).recomputeValueAnalysis as ((src?: any) => void) | undefined);

  const [analysisMessage, setAnalysisMessage] = useState<string>('');
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');

  const handleRecompute = useCallback(() => {
    if (!recomputeValueAnalysis) {
      setAnalysisStatus('error');
      setAnalysisMessage('分析関数がstoreに見つかりません');
      setTimeout(() => {
        setAnalysisMessage('');
        setAnalysisStatus('idle');
      }, 2500);
      return;
    }

    if (!Array.isArray(financePL) || financePL.length === 0) {
      setAnalysisStatus('error');
      setAnalysisMessage('財務データ（全社PL）が入力されていません');
      setTimeout(() => {
        setAnalysisMessage('');
        setAnalysisStatus('idle');
      }, 2500);
      return;
    }

    try {
      recomputeValueAnalysis('local');
      setAnalysisStatus('success');
      setAnalysisMessage('分析を更新しました');
      setTimeout(() => {
        setAnalysisMessage('');
        setAnalysisStatus('idle');
      }, 2000);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setAnalysisStatus('error');
      setAnalysisMessage(`分析の更新に失敗：${errorMsg}`);
      setTimeout(() => {
        setAnalysisMessage('');
        setAnalysisStatus('idle');
      }, 3500);
    }
  }, [recomputeValueAnalysis, financePL]);

  const companyAgg = useMemo(() => {
    if (Array.isArray(financeSummary) && financeSummary.length > 0) return buildCompanyAggFromFinanceSummary(financeSummary);
    if (Array.isArray(financePL) && financePL.length > 0) return buildCompanyAggFromFinancePL(financePL);
    return [] as CompanyYearAgg[];
  }, [financeSummary, financePL]);

  const latest = companyAgg.length > 0 ? companyAgg[companyAgg.length - 1] : null;

  const positiveSpan = useMemo(() => pickPositiveRevenueSpan(companyAgg), [companyAgg]);
  const vaBasis = useMemo(() => getBasisYears(valueAnalysis), [valueAnalysis]);

  const spanText = useMemo(() => {
    if (positiveSpan.start && positiveSpan.end) return `${positiveSpan.start.year}→${positiveSpan.end.year}（${positiveSpan.spanYears}年）`;
    if (vaBasis.startYear && vaBasis.latestYear && vaBasis.spanYears != null) return `${vaBasis.startYear}→${vaBasis.latestYear}（${vaBasis.spanYears}年）`;
    if (companyAgg.length >= 2) {
      const s = companyAgg[0].year;
      const e = companyAgg[companyAgg.length - 1].year;
      const span = e - s;
      return `${s}→${e}${span > 0 ? `（${span}年）` : ''}`;
    }
    return '—';
  }, [positiveSpan, vaBasis, companyAgg]);

  const revenueCagrFromPositiveSpan = useMemo(() => {
    if (positiveSpan.start && positiveSpan.end && positiveSpan.spanYears) {
      return calcCagr(positiveSpan.start.revenue, positiveSpan.end.revenue, positiveSpan.spanYears);
    }
    return undefined;
  }, [positiveSpan]);

  const revenueCagrFromVA = useMemo(() => {
    const v = (valueAnalysis as any)?.revenueCagrPct;
    if (vaBasis.spanYears == null || vaBasis.spanYears <= 0 || (vaBasis.yearsCount ?? 0) < 2) return undefined;
    if (v == null || !Number.isFinite(v as any)) return undefined;
    return Number(v);
  }, [valueAnalysis, vaBasis]);

  const revenueCagrDisplay = useMemo(() => {
    if (revenueCagrFromPositiveSpan != null && Number.isFinite(revenueCagrFromPositiveSpan)) return revenueCagrFromPositiveSpan;
    if (revenueCagrFromVA != null && Number.isFinite(revenueCagrFromVA)) return revenueCagrFromVA;
    return undefined;
  }, [revenueCagrFromPositiveSpan, revenueCagrFromVA]);

  const businessNames = useMemo(() => uniqKeepOrder((businessSegments ?? []).map((s: any) => s?.name)), [businessSegments]);
  const segPlNames = useMemo(() => uniqKeepOrder(Object.keys(segmentPL ?? {}).map((k) => normKey(k))), [segmentPL]);
  const orderedSegNames = useMemo(() => {
    const a = businessNames;
    const b = segPlNames.filter((n) => !a.includes(n));
    const vaKeys = uniqKeepOrder(Object.keys(segmentValueAnalysisRaw ?? {}).map((k) => normKey(k)));
    const c = vaKeys.filter((n) => !a.includes(n) && !b.includes(n));
    return [...a, ...b, ...c];
  }, [businessNames, segPlNames, segmentValueAnalysisRaw]);

  const segmentValueAnalysis = useMemo(() => {
    const out: Record<string, ValueAnalysis> = {};

    const raw = segmentValueAnalysisRaw ?? {};
    for (const [k, v] of Object.entries(raw)) {
      const nk = normKey(k);
      if (!nk) continue;
      if (!out[nk]) out[nk] = v;
    }

    for (const name of orderedSegNames) {
      if (out[name]) continue;

      let rows: FinancePLRow[] | undefined = undefined;
      if (segmentPL && segmentPL[name]) rows = segmentPL[name];
      if (!rows) {
        const hitKey = Object.keys(segmentPL ?? {}).find((k) => normKey(k) === name);
        if (hitKey) rows = segmentPL[hitKey];
      }

      if (rows && Array.isArray(rows) && rows.length > 0) {
        const mini = buildMiniVAFromSegmentPL(rows);
        if (mini) out[name] = mini;
      }
    }

    return out;
  }, [segmentValueAnalysisRaw, orderedSegNames, segmentPL]);

  const hasSegmentAny = useMemo(() => orderedSegNames.length > 0, [orderedSegNames]);
  const hasSegmentAnalysis = useMemo(() => Object.keys(segmentValueAnalysis).length > 0, [segmentValueAnalysis]);

  const operatingMarginPctLatest = (valueAnalysis as any)?.operatingMarginPctLatest;
  const debtEquityRatio = (valueAnalysis as any)?.debtEquityRatio;
  const roic = (valueAnalysis as any)?.roic;
  const roe = (valueAnalysis as any)?.roe;
  const roa = (valueAnalysis as any)?.roa;
  const per = (valueAnalysis as any)?.per;
  const pbr = (valueAnalysis as any)?.pbr ?? (pbrManual ? toNumber(pbrManual) : undefined);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4"> 企業価値の主要指標</h2>

      <p className="text-sm text-gray-600 mb-6">
        取り込んだ財務データから、全社・事業部の状態を整理し、STAGE2（戦略ストーリー）に接続します。まずは「現状の数値を見える化」することが目的です。
      </p>

      {/* 分析ボタン */}
      <div className="border rounded p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">分析</div>
          <div className="text-xs text-gray-500 mt-1">指標（CAGR / ROIC / D/E など）が表示されない場合は、分析を更新してください。</div>

          {analysisMessage && (
            <div className={`text-xs mt-2 ${analysisStatus === 'error' ? 'text-red-700' : 'text-green-700'}`}>
              {analysisStatus === 'error' ? analysisMessage : `✓ ${analysisMessage}`}
            </div>
          )}
        </div>

        <button onClick={handleRecompute} className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 transition">
          分析を更新
        </button>
      </div>

      {/* 全社合算（年次） */}
      {companyAgg.length > 0 ? (
        <div className="border rounded p-4 mb-6">
          <div className="font-semibold mb-2">全社合算（年次）</div>
          <div className="text-sm text-gray-600 mb-3">最新年（{latest?.year}年）の状態を表示します。</div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <MetricCard label="売上高（最新年）" value={latest ? fmtJPY(latest.revenue) : '—'} sub="単位：百万円（想定）" />
            <MetricCard label="営業利益（最新年）" value={latest ? fmtJPY(latest.operatingIncome) : '—'} sub="単位：百万円（想定）" />
            <MetricCard
              label="営業利益率（最新年）"
              value={
                operatingMarginPctLatest != null
                  ? `${Number(operatingMarginPctLatest).toFixed(1)}%`
                  : latest
                    ? `${latest.operatingMarginPct.toFixed(1)}%`
                    : '—'
              }
            />
            <MetricCard label="売上CAGR（期間）" value={revenueCagrDisplay != null ? `${revenueCagrDisplay.toFixed(1)}%` : '—'} sub={`期間: ${spanText}`} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border px-3 py-2 text-left">年度</th>
                  <th className="border px-3 py-2 text-right">売上高（百万円）</th>
                  <th className="border px-3 py-2 text-right">営業利益（百万円）</th>
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

          {revenueCagrDisplay == null && (
            <div className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              売上CAGRが計算できません（売上が正の年次が2年分以上必要です）。
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 mb-6 text-center">
          <p className="text-gray-500 text-sm">
            全社の年次データがありません。「③ 財務データ入力」で全社PLを入力、または資料アップロードで反映してください。
          </p>
        </div>
      )}

      {/* 全社 ValueAnalysis */}
      <div className="border rounded p-4 mb-6">
        <div className="font-semibold mb-2">全社 ValueAnalysis（現在の状態）</div>
        <div className="text-sm text-gray-600 mb-4">財務データ・BS情報・PBR手入力から自動計算されます。</div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MetricCard label="営業利益率（最新年）" value={fmtPct(operatingMarginPctLatest)} />
          <MetricCard label="売上CAGR（期間）" value={revenueCagrDisplay != null ? `${revenueCagrDisplay.toFixed(1)}%` : '—'} sub={`期間: ${spanText}`} />
          <MetricCard label="D/Eレシオ" value={fmtNum(debtEquityRatio)} />
          <MetricCard label="ROIC" value={fmtPct(roic, 2)} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="ROE" value={fmtPct(roe, 2)} />
          <MetricCard label="ROA" value={fmtPct(roa, 2)} />
          <MetricCard label="PER" value={per != null ? fmtNum(toNumber(per)) : '—'} sub="単位：倍" />
          <MetricCard label="PBR" value={pbr != null ? fmtNum(toNumber(pbr)) : '—'} sub="単位：倍" />
        </div>
      </div>

      {/* 事業部別 ValueAnalysis */}
      <div className="border rounded p-4">
        <div className="font-semibold mb-2">事業部別 ValueAnalysis</div>
        <div className="text-sm text-gray-600 mb-4">事業セグメントごとの主要指標を一覧表示します。</div>

        {hasSegmentAny && hasSegmentAnalysis ? (
          <div className="space-y-4">
            <SegmentMetricsTable
              segments={segmentValueAnalysis}
              orderedNames={orderedSegNames.filter((n) => segmentValueAnalysis[n] != null)}
            />
            <PortfolioMatrix
              segmentsVA={segmentValueAnalysis}
              orderedNames={orderedSegNames.filter((n) => segmentValueAnalysis[n] != null)}
              segmentPL={segmentPL}
            />
          </div>
        ) : (
          <div className="text-sm text-gray-500">
            事業部別の分析結果がありません。次を確認してください：
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>② 事業セグメント定義でセグメント名が入力されている</li>
              <li>③ 財務データ入力で事業部別PL（任意）を入力している</li>
              <li>上の「分析を更新」を押して再計算した</li>
            </ul>
          </div>
        )}

        {process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1' && (
          <div className="mt-4 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-3">
            <div className="font-medium mb-1">Debug</div>
            <div>financePL_len: {Array.isArray(financePL) ? financePL.length : 0}</div>
            <div>financeBS_len: {Array.isArray(financeBS) ? financeBS.length : 0}</div>
            <div>businessSegments_len: {Array.isArray(businessSegments) ? businessSegments.length : 0}</div>
            <div>segmentPL_keys: {segmentPL ? Object.keys(segmentPL).length : 0}</div>
            <div>segmentValueAnalysis_raw_keys: {segmentValueAnalysisRaw ? Object.keys(segmentValueAnalysisRaw).length : 0}</div>
            <div>segmentValueAnalysis_effective_keys: {segmentValueAnalysis ? Object.keys(segmentValueAnalysis).length : 0}</div>
            <div>orderedSegNames: {orderedSegNames.join(', ') || '—'}</div>
          </div>
        )}
      </div>
    </section>
  );
}

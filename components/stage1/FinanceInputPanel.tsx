// /components/stage1/FinanceInputPanel.tsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type { FinancePLRow, FinanceBSRow, SegmentBSRow, BusinessSegment } from '@/types/strategy';

/* =========================================================
 * 安定した空参照（selector で ?? [] / ?? {} を使わないため）
 * ========================================================= */

const EMPTY_PL_ARR: FinancePLRow[] = Object.freeze([]) as unknown as FinancePLRow[];
const EMPTY_BS_ARR: FinanceBSRow[] = Object.freeze([]) as unknown as FinanceBSRow[];
const EMPTY_SEG_PL: Record<string, FinancePLRow[]> = Object.freeze({}) as unknown as Record<string, FinancePLRow[]>;
const EMPTY_SEG_BS: Record<string, SegmentBSRow[]> = Object.freeze({}) as unknown as Record<string, SegmentBSRow[]>;
const EMPTY_SEGMENTS: BusinessSegment[] = Object.freeze([]) as unknown as BusinessSegment[];

/* =========================================================
 * ユーティリティ
 * ========================================================= */

function toNum(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function formatNum(v: number | undefined): string {
  if (v === undefined) return '';
  return v.toLocaleString();
}

function generateYears(latestYear: number, count: number = 5): number[] {
  return Array.from({ length: count }, (_, i) => latestYear - count + 1 + i);
}

/* =========================================================
 * アコーディオン
 * ========================================================= */

function Accordion({
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{title}</span>
          {badge}
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
}

/* =========================================================
 * 全社PL入力テーブル
 * ========================================================= */

const PL_FIELDS = [
  { key: 'revenue', label: '売上高', required: true },
  { key: 'grossProfit', label: '売上総利益', required: false },
  { key: 'cogs', label: '売上原価', required: false },
  { key: 'sga', label: '販管費', required: false },
  { key: 'operatingIncome', label: '営業利益', required: true },
  { key: 'depreciation', label: '減価償却費', required: false },
  { key: 'interest', label: '支払利息', required: false },
  { key: 'tax', label: '法人税等', required: false },
  { key: 'netIncome', label: '当期純利益', required: false },
] as const;

type PLFieldKey = (typeof PL_FIELDS)[number]['key'];

function CompanyPLTable({
  years,
  data,
  onChange,
}: {
  years: number[];
  data: FinancePLRow[];
  onChange: (rows: FinancePLRow[]) => void;
}) {
  const dataMap = useMemo(() => {
    const map = new Map<number, FinancePLRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const handleChange = useCallback(
    (year: number, field: PLFieldKey, value: string) => {
      const existingRow = dataMap.get(year) ?? { year };
      const updatedRow: FinancePLRow = {
        ...existingRow,
        [field]: toNum(value),
      };
      const newData = data.filter((r) => r.year !== year);
      newData.push(updatedRow);
      newData.sort((a, b) => a.year - b.year);
      onChange(newData);
    },
    [data, dataMap, onChange]
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[120px]">
              項目
            </th>
            {years.map((y) => (
              <th key={y} className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[100px]">
                {y}年度
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PL_FIELDS.map((field) => (
            <tr key={field.key} className="border-t border-gray-100">
              <td className="px-3 py-2 text-gray-700 sticky left-0 bg-white">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </td>
              {years.map((y) => {
                const row = dataMap.get(y);
                const val = row?.[field.key as keyof FinancePLRow];
                return (
                  <td key={y} className="px-2 py-1">
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={val !== undefined ? String(val) : ''}
                      onChange={(e) => handleChange(y, field.key, e.target.value)}
                      placeholder="0"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================
 * 全社BS入力テーブル
 * ========================================================= */

const BS_FIELDS = [
  { key: 'cash', label: '現預金', required: false },
  { key: 'ar', label: '売掛金', required: true },
  { key: 'inventory', label: '棚卸資産', required: true },
  { key: 'ap', label: '買掛金', required: true },
  { key: 'fixedAssets', label: '固定資産', required: true },
  { key: 'totalAssets', label: '総資産', required: false },
  { key: 'interestBearingDebt', label: '有利子負債', required: true },
  { key: 'equity', label: '純資産（株主資本）', required: true },
] as const;

type BSFieldKey = (typeof BS_FIELDS)[number]['key'];

function CompanyBSTable({
  years,
  data,
  onChange,
}: {
  years: number[];
  data: FinanceBSRow[];
  onChange: (rows: FinanceBSRow[]) => void;
}) {
  const dataMap = useMemo(() => {
    const map = new Map<number, FinanceBSRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const handleChange = useCallback(
    (year: number, field: BSFieldKey, value: string) => {
      const existingRow = dataMap.get(year) ?? { year };
      const updatedRow: FinanceBSRow = {
        ...existingRow,
        [field]: toNum(value),
      };
      const newData = data.filter((r) => r.year !== year);
      newData.push(updatedRow);
      newData.sort((a, b) => a.year - b.year);
      onChange(newData);
    },
    [data, dataMap, onChange]
  );

  // 投下資本を自動計算して表示
  const computedIC = useMemo(() => {
    const map = new Map<number, number | undefined>();
    years.forEach((y) => {
      const row = dataMap.get(y);
      if (!row) {
        map.set(y, undefined);
        return;
      }
      const ar = row.ar ?? 0;
      const inventory = row.inventory ?? 0;
      const ap = row.ap ?? 0;
      const fixedAssets = row.fixedAssets ?? 0;
      if (ar || inventory || fixedAssets) {
        map.set(y, ar + inventory - ap + fixedAssets);
      } else {
        map.set(y, undefined);
      }
    });
    return map;
  }, [years, dataMap]);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[140px]">
              項目
            </th>
            {years.map((y) => (
              <th key={y} className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[100px]">
                {y}年度
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BS_FIELDS.map((field) => (
            <tr key={field.key} className="border-t border-gray-100">
              <td className="px-3 py-2 text-gray-700 sticky left-0 bg-white">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </td>
              {years.map((y) => {
                const row = dataMap.get(y);
                const val = row?.[field.key as keyof FinanceBSRow];
                return (
                  <td key={y} className="px-2 py-1">
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={val !== undefined ? String(val) : ''}
                      onChange={(e) => handleChange(y, field.key, e.target.value)}
                      placeholder="0"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
          {/* 投下資本（自動計算） */}
          <tr className="border-t border-gray-200 bg-blue-50">
            <td className="px-3 py-2 text-gray-700 font-medium sticky left-0 bg-blue-50">
              投下資本（自動計算）
            </td>
            {years.map((y) => (
              <td key={y} className="px-3 py-2 text-right text-gray-700">
                {computedIC.get(y) !== undefined ? formatNum(computedIC.get(y)) : '—'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">
        投下資本 = 売掛金 + 棚卸資産 - 買掛金 + 固定資産
      </p>
    </div>
  );
}

/* =========================================================
 * 事業部PL入力（簡易版）
 * ========================================================= */

const SEGMENT_PL_FIELDS = [
  { key: 'revenue', label: '売上高' },
  { key: 'operatingIncome', label: '営業利益' },
] as const;

function SegmentPLTable({
  segmentName,
  years,
  data,
  onChange,
}: {
  segmentName: string;
  years: number[];
  data: FinancePLRow[];
  onChange: (rows: FinancePLRow[]) => void;
}) {
  const dataMap = useMemo(() => {
    const map = new Map<number, FinancePLRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const handleChange = useCallback(
    (year: number, field: string, value: string) => {
      const existingRow = dataMap.get(year) ?? { year };
      const updatedRow: FinancePLRow = {
        ...existingRow,
        [field]: toNum(value),
      };
      const newData = data.filter((r) => r.year !== year);
      newData.push(updatedRow);
      newData.sort((a, b) => a.year - b.year);
      onChange(newData);
    },
    [data, dataMap, onChange]
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left font-semibold text-gray-700 min-w-[100px]">項目</th>
            {years.map((y) => (
              <th key={y} className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[90px]">
                {y}年度
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SEGMENT_PL_FIELDS.map((field) => (
            <tr key={field.key} className="border-t border-gray-100">
              <td className="px-3 py-2 text-gray-700">{field.label}</td>
              {years.map((y) => {
                const row = dataMap.get(y);
                const val = row?.[field.key as keyof FinancePLRow];
                return (
                  <td key={y} className="px-2 py-1">
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={val !== undefined ? String(val) : ''}
                      onChange={(e) => handleChange(y, field.key, e.target.value)}
                      placeholder="0"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================
 * 事業部BS入力（投下資本用・推計選択式）
 * ========================================================= */

type EstimationMethod = 'manual' | 'revenueRatio' | 'dso';

function SegmentBSTable({
  segmentName,
  years,
  data,
  plData,
  companyBS,
  onChange,
}: {
  segmentName: string;
  years: number[];
  data: SegmentBSRow[];
  plData: FinancePLRow[];
  companyBS: FinanceBSRow[];
  onChange: (rows: SegmentBSRow[]) => void;
}) {
  const [method, setMethod] = useState<EstimationMethod>('manual');

  const dataMap = useMemo(() => {
    const map = new Map<number, SegmentBSRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const plMap = useMemo(() => {
    const map = new Map<number, FinancePLRow>();
    plData.forEach((row) => map.set(row.year, row));
    return map;
  }, [plData]);

  const companyBSMap = useMemo(() => {
    const map = new Map<number, FinanceBSRow>();
    companyBS.forEach((row) => map.set(row.year, row));
    return map;
  }, [companyBS]);

  const handleChange = useCallback(
    (year: number, field: string, value: string) => {
      const existingRow = dataMap.get(year) ?? { year };
      const updatedRow: SegmentBSRow = {
        ...existingRow,
        [field]: toNum(value),
      };
      const newData = data.filter((r) => r.year !== year);
      newData.push(updatedRow);
      newData.sort((a, b) => a.year - b.year);
      onChange(newData);
    },
    [data, dataMap, onChange]
  );

  // 推計ボタン：売上比で計算して流し込む
  const applyEstimation = useCallback(() => {
    if (method !== 'revenueRatio') return;

    const newData: SegmentBSRow[] = years.map((y) => {
      const segPL = plMap.get(y);
      const corpBS = companyBSMap.get(y);
      const existing = dataMap.get(y) ?? { year: y };

      if (!segPL?.revenue || !corpBS) return existing;

      // 全社売上を取得（全社PLがあれば使う、なければBSから推定しない）
      // ここでは単純に全社ARを基準にした比率で計算
      const ratio = corpBS.ar && corpBS.ar > 0 ? segPL.revenue / (corpBS.ar * 10) : 0.2;

      return {
        ...existing,
        ar: Math.round((corpBS.ar ?? 0) * ratio),
        inventory: Math.round((corpBS.inventory ?? 0) * ratio),
        ap: Math.round((corpBS.ap ?? 0) * ratio),
        fixedAssets: Math.round((corpBS.fixedAssets ?? 0) * ratio),
      };
    });

    onChange(newData);
  }, [method, years, plMap, companyBSMap, dataMap, onChange]);

  // 投下資本を自動計算して表示
  const computedIC = useMemo(() => {
    const map = new Map<number, number | undefined>();
    years.forEach((y) => {
      const row = dataMap.get(y);
      if (!row) {
        map.set(y, undefined);
        return;
      }
      const ar = row.ar ?? 0;
      const inventory = row.inventory ?? 0;
      const ap = row.ap ?? 0;
      const fixedAssets = row.fixedAssets ?? 0;
      if (ar || inventory || fixedAssets) {
        map.set(y, ar + inventory - ap + fixedAssets);
      } else {
        map.set(y, undefined);
      }
    });
    return map;
  }, [years, dataMap]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <span className="text-xs text-gray-600">推計方法:</span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as EstimationMethod)}
          className="text-xs border border-gray-200 rounded px-2 py-1"
        >
          <option value="manual">手入力</option>
          <option value="revenueRatio">売上比で推計</option>
        </select>
        {method === 'revenueRatio' && (
          <button
            onClick={applyEstimation}
            className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
          >
            推計値を適用
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left font-semibold text-gray-700 min-w-[100px]">項目</th>
              {years.map((y) => (
                <th key={y} className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[90px]">
                  {y}年度
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { key: 'ar', label: '売掛金' },
              { key: 'inventory', label: '棚卸資産' },
              { key: 'ap', label: '買掛金' },
              { key: 'fixedAssets', label: '固定資産' },
            ].map((field) => (
              <tr key={field.key} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-700">{field.label}</td>
                {years.map((y) => {
                  const row = dataMap.get(y);
                  const val = row?.[field.key as keyof SegmentBSRow];
                  return (
                    <td key={y} className="px-2 py-1">
                      <input
                        type="text"
                        className="w-full border border-gray-200 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={val !== undefined ? String(val) : ''}
                        onChange={(e) => handleChange(y, field.key, e.target.value)}
                        placeholder="0"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* 投下資本（自動計算） */}
            <tr className="border-t border-gray-200 bg-blue-50">
              <td className="px-3 py-2 text-gray-700 font-medium">投下資本</td>
              {years.map((y) => (
                <td key={y} className="px-3 py-2 text-right text-gray-700">
                  {computedIC.get(y) !== undefined ? formatNum(computedIC.get(y)) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================================================
 * 本社/調整PL（自動差分表示）
 * ========================================================= */

function HQAdjustmentDisplay({
  years,
  companyPL,
  segmentPL,
}: {
  years: number[];
  companyPL: FinancePLRow[];
  segmentPL: Record<string, FinancePLRow[]>;
}) {
  const adjustment = useMemo(() => {
    return years.map((y) => {
      const company = companyPL.find((r) => r.year === y);
      let segRevenue = 0;
      let segOpIncome = 0;

      Object.values(segmentPL).forEach((rows) => {
        const row = rows.find((r) => r.year === y);
        if (row) {
          segRevenue += row.revenue ?? 0;
          segOpIncome += row.operatingIncome ?? 0;
        }
      });

      return {
        year: y,
        revenue: company?.revenue !== undefined ? (company.revenue - segRevenue) : undefined,
        operatingIncome:
          company?.operatingIncome !== undefined ? (company.operatingIncome - segOpIncome) : undefined,
      };
    });
  }, [years, companyPL, segmentPL]);

  const hasData = adjustment.some((a) => a.revenue !== undefined || a.operatingIncome !== undefined);

  if (!hasData) return null;

  return (
    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <h4 className="text-sm font-medium text-amber-800 mb-2">本社・共通費/調整（自動計算）</h4>
      <p className="text-xs text-amber-600 mb-3">
        全社PL - 事業部PL合計 の差分です。本社費用や連結調整が含まれます。
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-amber-100">
              <th className="px-3 py-2 text-left font-semibold text-amber-800">項目</th>
              {years.map((y) => (
                <th key={y} className="px-3 py-2 text-center font-semibold text-amber-800">
                  {y}年度
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-amber-200">
              <td className="px-3 py-2 text-amber-800">売上高差分</td>
              {adjustment.map((a) => (
                <td key={a.year} className="px-3 py-2 text-right text-amber-800">
                  {a.revenue !== undefined ? formatNum(a.revenue) : '—'}
                </td>
              ))}
            </tr>
            <tr className="border-t border-amber-200">
              <td className="px-3 py-2 text-amber-800">営業利益差分</td>
              {adjustment.map((a) => (
                <td key={a.year} className="px-3 py-2 text-right text-amber-800">
                  {a.operatingIncome !== undefined ? formatNum(a.operatingIncome) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================================================
 * メインパネル
 * ========================================================= */

export default function FinanceInputPanel() {
  // 安定した参照を使用（毎回新しい [] / {} を作らない）
  const financePL = useStrategyStore((s) => s.financePL ?? EMPTY_PL_ARR);
  const financeBS = useStrategyStore((s) => s.financeBS ?? EMPTY_BS_ARR);
  const segmentPL = useStrategyStore((s) => s.segmentPL ?? EMPTY_SEG_PL);
  const segmentBS = useStrategyStore((s) => s.segmentBS ?? EMPTY_SEG_BS);
  const businessSegments = useStrategyStore((s) => s.businessSegments ?? EMPTY_SEGMENTS);
  const setFinancePL = useStrategyStore((s) => s.setFinancePL);
  const setFinanceBS = useStrategyStore((s) => s.setFinanceBS);
  const setSegmentPL = useStrategyStore((s) => s.setSegmentPL);
  const setSegmentBS = useStrategyStore((s) => s.setSegmentBS);

  // 過去5年の年度を生成
  // financePL にデータがあればその年度を使用、なければ現在年-1を直近年とする
  const years = useMemo(() => {
    if (financePL.length > 0) {
      const dataYears = financePL.map((r) => r.year).sort((a, b) => a - b);
      return dataYears;
    }
    const currentYear = new Date().getFullYear();
    return generateYears(currentYear - 1, 5);
  }, [financePL]);

  // 事業部名リスト（name が空でないもののみ）
  const validSegments = useMemo(
    () => businessSegments.filter((seg) => seg.name.trim()),
    [businessSegments]
  );

  // 事業部PL更新
  const handleSegmentPLChange = useCallback(
    (segmentName: string, rows: FinancePLRow[]) => {
      setSegmentPL({ ...segmentPL, [segmentName]: rows });
    },
    [segmentPL, setSegmentPL]
  );

  // 事業部BS更新
  const handleSegmentBSChange = useCallback(
    (segmentName: string, rows: SegmentBSRow[]) => {
      setSegmentBS({ ...segmentBS, [segmentName]: rows });
    },
    [segmentBS, setSegmentBS]
  );

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">③ 財務データ入力（過去5年）</h2>
        <p className="text-sm text-gray-600">
          全社PL/BSを入力すると、企業価値指標（ROIC等）が自動計算されます。
          事業セグメントを定義している場合は、事業部別データも入力できます。
        </p>
      </div>

      {/* 全社PL */}
      <Accordion
        title="全社PL（損益計算書）"
        defaultOpen={true}
        badge={<span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">必須</span>}
      >
        <CompanyPLTable years={years} data={financePL} onChange={setFinancePL} />
      </Accordion>

      {/* 全社BS */}
      <Accordion
        title="全社BS（貸借対照表）"
        defaultOpen={true}
        badge={<span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">必須</span>}
      >
        <CompanyBSTable years={years} data={financeBS} onChange={setFinanceBS} />
      </Accordion>

      {/* 事業部別入力（セグメントが定義されている場合のみ） */}
      {validSegments.length > 0 && (
        <div className="space-y-4">
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium mb-2">事業部別データ（任意）</h3>
            <p className="text-sm text-gray-600 mb-4">
              事業部別の財務データを入力すると、セグメント別の分析が可能になります。
            </p>
          </div>

          {validSegments.map((seg) => (
            <div key={seg.id} className="space-y-3">
              <Accordion
                title={`${seg.name} - PL`}
                badge={<span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">任意</span>}
              >
                <SegmentPLTable
                  segmentName={seg.name}
                  years={years}
                  data={segmentPL[seg.name] ?? []}
                  onChange={(rows) => handleSegmentPLChange(seg.name, rows)}
                />
              </Accordion>

              <Accordion
                title={`${seg.name} - BS（投下資本）`}
                badge={<span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">推計可</span>}
              >
                <SegmentBSTable
                  segmentName={seg.name}
                  years={years}
                  data={segmentBS[seg.name] ?? []}
                  plData={segmentPL[seg.name] ?? []}
                  companyBS={financeBS}
                  onChange={(rows) => handleSegmentBSChange(seg.name, rows)}
                />
              </Accordion>
            </div>
          ))}

          {/* 本社/調整（自動差分表示） */}
          <HQAdjustmentDisplay years={years} companyPL={financePL} segmentPL={segmentPL} />
        </div>
      )}

      {validSegments.length === 0 && businessSegments.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-700">
            事業セグメントが定義されていますが、名前が未入力です。
            事業部別データを入力するには、セグメント名を入力してください。
          </p>
        </div>
      )}
    </section>
  );
}

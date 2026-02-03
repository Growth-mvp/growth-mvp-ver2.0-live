// /components/steps/Step3FinanceUpload.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import StepLayout from '@/components/StepLayout';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase/strategy';
import { saveWithAudit } from '@/utils/persist/saveWithAudit';
import { buildFinanceSummary } from '@/utils/financeSummary';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
} from 'recharts';

/* =========================================================
 * 日本語ヘッダ対応＋サマリー保存＋日本語プレビュー表示
 * ========================================================= */

const EXPECTED_HEADERS = [
  'business_unit',
  'year',
  'product_or_service',
  'unit_price',
  'quantity',
  'revenue',
  'cogs_variable',
  'cogs_fixed',
  'opex_variable',
  'opex_fixed',
  'operating_income',
  'gross_margin_pct',
  'operating_margin_pct',
  'retention_rate_pct',
  'notes',
] as const;

type FinanceRow = Record<(typeof EXPECTED_HEADERS)[number], any>;

type PlanRow = {
  year: number;
  revenue_plan?: number;
  operating_income_plan?: number;
};

type ActualRow = {
  year: number;
  revenue_actual?: number;
  operating_income_actual?: number;
};

/** 日本語→英語 ヘッダ変換マップ */
const HEADER_JA_TO_EN: Record<string, string> = {
  '事業': 'business_unit',
  '年': 'year',
  '製品・サービス': 'product_or_service',
  '単価': 'unit_price',
  '数量': 'quantity',
  '売上高': 'revenue',
  '変動原価': 'cogs_variable',
  '固定原価': 'cogs_fixed',
  '変動販管費': 'opex_variable',
  '固定販管費': 'opex_fixed',
  '営業利益': 'operating_income',
  '粗利率％': 'gross_margin_pct',
  '営業利益率％': 'operating_margin_pct',
  '継続率％': 'retention_rate_pct',
  '備考': 'notes',
};

/** 英語→日本語 表示用ラベル */
const EN_TO_JA_LABEL: Record<(typeof EXPECTED_HEADERS)[number], string> = {
  business_unit: '事業',
  year: '年',
  product_or_service: '製品・サービス',
  unit_price: '単価',
  quantity: '数量',
  revenue: '売上高',
  cogs_variable: '変動原価',
  cogs_fixed: '固定原価',
  opex_variable: '変動販管費',
  opex_fixed: '固定販管費',
  operating_income: '営業利益',
  gross_margin_pct: '粗利率％',
  operating_margin_pct: '営業利益率％',
  retention_rate_pct: '継続率％',
  notes: '備考',
};

/* ---------- ユーティリティ ---------- */
const trimStr = (v: any) => (typeof v === 'string' ? v.trim() : v);

/**
 * 数値変換ユーティリティ
 * - 空文字列や "-" は「値なし」として undefined 扱い
 * - それ以外のみ Number() でパース
 */
function toNum(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;

  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }

  const s = String(v).trim().replaceAll(',', '').replace('%', '');

  // 空欄や「-」「NA」は「値なし」と扱う
  if (s === '' || s === '-' || s.toLowerCase() === 'na') {
    return undefined;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function toPct(v: any): number | undefined {
  const n = toNum(v);
  return n === undefined ? undefined : n;
}

/** 1行の自動計算 */
function autoCompute(row: Partial<FinanceRow>): FinanceRow {
  const business_unit = trimStr(row.business_unit ?? '');
  const product_or_service = trimStr(row.product_or_service ?? '');
  const notes = trimStr(row.notes ?? '');
  const year = toNum(row.year);
  const unit_price = toNum(row.unit_price);
  const quantity = toNum(row.quantity);

  let revenue = toNum(row.revenue);
  if (revenue == null && unit_price != null && quantity != null) {
    revenue = unit_price * quantity;
  }

  const cogs_variable = toNum(row.cogs_variable) ?? 0;
  const cogs_fixed = toNum(row.cogs_fixed) ?? 0;
  const opex_variable = toNum(row.opex_variable) ?? 0;
  const opex_fixed = toNum(row.opex_fixed) ?? 0;

  let operating_income = toNum(row.operating_income);
  if (operating_income == null && revenue != null) {
    operating_income =
      revenue - (cogs_variable + cogs_fixed + opex_variable + opex_fixed);
  }

  let gross_margin_pct = toPct(row.gross_margin_pct);
  if (gross_margin_pct == null && revenue && revenue !== 0) {
    gross_margin_pct =
      ((revenue - (cogs_variable + cogs_fixed)) / revenue) * 100;
  }

  let operating_margin_pct = toPct(row.operating_margin_pct);
  if (
    operating_margin_pct == null &&
    revenue &&
    revenue !== 0 &&
    operating_income != null
  ) {
    operating_margin_pct = (operating_income / revenue) * 100;
  }

  const retention_rate_pct = toPct(row.retention_rate_pct);
  const round = (n: number | undefined, d = 2) =>
    n == null ? undefined : Number(Number(n).toFixed(d));

  return {
    business_unit,
    year,
    product_or_service,
    unit_price,
    quantity,
    revenue,
    cogs_variable,
    cogs_fixed,
    opex_variable,
    opex_fixed,
    operating_income,
    gross_margin_pct: round(gross_margin_pct),
    operating_margin_pct: round(operating_margin_pct),
    retention_rate_pct: round(retention_rate_pct),
    notes,
  } as FinanceRow;
}

/** ヘッダ変換・補完 */
function mapHeadersToEnglish(rawRows: any[]): any[] {
  if (!rawRows?.length) return [];
  return rawRows.map((r) => {
    const out: any = {};
    for (const k of Object.keys(r)) {
      const en = HEADER_JA_TO_EN[k] || k;
      out[en] = r[k];
    }
    return out;
  });
}
function normalizeHeaders(rows: any[]): FinanceRow[] {
  if (!rows?.length) return [];
  return rows.map((r) => {
    const out: any = {};
    for (const h of EXPECTED_HEADERS) out[h] = r[h] ?? '';
    return autoCompute(out);
  });
}

/* ---------- ストア更新ヘルパ ---------- */
function setFieldSafe(store: any, key: string, value: any) {
  const fn1 = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
  const fn2 = key === 'csvFinanceData' ? 'setCSVFinanceData' : '';
  const fns = [fn1, fn2].filter(Boolean);
  for (const fn of fns) {
    if (typeof store?.[fn] === 'function') return store[fn](value);
  }
  if (typeof (useStrategyStore as any)?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

/* ---------- 見た目 ---------- */
function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        'rounded-2xl border border-black/10 bg-white/60 shadow-sm backdrop-blur-md ring-1 ring-black/5 ' +
        className
      }
    >
      {children}
    </div>
  );
}
function Banner({
  type,
  children,
}: {
  type: 'success' | 'error' | 'info';
  children: React.ReactNode;
}) {
  const styles = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    error: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-gray-50 text-gray-700 border-gray-200',
  }[type];
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

/* =========================== 本体 =========================== */
export default function Step3FinanceUpload() {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [parsedData, setParsedData] = useState<FinanceRow[]>([]);
  const [actualRows, setActualRows] = useState<ActualRow[]>([]);
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);

  const st = useStrategyStore() as any;
  const { user, companyId, hydrated, membershipLoaded } = useUserStore();
  const userId = user?.id ?? null;
  const canPersist = !!userId && !!companyId && !!hydrated && !!membershipLoaded;

  const inputRef = useRef<HTMLInputElement | null>(null);

  const initRef = useRef(false);

  // ストアから CSV データをロード
  useEffect(() => {
    const rows = Array.isArray(st?.csvFinanceData) ? st.csvFinanceData : [];
    setParsedData(rows);
  }, [st?.csvFinanceData]);

  const savedCount = useMemo(
    () => (Array.isArray(st?.csvFinanceData) ? st.csvFinanceData.length : 0),
    [st?.csvFinanceData],
  );

  async function saveAll(rows: FinanceRow[]) {
    setMessage('');
    setError('');
    setFieldSafe(st, 'csvFinanceData', rows);
    const summary = buildFinanceSummary(rows);
    setFieldSafe(st, 'financeSummary', summary);
    if (!userId || !companyId || !canPersist) return;
    try {
      const state = useStrategyStore.getState() as any;
      await saveWithAudit(
        { ...state, csvFinanceData: rows, financeSummary: summary },
        userId,
        companyId,
        undefined,
        {},
        'step3Finance:uploadCSV',
      );
      setMessage('財務データ＋サマリーを保存しました');
    } catch (e) {
      console.error(e);
      setError('サーバ保存に失敗しました');
    }
  }

  async function saveActual(rows: ActualRow[]) {
    setMessage('');
    setError('');
    setFieldSafe(st, 'financeActual', rows);

    // 手入力実績 → 会社合計の FinanceRow を生成して csvFinanceData として保存
    // downstream（financeSummary等）を壊さないための橋渡し
    const synthetic: FinanceRow[] = rows
      .filter((r) => Number.isFinite(r.year))
      .map((r) =>
        autoCompute({
          business_unit: '会社合計（手入力）',
          year: r.year,
          product_or_service: '（手入力）',
          unit_price: '',
          quantity: '',
          revenue: r.revenue_actual ?? '',
          cogs_variable: 0,
          cogs_fixed: 0,
          opex_variable: 0,
          opex_fixed: 0,
          operating_income: r.operating_income_actual ?? '',
          gross_margin_pct: '',
          operating_margin_pct: '',
          retention_rate_pct: '',
          notes: '',
        }),
      );

    setParsedData(synthetic);
    await saveAll(synthetic);

    if (!userId || !companyId || !canPersist) return;
    try {
      const state = useStrategyStore.getState() as any;
      await saveWithAudit({ ...state, financeActual: rows }, userId, companyId, undefined, {}, 'step3Finance:uploadActual');
      setMessage('実績（手入力）を保存しました');
    } catch (e) {
      console.error(e);
      setError('実績（手入力）のサーバ保存に失敗しました');
    }
  }

  async function savePlan(rows: PlanRow[]) {
    setMessage('');
    setError('');
    setFieldSafe(st, 'financePlan', rows);
    if (!userId || !companyId || !canPersist) return;
    try {
      const state = useStrategyStore.getState() as any;
      await saveWithAudit({ ...state, financePlan: rows }, userId, companyId, undefined, {}, 'step3Finance:uploadPlan');
      setMessage('計画値を保存しました');
    } catch (e) {
      console.error(e);
      setError('計画値のサーバ保存に失敗しました');
    }
  }

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage('');
    setError('');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const raw = Array.isArray(result.data) ? result.data : [];
        const normalized = normalizeHeaders(mapHeadersToEnglish(raw));
        setParsedData(normalized);
        await saveAll(normalized);
        setUploading(false);
      },
      error: () => {
        setError('CSV解析に失敗しました');
        setUploading(false);
      },
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleFiles(e.target.files);

  const recalcAll = async () => {
    const recalculated = parsedData.map((r) => autoCompute(r));
    setParsedData(recalculated);
    await saveAll(recalculated);
  };

  // 年度別（会社トータル）実績集計（CSVからの実績）
  const yearlyActualFromCsv = useMemo(() => {
    if (!parsedData.length)
      return [] as { year: number; revenue: number; operating_income: number }[];
    const map = new Map<
      number,
      { year: number; revenue: number; operating_income: number }
    >();
    for (const r of parsedData) {
      const year = Number(r.year);
      if (!Number.isFinite(year)) continue;
      const revenue = toNum(r.revenue) ?? 0;
      const op = toNum(r.operating_income) ?? 0;
      const prev = map.get(year) ?? { year, revenue: 0, operating_income: 0 };
      prev.revenue += revenue;
      prev.operating_income += op;
      map.set(year, prev);
    }
    return Array.from(map.values()).sort((a, b) => a.year - b.year);
  }, [parsedData]);

  const hasCsvActual = yearlyActualFromCsv.length > 0;

  // 初期化：実績（手入力）と計画（手入力）を「常に」用意する
  useEffect(() => {
    if (initRef.current) return;

    // 1) 手入力実績（store優先）
    const fromStoreActual: ActualRow[] = Array.isArray(st?.financeActual) ? st.financeActual : [];
    if (fromStoreActual.length) {
      setActualRows(
        fromStoreActual
          .filter((a) => Number.isFinite(a.year))
          .sort((a, b) => a.year - b.year),
      );
    } else {
      // CSVがあるなら「直近年」を使う。無いなら「今年-1」を基準。
      const baseYear = hasCsvActual
        ? yearlyActualFromCsv[yearlyActualFromCsv.length - 1].year
        : new Date().getFullYear() - 1;
      const past5: ActualRow[] = Array.from({ length: 5 }).map((_, idx) => ({
        year: baseYear - 4 + idx,
      }));
      setActualRows(past5);
    }

    // 2) 計画（store優先）
    const fromStorePlan: PlanRow[] = Array.isArray(st?.financePlan) ? st.financePlan : [];
    if (fromStorePlan.length) {
      setPlanRows(
        fromStorePlan
          .filter((p) => Number.isFinite(p.year))
          .sort((a, b) => a.year - b.year),
      );
    } else {
      const baseYear = hasCsvActual
        ? yearlyActualFromCsv[yearlyActualFromCsv.length - 1].year
        : new Date().getFullYear() - 1;
      const future5: PlanRow[] = Array.from({ length: 5 }).map((_, idx) => ({
        year: baseYear + 1 + idx,
      }));
      setPlanRows(future5);
    }

    initRef.current = true;
  }, [st?.financeActual, st?.financePlan, hasCsvActual, yearlyActualFromCsv]);

  // 表示する年：過去5年（実績）＋未来5年（計画）を常に出す
  const yearsForView = useMemo(() => {
    const actualYears =
      actualRows.length > 0 ? actualRows.map((a) => a.year) : [];
    const planYears = planRows.length > 0 ? planRows.map((p) => p.year) : [];

    const combined = [...new Set([...actualYears, ...planYears])].filter((y) =>
      Number.isFinite(y),
    );
    return combined.sort((a, b) => a - b);
  }, [actualRows, planRows]);

  // 表示用：実績は「CSVがあるならCSV集計を優先」、無いなら手入力
  const actualForView = useMemo(() => {
    if (hasCsvActual) {
      return yearlyActualFromCsv.map((a) => ({
        year: a.year,
        revenue_actual: a.revenue,
        operating_income_actual: a.operating_income,
      }));
    }
    return actualRows.map((a) => ({
      year: a.year,
      revenue_actual: a.revenue_actual ?? null,
      operating_income_actual: a.operating_income_actual ?? null,
    }));
  }, [hasCsvActual, yearlyActualFromCsv, actualRows]);

  // グラフ用データ（実績＋計画）
  const chartData = useMemo(() => {
    if (!yearsForView.length) return [] as any[];

    return yearsForView.map((year) => {
      const a = actualForView.find((x) => x.year === year);
      const p = planRows.find((x) => x.year === year);

      const revenue_actual = a?.revenue_actual ?? null;
      const operating_income_actual = a?.operating_income_actual ?? null;
      const operating_margin_actual =
        revenue_actual && revenue_actual !== 0 && operating_income_actual != null
          ? (operating_income_actual / revenue_actual) * 100
          : null;

      const revenue_plan = p?.revenue_plan ?? null;
      const operating_income_plan = p?.operating_income_plan ?? null;
      const operating_margin_plan =
        revenue_plan && revenue_plan !== 0 && operating_income_plan != null
          ? (operating_income_plan / revenue_plan) * 100
          : null;

      return {
        year,
        revenue_actual,
        operating_income_actual,
        operating_margin_actual,
        revenue_plan,
        operating_income_plan,
        operating_margin_plan,
      };
    });
  }, [yearsForView, actualForView, planRows]);

  const updateActualValue = (
    year: number,
    field: keyof Omit<ActualRow, 'year'>,
    value: string,
  ) => {
    const num = toNum(value);
    setActualRows((prev) => {
      const next = [...prev];
      const idx = next.findIndex((r) => r.year === year);
      if (idx >= 0) {
        next[idx] = { ...next[idx], [field]: num };
      } else {
        next.push({ year, [field]: num } as ActualRow);
      }
      return next.sort((a, b) => a.year - b.year);
    });
  };

  const updatePlanValue = (
    year: number,
    field: keyof Omit<PlanRow, 'year'>,
    value: string,
  ) => {
    const num = toNum(value);
    setPlanRows((prev) => {
      const next = [...prev];
      const idx = next.findIndex((p) => p.year === year);
      if (idx >= 0) {
        next[idx] = { ...next[idx], [field]: num };
      } else {
        next.push({ year, [field]: num } as PlanRow);
      }
      return next.sort((a, b) => a.year - b.year);
    });
  };

  // 全件＋日本語ラベルプレビュー（詳細確認用）
  const preview = useMemo(() => {
    if (!parsedData?.length)
      return {
        headers: [] as string[],
        labels: [] as string[],
        rows: [] as any[][],
      };
    const headers = [...EXPECTED_HEADERS];
    const labels = headers.map((h) => EN_TO_JA_LABEL[h]);
    const rows = parsedData.map((r) => headers.map((h) => r?.[h] ?? ''));
    return { headers, labels, rows };
  }, [parsedData]);

  return (
    <StepLayout step={4} totalSteps={6} title="財務データ（実績・計画）">
      <div className="space-y-6">
        <GlassCard className="p-4 text-sm text-gray-700">
          <p className="mb-1">
            経営が入力した「過去実績（5年）＋今後計画（5年）」を、社員が誰でも見られる状態にします。
          </p>
          <p>
            CSVアップロードを推奨しますが、ファイルが無い場合はこの画面で手入力して保存できます。
          </p>
          {hasCsvActual && (
            <div className="mt-2 text-xs text-gray-500">
              ※ 現在はCSVの実績（会社トータル）を表示しています（手入力実績はCSV未使用時に表示されます）
            </div>
          )}
        </GlassCard>

        {/* ファイル入力（任意） */}
        <GlassCard>
          <div className="p-6 text-center">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm"
            >
              CSV / Excel からファイルを選ぶ（任意）
            </button>
            <div className="mt-2 text-xs text-gray-500">
              ※ 実績・計画をあわせて 10 年分を含むファイルのアップロードを推奨します
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="hidden"
            />
            {uploading && (
              <div className="mt-2 text-xs text-gray-500">読み込み中です…</div>
            )}
          </div>
        </GlassCard>

        {savedCount > 0 && (
          <div className="text-sm text-gray-700 flex gap-2 items-center">
            CSV から読み込み済み {savedCount} 件
            <button
              onClick={recalcAll}
              className="rounded-full border border-black/10 px-2 py-1 text-xs"
            >
              自動計算を再実行して保存
            </button>
          </div>
        )}

        {/* 年度別サマリー（常に表示） */}
        <GlassCard>
          <div className="p-4 space-y-3">
            <div className="text-sm font-medium text-gray-800">
              年度別サマリー（実績：過去5年／計画：今後5年）
            </div>
            <div className="text-xs text-gray-500">
              CSVがある場合は実績（売上・営業利益）は会社トータル集計が表示されます。CSVが無い場合は左の実績欄を手入力し保存してください。
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-xs border-collapse">
                <thead className="bg-white/70">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                      年
                    </th>

                    <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                      売上高（実績）
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                      営業利益（実績）
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                      営業利益率（実績）
                    </th>

                    <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                      売上高（計画）
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                      営業利益（計画）
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                      営業利益率（計画）
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {yearsForView.map((year) => {
                    const a = actualForView.find((x) => x.year === year);
                    const p = planRows.find((x) => x.year === year);

                    const revenueActual = a?.revenue_actual ?? null;
                    const opActual = a?.operating_income_actual ?? null;
                    const marginActual =
                      revenueActual && revenueActual !== 0 && opActual != null
                        ? (opActual / revenueActual) * 100
                        : null;

                    const revenuePlan = p?.revenue_plan ?? undefined;
                    const opPlan = p?.operating_income_plan ?? undefined;
                    const marginPlan =
                      revenuePlan && revenuePlan !== 0 && opPlan != null
                        ? (opPlan / revenuePlan) * 100
                        : null;

                    const isActualYear = actualRows.some((r) => r.year === year);
                    const isPlanYear = planRows.some((r) => r.year === year);

                    return (
                      <tr key={year} className="odd:bg-white/80 even:bg-white/60">
                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {year}年
                        </td>

                        {/* 実績：CSVがあれば表示のみ、無ければ入力 */}
                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {hasCsvActual ? (
                            revenueActual != null ? revenueActual.toLocaleString() : '-'
                          ) : isActualYear ? (
                            <input
                              type="text"
                              className="w-28 rounded-md border border-black/10 bg-white/80 px-2 py-1 text-xs"
                              value={revenueActual != null ? String(revenueActual) : ''}
                              onChange={(e) =>
                                updateActualValue(year, 'revenue_actual', e.target.value)
                              }
                              placeholder="例）120000"
                            />
                          ) : (
                            '-'
                          )}
                        </td>

                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {hasCsvActual ? (
                            opActual != null ? opActual.toLocaleString() : '-'
                          ) : isActualYear ? (
                            <input
                              type="text"
                              className="w-28 rounded-md border border-black/10 bg-white/80 px-2 py-1 text-xs"
                              value={opActual != null ? String(opActual) : ''}
                              onChange={(e) =>
                                updateActualValue(
                                  year,
                                  'operating_income_actual',
                                  e.target.value,
                                )
                              }
                              placeholder="例）12000"
                            />
                          ) : (
                            '-'
                          )}
                        </td>

                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {marginActual != null ? `${marginActual.toFixed(1)}%` : '-'}
                        </td>

                        {/* 計画：常に入力 */}
                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {isPlanYear ? (
                            <input
                              type="text"
                              className="w-28 rounded-md border border-black/10 bg-white/80 px-2 py-1 text-xs"
                              value={revenuePlan != null ? String(revenuePlan) : ''}
                              onChange={(e) =>
                                updatePlanValue(year, 'revenue_plan', e.target.value)
                              }
                              placeholder="例）120000"
                            />
                          ) : (
                            '-'
                          )}
                        </td>

                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {isPlanYear ? (
                            <input
                              type="text"
                              className="w-28 rounded-md border border-black/10 bg-white/80 px-2 py-1 text-xs"
                              value={opPlan != null ? String(opPlan) : ''}
                              onChange={(e) =>
                                updatePlanValue(
                                  year,
                                  'operating_income_plan',
                                  e.target.value,
                                )
                              }
                              placeholder="例）12000"
                            />
                          ) : (
                            '-'
                          )}
                        </td>

                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {marginPlan != null ? `${marginPlan.toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {!hasCsvActual && (
                <button
                  onClick={() => saveActual(actualRows)}
                  className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-medium text-gray-800"
                >
                  実績（手入力）を保存
                </button>
              )}
              <button
                onClick={() => savePlan(planRows)}
                className="rounded-full bg-black px-4 py-2 text-xs font-medium text-white"
              >
                計画値を保存
              </button>
            </div>
          </div>
        </GlassCard>

        {/* 実績＋計画 10年分のグラフ（常に表示） */}
        <GlassCard>
          <div className="p-4 space-y-6">
            <div>
              <div className="text-sm font-medium text-gray-800 mb-1">
                売上高の推移（実績／計画）
              </div>
              <div className="text-xs text-gray-500 mb-2">
                過去 5 年の実績と今後 5 年の計画を 1 本の折れ線グラフで確認できます。
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis />
                    <ReTooltip />
                    <Legend />
                    <Line type="monotone" dataKey="revenue_actual" name="売上高（実績）" />
                    <Line
                      type="monotone"
                      dataKey="revenue_plan"
                      name="売上高（計画）"
                      strokeDasharray="5 5"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-800 mb-1">
                営業利益率の推移（実績／計画）
              </div>
              <div className="text-xs text-gray-500 mb-2">
                売上だけでなく、収益性（営業利益率）の変化もあわせて確認できます。
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis />
                    <ReTooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="operating_margin_actual"
                      name="営業利益率（実績）"
                    />
                    <Line
                      type="monotone"
                      dataKey="operating_margin_plan"
                      name="営業利益率（計画）"
                      strokeDasharray="5 5"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </GlassCard>

        {message && <Banner type="success">{message}</Banner>}
        {error && <Banner type="error">{error}</Banner>}

        {/* 詳細プレビュー（CSV or 手入力実績を保存した場合に表示） */}
        {parsedData.length > 0 && (
          <GlassCard>
            <div className="p-4 overflow-auto">
              <div className="text-sm mb-2 text-gray-700">
                読み込み {parsedData.length} 件（全列・日本語ラベル表示）
              </div>
              <table className="min-w-full text-xs border-collapse">
                <thead className="bg-white/70">
                  <tr>
                    {preview.labels.map((label, idx) => (
                      <th
                        key={preview.headers[idx]}
                        className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="odd:bg-white/80 even:bg-white/60">
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className="px-3 py-2 text-gray-800 align-top whitespace-nowrap"
                        >
                          {String(cell ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        )}
      </div>
    </StepLayout>
  );
}

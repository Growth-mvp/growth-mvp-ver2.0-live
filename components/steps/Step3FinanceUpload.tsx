// /app/step3/FinanceUpload.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import StepLayout from '@/components/StepLayout';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase/strategy';
import { buildFinanceSummary } from '@/utils/financeSummary';

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
function toNum(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().replaceAll(',', '').replace('%', '');
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
  if (revenue == null && unit_price != null && quantity != null) revenue = unit_price * quantity;

  const cogs_variable = toNum(row.cogs_variable) ?? 0;
  const cogs_fixed = toNum(row.cogs_fixed) ?? 0;
  const opex_variable = toNum(row.opex_variable) ?? 0;
  const opex_fixed = toNum(row.opex_fixed) ?? 0;

  let operating_income = toNum(row.operating_income);
  if (operating_income == null && revenue != null)
    operating_income = revenue - (cogs_variable + cogs_fixed + opex_variable + opex_fixed);

  let gross_margin_pct = toPct(row.gross_margin_pct);
  if (gross_margin_pct == null && revenue && revenue !== 0)
    gross_margin_pct = ((revenue - (cogs_variable + cogs_fixed)) / revenue) * 100;

  let operating_margin_pct = toPct(row.operating_margin_pct);
  if (operating_margin_pct == null && revenue && revenue !== 0 && operating_income != null)
    operating_margin_pct = (operating_income / revenue) * 100;

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
  for (const fn of fns) if (typeof store?.[fn] === 'function') return store[fn](value);
  if (typeof (useStrategyStore as any)?.setState === 'function')
    (useStrategyStore as any).setState({ [key]: value });
}

/* ---------- 見た目 ---------- */
function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={'rounded-2xl border border-black/10 bg-white/60 shadow-sm backdrop-blur-md ring-1 ring-black/5 ' + className}>
      {children}
    </div>
  );
}
function Banner({ type, children }: { type: 'success' | 'error' | 'info'; children: React.ReactNode }) {
  const styles = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    error: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-gray-50 text-gray-700 border-gray-200',
  }[type];
  return <div className={`rounded-xl border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

/* =========================== 本体 =========================== */
export default function Step3FinanceUpload() {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [parsedData, setParsedData] = useState<FinanceRow[]>([]);
  const [pasteText, setPasteText] = useState('');
  const st = useStrategyStore() as any;
  const { user, companyId, hydrated, membershipLoaded } = useUserStore();
  const userId = user?.id ?? null;
  const canPersist = !!userId && !!companyId && !!hydrated && !!membershipLoaded;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const rows = Array.isArray(st?.csvFinanceData) ? st.csvFinanceData : [];
    setParsedData(rows);
  }, [st?.csvFinanceData]);

  const savedCount = useMemo(() => Array.isArray(st?.csvFinanceData) ? st.csvFinanceData.length : 0, [st?.csvFinanceData]);

  async function saveAll(rows: FinanceRow[]) {
    setFieldSafe(st, 'csvFinanceData', rows);
    const summary = buildFinanceSummary(rows);
    setFieldSafe(st, 'financeSummary', summary);
    if (!userId || !companyId || !canPersist) return;
    try {
      const state = useStrategyStore.getState() as any;
      await saveStrategyData({ ...state, csvFinanceData: rows, financeSummary: summary }, userId, companyId);
      setMessage('財務データ＋サマリーを保存しました');
    } catch (e) {
      console.error(e);
      setError('サーバ保存に失敗しました');
    }
  }

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
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

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files);

  const parsePastedTable = async () => {
    setUploading(true);
    try {
      const parsed = Papa.parse(pasteText.trim(), { header: true, skipEmptyLines: true });
      const normalized = normalizeHeaders(mapHeadersToEnglish(parsed.data as any[]));
      setParsedData(normalized);
      await saveAll(normalized);
      setPasteText('');
    } catch {
      setError('貼り付け解析に失敗しました');
    } finally {
      setUploading(false);
    }
  };

  const recalcAll = async () => {
    const recalculated = parsedData.map((r) => autoCompute(r));
    setParsedData(recalculated);
    await saveAll(recalculated);
  };

  // 全件＋日本語ラベルプレビュー
  const preview = useMemo(() => {
    if (!parsedData?.length) return { headers: [], labels: [], rows: [] as any[][] };
    const headers = [...EXPECTED_HEADERS];
    const labels = headers.map((h) => EN_TO_JA_LABEL[h]);
    const rows = parsedData.map((r) => headers.map((h) => r?.[h] ?? ''));
    return { headers, labels, rows };
  }, [parsedData]);

  return (
    <StepLayout step={4} totalSteps={6} title="財務データのアップロード">
      <div className="space-y-6">
        <GlassCard className="p-4 text-sm text-gray-700">
          日本語・英語どちらのヘッダでも読み込めます。空欄の売上や利益率は自動計算します。
        </GlassCard>

        {/* ファイル入力 */}
        <GlassCard>
          <div ref={dropRef} className="p-6 text-center">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm"
            >
              ファイルを選ぶ
            </button>
            <input ref={inputRef} type="file" accept=".csv" onChange={handleFileInput} className="hidden" />
          </div>
        </GlassCard>

        {/* 貼り付け */}
        <GlassCard>
          <div className="p-4">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Excelからコピーして貼り付け"
              className="w-full min-h-[120px] rounded-xl border border-black/10 bg-white/70 p-3 text-sm text-gray-800"
            />
            <div className="mt-2 flex gap-2">
              <button onClick={parsePastedTable} disabled={!pasteText.trim()} className="rounded-full bg-black px-4 py-2 text-sm text-white">
                取り込む
              </button>
              <button onClick={() => setPasteText('')} className="rounded-full border border-black/10 px-4 py-2 text-sm text-gray-700">
                クリア
              </button>
            </div>
          </div>
        </GlassCard>

        {savedCount > 0 && (
          <div className="text-sm text-gray-700 flex gap-2 items-center">
            保存済み {savedCount} 件
            <button onClick={recalcAll} className="rounded-full border border-black/10 px-2 py-1 text-xs">
              再計算して保存
            </button>
          </div>
        )}

        {message && <Banner type="success">{message}</Banner>}
        {error && <Banner type="error">{error}</Banner>}

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
                      <th key={preview.headers[idx]} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="odd:bg-white/80 even:bg-white/60">
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-2 text-gray-800 align-top whitespace-nowrap">
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

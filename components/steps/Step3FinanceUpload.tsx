// /app/step3/FinanceUpload.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import StepLayout from '@/components/StepLayout';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
// ★ 修正：strategy 経由で統一
import { saveStrategyData } from '@/utils/supabase/strategy';
import { buildFinanceSummary } from '@/utils/financeSummary';

/* =========================================================
 * Ver4対応ポイント（日本語ヘッダ対応＋サマリー保存）
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

/** 1行の自動計算（空欄のときのみ計算。値があれば尊重） */
function autoCompute(row: Partial<FinanceRow>): FinanceRow {
  const business_unit = trimStr(row.business_unit ?? '');
  const product_or_service = trimStr(row.product_or_service ?? '');
  const notes = trimStr(row.notes ?? '');

  const year = toNum(row.year);
  const unit_price = toNum(row.unit_price);
  const quantity = toNum(row.quantity);

  let revenue = toNum(row.revenue);
  if ((revenue === undefined || revenue === null) && unit_price !== undefined && quantity !== undefined) {
    revenue = unit_price * quantity;
  }

  const cogs_variable = toNum(row.cogs_variable) ?? 0;
  const cogs_fixed = toNum(row.cogs_fixed) ?? 0;
  const opex_variable = toNum(row.opex_variable) ?? 0;
  const opex_fixed = toNum(row.opex_fixed) ?? 0;

  let operating_income = toNum(row.operating_income);
  if ((operating_income === undefined || operating_income === null) && revenue !== undefined) {
    operating_income = revenue - (cogs_variable + cogs_fixed + opex_variable + opex_fixed);
  }

  let gross_margin_pct = toPct(row.gross_margin_pct);
  if ((gross_margin_pct === undefined || gross_margin_pct === null) && revenue && revenue !== 0) {
    const grossProfit = revenue - (cogs_variable + cogs_fixed);
    gross_margin_pct = (grossProfit / revenue) * 100;
  }

  let operating_margin_pct = toPct(row.operating_margin_pct);
  if ((operating_margin_pct === undefined || operating_margin_pct === null) && revenue && revenue !== 0 && operating_income !== undefined) {
    operating_margin_pct = (operating_income / revenue) * 100;
  }

  const retention_rate_pct = toPct(row.retention_rate_pct);

  const round = (n: number | undefined, d = 2) =>
    n === undefined ? undefined : Number.isFinite(n) ? Number(Number(n).toFixed(d)) : undefined;

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
    gross_margin_pct: round(gross_margin_pct, 2),
    operating_margin_pct: round(operating_margin_pct, 2),
    retention_rate_pct: round(retention_rate_pct, 2),
    notes,
  } as FinanceRow;
}

/** 日本語ヘッダ→英語ヘッダへキー変換 */
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

/** ヘッダ不足時は空列を補完し、未知列は無視して取り込み → 自動計算 */
function normalizeHeaders(rows: any[]): FinanceRow[] {
  if (!rows?.length) return [];
  return rows.map((r) => {
    const out: any = {};
    for (const h of EXPECTED_HEADERS) out[h] = r[h] ?? '';
    return autoCompute(out);
  });
}

/* ---------- ストアセッタ（存在すれば使う） ---------- */
function setFieldSafe(store: any, key: string, value: any) {
  const candidates = [
    'set' + key.charAt(0).toUpperCase() + key.slice(1), // setCsvFinanceData / setFinanceSummary
    key === 'csvFinanceData' ? 'setCSVFinanceData' : '',
  ].filter(Boolean);

  for (const fn of candidates) {
    if (typeof store?.[fn] === 'function') {
      store[fn](value);
      return;
    }
  }
  if (typeof (useStrategyStore as any)?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

/* ---------- 見た目部品 ---------- */
function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
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
  const { user, companyId, hydrated, membershipLoaded } = useUserStore(); // ★ companyId 等を取得
  const userId = user?.id ?? null;
  const canPersist = !!userId && !!companyId && !!hydrated && !!membershipLoaded; // ★ 保存ゲート

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  // 既存データを表示
  useEffect(() => {
    const rows = Array.isArray(st?.csvFinanceData) ? (st.csvFinanceData as FinanceRow[]) : [];
    setParsedData(rows);
  }, [st?.csvFinanceData]);

  const savedCount = useMemo(
    () => (Array.isArray(st?.csvFinanceData) ? st.csvFinanceData.length : 0),
    [st?.csvFinanceData],
  );

  /** 共通保存（ストア→サーバ）＋サマリー生成 */
  async function saveAll(rows: FinanceRow[]) {
    // 1) ストアへ原データ（即時反映）
    setFieldSafe(st, 'csvFinanceData', rows);

    // 2) サマリー生成 → ストアへ保存
    const summary = buildFinanceSummary(rows);
    setFieldSafe(st, 'financeSummary', summary);

    // 3) サーバ保存（ログイン & 会社スコープ確定時のみ）
    if (!userId || !companyId) {
      setMessage('読み込み完了（サーバ保存はスキップ：未ログインまたは会社未確定）');
      return;
    }
    if (!canPersist) {
      // 読み込み直後に companyId が未確定なケースをケア
      setMessage('読み込み完了（会社切替中のためサーバ保存は後で手動保存してください）');
      return;
    }

    try {
      const state = useStrategyStore.getState() as any;
      // ★ 第3引数：companyId を明示
      await saveStrategyData(
        { ...state, csvFinanceData: rows, financeSummary: summary },
        userId,
        companyId
      );
      setMessage('財務データ＋集計サマリーを保存しました');
      setError('');
    } catch (e) {
      console.error('finance save failed:', e);
      setError('サーバ保存に失敗しました');
      setMessage('');
    }
  }

  /** CSVファイル受け取り */
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
        try {
          const raw = Array.isArray(result.data) ? (result.data as any[]) : [];
          const rawEn = mapHeadersToEnglish(raw);
          const normalized = normalizeHeaders(rawEn);

          setParsedData(normalized);
          await saveAll(normalized);
        } catch (err) {
          console.error('finance parse/save failed:', err);
          setError('CSVの解析または保存に失敗しました');
          setMessage('');
        } finally {
          setUploading(false);
          if (inputRef.current) inputRef.current.value = '';
        }
      },
      error: () => {
        setError('CSVの解析に失敗しました');
        setMessage('');
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      },
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  /** クリップボード貼り付けテキストを表として取り込み（TSV/CSV両対応） */
  const parsePastedTable = async () => {
    setUploading(true);
    setMessage('');
    setError('');
    try {
      const text = pasteText?.trim();
      if (!text) {
        setError('貼り付けテキストが空です');
        setUploading(false);
        return;
      }
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      if (parsed.errors?.length) console.warn(parsed.errors);

      const raw = Array.isArray(parsed.data) ? (parsed.data as any[]) : [];
      const rawEn = mapHeadersToEnglish(raw);
      const normalized = normalizeHeaders(rawEn);

      setParsedData(normalized);
      await saveAll(normalized);
      setPasteText('');
    } catch (e) {
      console.error(e);
      setError('貼り付けデータの解析に失敗しました');
      setMessage('');
    } finally {
      setUploading(false);
    }
  };

  /** 全行再計算 → サマリー再生成＆保存 */
  const recalcAll = async () => {
    if (!parsedData?.length) return;
    const recalculated = parsedData.map((r) => autoCompute(r));
    setParsedData(recalculated);
    await saveAll(recalculated);
    setMessage('再計算して保存しました');
    setError('');
  };

  // Drag & Drop
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    const prevent = (ev: DragEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onDrop = (ev: DragEvent) => {
      prevent(ev);
      const dt = ev.dataTransfer;
      if (!dt) return;
      handleFiles(dt.files);
      el.classList.remove('ring-2', 'ring-black/10');
    };
    const onDragOver = (ev: DragEvent) => {
      prevent(ev);
      el.classList.add('ring-2', 'ring-black/10');
    };
    const onDragLeave = (ev: DragEvent) => {
      prevent(ev);
      el.classList.remove('ring-2', 'ring-black/10');
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragenter', prevent);
    el.addEventListener('dragend', onDragLeave);

    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
      el.removeEventListener('dragenter', prevent);
      el.removeEventListener('dragend', onDragLeave);
    };
  }, []);

  // プレビュー（先頭行の先頭6列）
  const preview = useMemo(() => {
    if (!parsedData?.length) return { headers: [], rows: [] as any[][] };
    const allHeaders = [...EXPECTED_HEADERS].filter((h) => h !== 'notes');
    const headers = allHeaders.slice(0, 6);
    const rows = parsedData.slice(0, 5).map((r) => headers.map((h) => String(r?.[h] ?? '')));
    return { headers, rows };
  }, [parsedData]);

  return (
    <StepLayout step={4} totalSteps={6} title="財務データのアップロード">
      <div className="space-y-6">
        {/* ガイド */}
        <GlassCard className="p-4">
          <div className="text-sm text-gray-700">
            <p className="mb-2">
              日本語ヘッダ/英語ヘッダどちらでも読み込めます。<strong>売上</strong>・<strong>営業利益</strong>・
              <strong>粗利率%</strong>・<strong>営業利益率%</strong>は空欄なら自動で補完されます。
              読み込み後は<strong>年度×事業サマリー</strong>を自動生成して保存します。
            </p>
            <p className="text-xs text-gray-500">
              主な列（日本語）：事業、年、製品・サービス、単価、数量、売上高、変動原価、固定原価、変動販管費、固定販管費、営業利益、粗利率％、営業利益率％、継続率％、備考
            </p>
          </div>
        </GlassCard>

        {/* ドロップゾーン */}
        <GlassCard>
          <div ref={dropRef} className="group relative overflow-hidden rounded-2xl p-6">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 to-white/10" />
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-white/70 shadow-sm">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-gray-500">
                  <path d="M12 16V5m0 0l-4 4m4-4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="3" y="16" width="18" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </div>
              <div className="text-sm font-medium text-gray-800">CSVをドラッグ＆ドロップ</div>
              <div className="text-xs text-gray-500">または</div>
              <div>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-white focus:outline-none focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                >
                  ファイルを選ぶ
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileInput}
                  disabled={uploading}
                  className="hidden"
                />
              </div>
              <p className="text-[12px] text-gray-500">UTF-8推奨。1行目はヘッダーとして解析します。</p>
            </div>
          </div>
        </GlassCard>

        {/* クリップボード貼り付け */}
        <GlassCard>
          <div className="p-4 md:p-5">
            <div className="mb-2 text-sm font-medium text-gray-800">Excel/スプレッドシートから貼り付け</div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`例）ヘッダー行を含む表をそのまま貼り付け
事業,年,製品・サービス,単価,数量,売上高,変動原価,固定原価,変動販管費,固定販管費,営業利益,粗利率％,営業利益率％,継続率％,備考
Core A,2024,Main SKU,1200,5000,,,,,,,,85,example`}
              className="w-full min-h-[120px] rounded-xl border border-black/10 bg-white/70 p-3 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={parsePastedTable}
                disabled={uploading || !pasteText.trim()}
                className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-black/90 disabled:opacity-60"
              >
                貼り付けを取り込む
              </button>
              <button
                type="button"
                onClick={() => setPasteText('')}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-white"
              >
                クリア
              </button>
            </div>
          </div>
        </GlassCard>

        {/* 保存済みインジケータ */}
        {savedCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 shadow-sm">
              保存済み {savedCount} 件
            </span>
            <button
              type="button"
              onClick={recalcAll}
              className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-white"
            >
              再計算して保存
            </button>
          </div>
        )}

        {/* メッセージ */}
        <div className="space-y-2" aria-live="polite" aria-atomic="true">
          {message && <Banner type="success">{message}</Banner>}
          {error && <Banner type="error">{error}</Banner>}
          {!message && !error && (
            <Banner type="info">
              列順は自由です。<code className="px-1">売上高 / 営業利益 / 〜率(%)</code>
              が空でも自動計算します（日本語・英語ヘッダどちらも可）。取り込み時に<strong>年度×事業サマリー</strong>を保存します。
            </Banner>
          )}
        </div>

        {/* プレビュー */}
        {parsedData.length > 0 && (
          <GlassCard>
            <div className="p-4 md:p-5">
              <div className="mb-3 text-sm text-gray-700">読み込み {parsedData.length} 件</div>
              {preview.headers.length > 0 ? (
                <div className="overflow-auto rounded-xl border border-black/10">
                  <table className="min-w-full text-xs">
                    <thead className="bg-white/70">
                      <tr>
                        {preview.headers.map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-gray-700">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i} className="odd:bg-white/80 even:bg-white/60">
                          {row.map((cell, j) => (
                            <td key={j} className="px-3 py-2 text-gray-800 align-top">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-500">プレビュー可能なヘッダーが見つかりませんでした。</div>
              )}
            </div>
          </GlassCard>
        )}

        {/* アップロード状態 */}
        {uploading && (
          <div className="animate-pulse rounded-2xl border border-black/10 bg-white/60 p-4 text-sm text-gray-500">
            解析中…
          </div>
        )}
      </div>
    </StepLayout>
  );
}

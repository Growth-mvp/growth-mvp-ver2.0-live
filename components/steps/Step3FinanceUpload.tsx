// /app/step3/FinanceUpload.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import StepLayout from '@/components/StepLayout';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase';

/* =========================================================
 * Apple風ミニマルUI方針
 * - 余白広め / 角丸2xl / 超薄ボーダー / subtle shadow
 * - 透過ホワイト + glass（backdrop-blur）
 * - 控えめなタイポとモノトーン、要所のみアクセント
 * ========================================================= */

// セッターが無ければ setState にフォールバック（setCsvFinanceData / setCSVFinanceData 両対応）
function setFieldSafe(store: any, key: string, value: any) {
  const candidates = [
    'set' + key.charAt(0).toUpperCase() + key.slice(1), // 例: setCsvFinanceData
    key === 'csvFinanceData' ? 'setCSVFinanceData' : '', // 例: setCSVFinanceData
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

// Glassカード（共通枠）
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

// バナー（成功/エラー/情報）
function Banner({ type, children }: { type: 'success' | 'error' | 'info'; children: React.ReactNode }) {
  const styles = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    error: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-gray-50 text-gray-700 border-gray-200',
  }[type];
  return <div className={`rounded-xl border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export default function Step3FinanceUpload() {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [parsedData, setParsedData] = useState<any[]>([]);

  const st = useStrategyStore() as any;
  const { user } = useUserStore();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  // store の csvFinanceData を表示用 state に同期（再表示時にも内容が見える）
  useEffect(() => {
    const rows = Array.isArray(st?.csvFinanceData) ? (st.csvFinanceData as any[]) : [];
    setParsedData(rows);
  }, [st?.csvFinanceData]);

  const savedCount = useMemo(
    () => (Array.isArray(st?.csvFinanceData) ? st.csvFinanceData.length : 0),
    [st?.csvFinanceData],
  );

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
          const data = Array.isArray(result.data) ? (result.data as any[]) : [];
          // 1) ローカル表示
          setParsedData(data);
          // 2) ストア反映
          setFieldSafe(st, 'csvFinanceData', data);

          // 3) サーバ保存（ログイン時のみ）
          if (!user?.id) {
            setMessage('読み込み完了（未ログインのためサーバ保存はスキップ）');
            return;
          }

          const state = useStrategyStore.getState() as any;
          await saveStrategyData({ ...state, csvFinanceData: data }, user.id);
          setMessage('財務データを保存しました');
        } catch (err) {
          console.error('finance save failed:', err);
          setError('保存に失敗しました');
        } finally {
          setUploading(false);
          // 同じファイルを続けて選んでも onChange が発火するよう input をリセット
          if (inputRef.current) inputRef.current.value = '';
        }
      },
      error: () => {
        setError('CSVの解析に失敗しました');
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      },
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  // Drag & Drop（見た目だけでなく動作も）
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
    el.addEventListener('dragover', prevent);

    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
      el.removeEventListener('dragenter', prevent);
      el.removeEventListener('dragend', onDragLeave);
      el.removeEventListener('dragover', prevent);
    };
  }, []);

  // 簡易プレビュー（先頭 5 行・先頭 6 列）
  const preview = useMemo(() => {
    if (!parsedData?.length) return { headers: [], rows: [] as any[][] };
    const headers = Object.keys(parsedData[0] ?? {}).slice(0, 6);
    const rows = parsedData.slice(0, 5).map((r) => headers.map((h) => String(r?.[h] ?? '')));
    return { headers, rows };
  }, [parsedData]);

  return (
    <StepLayout step={3} totalSteps={5} title="財務データのアップロード">
      <div className="space-y-6">
        {/* ドロップゾーン */}
        <GlassCard>
          <div ref={dropRef} className="group relative overflow-hidden rounded-2xl p-6">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 to-white/10" />
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-white/70 shadow-sm">
                {/* 簡素なアイコン */}
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

        {/* 保存済みインジケータ */}
        {savedCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 shadow-sm">保存済み {savedCount} 件</span>
          </div>
        )}

        {/* メッセージ */}
        <div className="space-y-2" aria-live="polite" aria-atomic="true">
          {message && <Banner type="success">{message}</Banner>}
          {error && <Banner type="error">{error}</Banner>}
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

        {/* アップロード状態インジケータ（軽いスケルトン） */}
        {uploading && (
          <div className="animate-pulse rounded-2xl border border-black/10 bg-white/60 p-4 text-sm text-gray-500">
            解析中…
          </div>
        )}
      </div>
    </StepLayout>
  );
}

// /components/stage1/FinanceYearEditorTable.tsx
'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type { FinancePLRow, FinanceBSRow } from '@/types/strategy';

/* ===============================
 * ユーティリティ
 * =============================== */

function toNum(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function formatNum(v: number | undefined): string {
  if (v === undefined) return '';
  return v.toLocaleString();
}

/**
 * Excelコピペ用の数値正規化
 * - カンマ除去: "1,234" -> 1234
 * - ▲記号: "▲100" -> -100
 * - 括弧: "(100)" -> -100
 * - 空文字・無効値: undefined
 */
function sanitizeNumber(v: string | undefined | null): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;

  let str = String(v).trim();
  if (!str) return undefined;

  // ▲記号の負数化
  if (str.startsWith('▲')) {
    str = '-' + str.substring(1);
  }

  // 括弧の負数化
  if (str.startsWith('(') && str.endsWith(')')) {
    str = '-' + str.substring(1, str.length - 1);
  }

  // カンマ除去
  str = str.replace(/,/g, '');

  const n = Number(str);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * TSV文字列を2次元配列にパース
 * ★ 末尾の空行を除去
 */
function parseTSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.map((line) => line.split('\t'));
}

/* ===============================
 * PL テーブル
 * =============================== */

const PL_FIELDS = [
  { key: 'revenue' as const, label: '売上高', required: true },
  { key: 'grossProfit' as const, label: '売上総利益', required: false },
  { key: 'cogs' as const, label: '売上原価', required: false },
  { key: 'sga' as const, label: '販管費', required: false },
  { key: 'operatingIncome' as const, label: '営業利益', required: true },
  { key: 'depreciation' as const, label: '減価償却費', required: false },
  { key: 'interest' as const, label: '支払利息', required: false },
  { key: 'tax' as const, label: '法人税等', required: false },
  { key: 'netIncome' as const, label: '当期純利益', required: false },
] as const;

type PLFieldKey = (typeof PL_FIELDS)[number]['key'];

function CompanyPLEditor({
  years,
  data,
  onDataChange,
  onAddYear,
  onRemoveYear,
  onRenameYear,
  focusedCell,
  setFocusedCell,
}: {
  years: number[];
  data: FinancePLRow[];
  onDataChange: (rows: FinancePLRow[]) => void;
  onAddYear: () => void;
  onRemoveYear: (year: number) => void;
  onRenameYear: (oldYear: number, newYear: number) => boolean;
  focusedCell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null;
  setFocusedCell: (cell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null) => void;
}) {
  const [renamingYear, setRenamingYear] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const dataMap = useMemo(() => {
    const map = new Map<number, FinancePLRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const handleChange = useCallback(
    (year: number, field: PLFieldKey, value: string) => {
      console.debug('[PL] onChange', { year, field, value });
      const existingRow = dataMap.get(year) ?? { year };
      const updatedRow: FinancePLRow = { ...existingRow, [field]: toNum(value) };
      const newData = data.filter((r) => r.year !== year);
      newData.push(updatedRow);
      newData.sort((a, b) => a.year - b.year);
      onDataChange(newData);
    },
    [data, dataMap, onDataChange]
  );

  const handleRenameSubmit = (oldYear: number) => {
    const newYear = parseInt(renameValue, 10);
    if (Number.isNaN(newYear)) {
      alert('有効な数値を入力してください');
      return;
    }
    const success = onRenameYear(oldYear, newYear);
    if (success) {
      setRenamingYear(null);
      setRenameValue('');
    } else {
      alert('年度の変更に失敗しました（重複またはエラー）');
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[120px] border-r border-gray-300">
                項目
              </th>
              {years.map((y) => {
                const isActiveYear = focusedCell?.table === 'pl' && focusedCell?.year === y;
                return (
                  <th
                    key={y}
                    className={`px-3 py-2 text-center font-semibold min-w-[100px] border-r border-gray-300 transition-all ${
                      isActiveYear ? 'bg-blue-200 text-blue-900' : 'bg-gray-50 text-gray-700'
                    }`}
                  >
                    {renamingYear === y ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="w-16 px-1 py-0.5 border rounded text-xs"
                          autoFocus
                        />
                        <button
                          onClick={() => handleRenameSubmit(y)}
                          className="text-xs bg-green-600 text-white px-1 rounded hover:bg-green-700"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setRenamingYear(null)}
                          className="text-xs bg-gray-400 text-white px-1 rounded hover:bg-gray-500"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span>{y}年度</span>
                        <button
                          onClick={() => {
                            setRenamingYear(y);
                            setRenameValue(String(y));
                          }}
                          className="text-xs text-gray-500 hover:text-blue-600"
                          title="編集"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[80px] border-l border-gray-300">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {PL_FIELDS.map((field) => {
              const isActiveField = focusedCell?.table === 'pl' && focusedCell?.fieldKey === field.key;
              return (
                <tr key={field.key} className="border-b border-gray-300">
                  <td
                    className={`px-3 py-2 sticky left-0 border-r border-gray-300 transition-all ${
                      isActiveField ? 'bg-blue-100 text-gray-900 font-medium' : 'bg-white text-gray-700'
                    }`}
                  >
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </td>
                  {years.map((y) => {
                    const row = dataMap.get(y);
                    const val = row?.[field.key];
                    const isActive =
                      focusedCell?.table === 'pl' &&
                      focusedCell?.year === y &&
                      focusedCell?.fieldKey === field.key;
                    return (
                      <td
                        key={y}
                        className={`px-2 py-1 border-r border-gray-300 transition-all ${
                          isActive ? 'bg-blue-100 outline outline-2 outline-blue-500' : 'bg-white'
                        }`}
                      >
                        <input
                          type="text"
                          className="w-full bg-transparent px-0 py-0 text-right text-xs focus:outline-none"
                          value={val !== undefined ? String(val) : ''}
                          onChange={(e) => handleChange(y, field.key, e.target.value)}
                          onFocus={() => setFocusedCell({ table: 'pl', year: y, fieldKey: field.key })}
                          onBlur={() => setFocusedCell(null)}
                          placeholder="0"
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 border-l border-gray-300">
                    {/* 操作はヘッダーで */}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 行末の削除ボタン */}
      <div className="flex gap-1 justify-end">
        {years.map((y) => (
          <button
            key={`del-${y}`}
            onClick={() => {
              if (confirm(`${y}年度を削除しますか？`)) {
                onRemoveYear(y);
              }
            }}
            className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200"
            title={`${y}年度を削除`}
          >
            削除
          </button>
        ))}
      </div>

      {/* 年度追加ボタン */}
      <div className="flex gap-2">
        <button
          onClick={onAddYear}
          className="text-xs bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          + 年度追加
        </button>
      </div>
    </div>
  );
}

/* ===============================
 * BS テーブル
 * =============================== */

const BS_FIELDS = [
  { key: 'cash' as const, label: '現預金', required: false },
  { key: 'ar' as const, label: '売掛金', required: true },
  { key: 'inventory' as const, label: '棚卸資産', required: true },
  { key: 'ap' as const, label: '買掛金', required: true },
  { key: 'fixedAssets' as const, label: '固定資産', required: true },
  { key: 'totalAssets' as const, label: '総資産', required: false },
  { key: 'interestBearingDebt' as const, label: '有利子負債', required: true },
  { key: 'equity' as const, label: '純資産（株主資本）', required: true },
] as const;

type BSFieldKey = (typeof BS_FIELDS)[number]['key'];

function CompanyBSEditor({
  years,
  data,
  onDataChange,
  onAddYear,
  onRemoveYear,
  onRenameYear,
  focusedCell,
  setFocusedCell,
}: {
  years: number[];
  data: FinanceBSRow[];
  onDataChange: (rows: FinanceBSRow[]) => void;
  onAddYear: () => void;
  onRemoveYear: (year: number) => void;
  onRenameYear: (oldYear: number, newYear: number) => boolean;
  focusedCell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null;
  setFocusedCell: (cell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null) => void;
}) {
  const [renamingYear, setRenamingYear] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const dataMap = useMemo(() => {
    const map = new Map<number, FinanceBSRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const handleChange = useCallback(
    (year: number, field: BSFieldKey, value: string) => {
      console.debug('[BS] onChange', { year, field, value });
      const existingRow = dataMap.get(year) ?? { year };
      const updatedRow: FinanceBSRow = { ...existingRow, [field]: toNum(value) };
      const newData = data.filter((r) => r.year !== year);
      newData.push(updatedRow);
      newData.sort((a, b) => a.year - b.year);
      onDataChange(newData);
    },
    [data, dataMap, onDataChange]
  );

  const computedIC = useMemo(() => {
    const map = new Map<number, number | undefined>();
    years.forEach((y) => {
      const row = dataMap.get(y);
      if (!row) return map.set(y, undefined);
      const ar = row.ar ?? 0;
      const inventory = row.inventory ?? 0;
      const ap = row.ap ?? 0;
      const fixedAssets = row.fixedAssets ?? 0;
      if (ar || inventory || fixedAssets) map.set(y, ar + inventory - ap + fixedAssets);
      else map.set(y, undefined);
    });
    return map;
  }, [years, dataMap]);

  const handleRenameSubmit = (oldYear: number) => {
    const newYear = parseInt(renameValue, 10);
    if (Number.isNaN(newYear)) {
      alert('有効な数値を入力してください');
      return;
    }
    const success = onRenameYear(oldYear, newYear);
    if (success) {
      setRenamingYear(null);
      setRenameValue('');
    } else {
      alert('年度の変更に失敗しました（重複またはエラー）');
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[140px] border-r border-gray-300">
                項目
              </th>
              {years.map((y) => {
                const isActiveYear = focusedCell?.table === 'bs' && focusedCell?.year === y;
                return (
                  <th
                    key={y}
                    className={`px-3 py-2 text-center font-semibold min-w-[100px] border-r border-gray-300 transition-all ${
                      isActiveYear ? 'bg-blue-200 text-blue-900' : 'bg-gray-50 text-gray-700'
                    }`}
                  >
                    {renamingYear === y ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="w-16 px-1 py-0.5 border rounded text-xs"
                          autoFocus
                        />
                        <button
                          onClick={() => handleRenameSubmit(y)}
                          className="text-xs bg-green-600 text-white px-1 rounded hover:bg-green-700"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setRenamingYear(null)}
                          className="text-xs bg-gray-400 text-white px-1 rounded hover:bg-gray-500"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span>{y}年度</span>
                        <button
                          onClick={() => {
                            setRenamingYear(y);
                            setRenameValue(String(y));
                          }}
                          className="text-xs text-gray-500 hover:text-blue-600"
                          title="編集"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[80px] border-l border-gray-300">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {BS_FIELDS.map((field) => {
              const isActiveField = focusedCell?.table === 'bs' && focusedCell?.fieldKey === field.key;
              return (
                <tr key={field.key} className="border-b border-gray-300">
                  <td
                    className={`px-3 py-2 sticky left-0 border-r border-gray-300 transition-all ${
                      isActiveField ? 'bg-blue-100 text-gray-900 font-medium' : 'bg-white text-gray-700'
                    }`}
                  >
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </td>
                  {years.map((y) => {
                    const row = dataMap.get(y);
                    const val = row?.[field.key];
                    const isActive =
                      focusedCell?.table === 'bs' &&
                      focusedCell?.year === y &&
                      focusedCell?.fieldKey === field.key;
                    return (
                      <td
                        key={y}
                        className={`px-2 py-1 border-r border-gray-300 transition-all ${
                          isActive ? 'bg-blue-100 outline outline-2 outline-blue-500' : 'bg-white'
                        }`}
                      >
                        <input
                          type="text"
                          className="w-full bg-transparent px-0 py-0 text-right text-xs focus:outline-none"
                          value={val !== undefined ? String(val) : ''}
                          onChange={(e) => handleChange(y, field.key, e.target.value)}
                          onFocus={() => setFocusedCell({ table: 'bs', year: y, fieldKey: field.key })}
                          onBlur={() => setFocusedCell(null)}
                          placeholder="0"
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 border-l border-gray-300">
                    {/* 操作はヘッダーで */}
                  </td>
                </tr>
              );
            })}
            <tr className="border-b border-gray-300 bg-blue-50">
              <td className="px-3 py-2 text-gray-700 font-medium sticky left-0 bg-blue-50 border-r border-gray-300">
                投下資本（自動計算）
              </td>
              {years.map((y) => (
                <td key={y} className="px-3 py-2 text-right text-gray-700 border-r border-gray-300">
                  {computedIC.get(y) !== undefined ? formatNum(computedIC.get(y)) : '—'}
                </td>
              ))}
              <td className="px-2 py-1 border-l border-gray-300">
                {/* 操作はヘッダーで */}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">投下資本 = 売掛金 + 棚卸資産 - 買掛金 + 固定資産</p>

      {/* 行末の削除ボタン */}
      <div className="flex gap-1 justify-end">
        {years.map((y) => (
          <button
            key={`del-${y}`}
            onClick={() => {
              if (confirm(`${y}年度を削除しますか？`)) {
                onRemoveYear(y);
              }
            }}
            className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200"
            title={`${y}年度を削除`}
          >
            削除
          </button>
        ))}
      </div>

      {/* 年度追加ボタン */}
      <div className="flex gap-2">
        <button
          onClick={onAddYear}
          className="text-xs bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          + 年度追加
        </button>
      </div>
    </div>
  );
}

/* ===============================
 * 統合パネル（全社PL/BS）
 * =============================== */

type FinanceYearEditorTableProps =
  | {
      mode?: 'company';
      segmentName?: never;
    }
  | {
      mode: 'segment';
      segmentName: string;
    };

export function FinanceYearEditorTable(props?: FinanceYearEditorTableProps) {
  const mode = (props?.mode ?? 'company') as 'company' | 'segment';
  const segmentName = mode === 'segment' && props && 'segmentName' in props ? props.segmentName : undefined;

  // ★ focusedCell を追跡（paste を必ず拾うため）
  const [focusedCell, setFocusedCell] = useState<{
    table: 'pl' | 'bs';
    year: number;
    fieldKey: string;
  } | null>(null);

  // 全社データ
  const financePL = useStrategyStore((s) => s.financePL ?? []);
  const financeBS = useStrategyStore((s) => s.financeBS ?? []);
  const segmentPL = useStrategyStore((s) => s.segmentPL ?? {});
  const segmentBS = useStrategyStore((s) => s.segmentBS ?? {});

  // Actions
  const addFinanceYear = useStrategyStore((s) => s.addFinanceYear);
  const renameFinanceYear = useStrategyStore((s) => s.renameFinanceYear);
  const removeFinanceYear = useStrategyStore((s) => s.removeFinanceYear);
  const setFinancePL = useStrategyStore((s) => s.setFinancePL);
  const setFinanceBS = useStrategyStore((s) => s.setFinanceBS);
  const addSegmentFinanceYear = useStrategyStore((s) => s.addSegmentFinanceYear);
  const renameSegmentFinanceYear = useStrategyStore((s) => s.renameSegmentFinanceYear);
  const removeSegmentFinanceYear = useStrategyStore((s) => s.removeSegmentFinanceYear);
  const upsertSegmentPL = useStrategyStore((s) => s.upsertSegmentPL);
  const upsertSegmentBS = useStrategyStore((s) => s.upsertSegmentBS);

  // データの参照/更新先を mode に応じて切り替え
  const plData = mode === 'company' ? financePL : (segmentName ? segmentPL[segmentName] ?? [] : []);
  const bsData = mode === 'company' ? financeBS : (segmentName ? segmentBS[segmentName] ?? [] : []);

  const handleAddYear = (year?: number) => {
    if (mode === 'company') {
      addFinanceYear(year);
    } else if (segmentName) {
      addSegmentFinanceYear(segmentName, year);
    }
  };

  const handleRenameYear = (oldYear: number, newYear: number) => {
    if (mode === 'company') {
      return renameFinanceYear(oldYear, newYear);
    } else if (segmentName) {
      return renameSegmentFinanceYear(segmentName, oldYear, newYear);
    }
    return false;
  };

  const handleRemoveYear = (year: number) => {
    if (mode === 'company') {
      removeFinanceYear(year);
    } else if (segmentName) {
      removeSegmentFinanceYear(segmentName, year);
    }
  };

  const handleSetPL = (rows: FinancePLRow[]) => {
    console.debug('[handleSetPL]', { rowsLen: rows.length, sample: rows[0] });
    if (mode === 'company') {
      setFinancePL(rows);
    } else if (segmentName) {
      upsertSegmentPL(segmentName, rows);
    }
  };

  const handleSetBS = (rows: FinanceBSRow[]) => {
    console.debug('[handleSetBS]', { rowsLen: rows.length, sample: rows[0] });
    if (mode === 'company') {
      setFinanceBS(rows);
    } else if (segmentName) {
      upsertSegmentBS(segmentName, rows);
    }
  };

  const years = useMemo(() => {
    const plYears = plData.map((r) => r.year);
    const bsYears = bsData.map((r) => r.year);
    const allYears = [...new Set([...plYears, ...bsYears])];
    const sorted = allYears.sort((a, b) => a - b);

    // 年度が空の場合、デフォルト（直近3年）を表示用に生成
    if (sorted.length === 0) {
      const now = new Date().getFullYear();
      return [now - 3, now - 2, now - 1];
    }
    return sorted;
  }, [plData, bsData]);

  // 初回時に年度が空なら自動追加（最低限の初期化）
  useEffect(() => {
    if (plData.length === 0 && bsData.length === 0) {
      const now = new Date().getFullYear();
      if (mode === 'company') {
        addFinanceYear(now - 1);
      } else if (segmentName) {
        addSegmentFinanceYear(segmentName, now - 1);
      }
    }
  }, [plData.length, bsData.length, mode, segmentName, addFinanceYear, addSegmentFinanceYear]);

  /**
   * ★ テーブルレベルで paste を拾う（起点セルが確定している場合のみ展開）
   */
  const handlePasteFromContainer = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>, tableType: 'pl' | 'bs') => {
      // focusedCell が無ければ何もしない（ブラウザ既定の貼り付けに委ねる）
      if (!focusedCell || focusedCell.table !== tableType) return;

      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;

      e.preventDefault(); // ★ ここで初めて preventDefault（起点がある場合のみ）

      const grid = parseTSV(text);
      if (grid.length === 0) return;

      const FIELDS = tableType === 'pl' ? PL_FIELDS : BS_FIELDS;
      const startFieldIndex = FIELDS.findIndex((f) => f.key === focusedCell.fieldKey);
      const startYearIndex = years.findIndex((y) => y === focusedCell.year);

      if (startFieldIndex === -1 || startYearIndex === -1) return;

      // 取得対象のデータ
      const currentData = tableType === 'pl' ? plData : bsData;
      const dataMap = new Map<number, any>();
      currentData.forEach((row) => dataMap.set(row.year, row));

      // ★ バッチ更新用の Map を作成
      const working = new Map(dataMap);
      let appliedCount = 0;

      // 2次元展開
      grid.forEach((row, rowOffset) => {
        row.forEach((cellValue, colOffset) => {
          const targetFieldIndex = startFieldIndex + rowOffset;
          const targetYearIndex = startYearIndex + colOffset;

          // 範囲外チェック
          if (targetFieldIndex >= FIELDS.length || targetYearIndex >= years.length) return;

          const targetField = FIELDS[targetFieldIndex];
          const targetYear = years[targetYearIndex];

          const num = sanitizeNumber(cellValue);
          if (num === undefined) return; // 空はスキップ

          // Map に書き込む
          const existingRow = working.get(targetYear) ?? { year: targetYear };
          const updatedRow = { ...existingRow, [targetField.key]: num };
          working.set(targetYear, updatedRow);
          appliedCount++;
        });
      });

      // ★ バッチで onDataChange() を1回だけ呼ぶ
      if (appliedCount > 0) {
        const newData = Array.from(working.values()).sort((a, b) => a.year - b.year);
        console.debug(`${tableType.toUpperCase()} handlePasteFromContainer`, {
          startYear: focusedCell.year,
          startField: focusedCell.fieldKey,
          gridSize: `${grid.length}×${grid[0]?.length ?? 0}`,
          appliedCount,
        });
        if (tableType === 'pl') {
          handleSetPL(newData);
        } else {
          handleSetBS(newData);
        }
      }
    },
    [focusedCell, years, plData, bsData, handleSetPL, handleSetBS]
  );

  const title = mode === 'company' ? '全社' : segmentName ? `${segmentName}` : '事業部';
  const description = mode === 'company'
    ? 'PL/BSを入力すると、企業価値指標（ROIC等）が自動計算されます。'
    : 'PL/BSを入力すると、セグメント別の分析が可能になります。';

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">財務データ入力（{title}）</h2>
        <p className="text-sm text-gray-600">{description}</p>
      </div>

      {/* 初期化メッセージ */}
      {plData.length === 0 && bsData.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
          📋 初期表示として直近3年が表示されます。データ入力を開始するには、「年度追加」ボタンをクリックして年度を設定してください。
        </div>
      )}

      {/* PL */}
      <div
        className="border rounded-lg overflow-hidden p-4"
        onPasteCapture={(e) => handlePasteFromContainer(e, 'pl')}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold">{title} PL（損益計算書）</h3>
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800 max-w-xs">
            💡 セルをクリックしてから <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border">Ctrl+V</kbd> で貼り付けできます
          </div>
        </div>
        <CompanyPLEditor
          years={years}
          data={plData}
          onDataChange={handleSetPL}
          onAddYear={() => handleAddYear()}
          onRemoveYear={handleRemoveYear}
          onRenameYear={handleRenameYear}
          focusedCell={focusedCell}
          setFocusedCell={setFocusedCell}
        />
      </div>

      {/* BS */}
      <div
        className="border rounded-lg overflow-hidden p-4"
        onPasteCapture={(e) => handlePasteFromContainer(e, 'bs')}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold">{title} BS（貸借対照表）</h3>
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800 max-w-xs">
            💡 セルをクリックしてから <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border">Ctrl+V</kbd> で貼り付けできます
          </div>
        </div>
        <CompanyBSEditor
          years={years}
          data={bsData}
          onDataChange={handleSetBS}
          onAddYear={() => handleAddYear()}
          onRemoveYear={handleRemoveYear}
          onRenameYear={handleRenameYear}
          focusedCell={focusedCell}
          setFocusedCell={setFocusedCell}
        />
      </div>
    </section>
  );
}

export default FinanceYearEditorTable;

// /components/stage1/FinanceYearEditorTable.tsx
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import type { FinancePLRow, FinanceBSRow } from '@/types/strategy';

/* ===============================
 * 型定義（範囲選択用）
 * =============================== */
type CellPos = { table: 'pl' | 'bs'; r: number; c: number }; // r=fieldIndex, c=yearIndex
type Selection = { table: 'pl' | 'bs'; start: CellPos; end: CellPos } | null;

/* ===============================
 * Undo/Redo 用スナップショット
 * =============================== */
type SnapshotState = {
  financePL: FinancePLRow[];
  financeBS: FinanceBSRow[];
  segmentPL?: Record<string, FinancePLRow[]>;
  segmentBS?: Record<string, FinanceBSRow[]>;
};

/* ===============================
 * グローバル ref マップ（セル focus 用）
 * =============================== */
const cellInputRefs = new Map<string, HTMLInputElement>();

function getCellRefKey(table: 'pl' | 'bs', fieldKey: string, year: number): string {
  return `${table}:${fieldKey}:${year}`;
}

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

function isCellInSelection(sel: Selection, table: 'pl' | 'bs', r: number, c: number): boolean {
  if (!sel || sel.table !== table) return false;
  const r1 = Math.min(sel.start.r, sel.end.r);
  const r2 = Math.max(sel.start.r, sel.end.r);
  const c1 = Math.min(sel.start.c, sel.end.c);
  const c2 = Math.max(sel.start.c, sel.end.c);
  return r >= r1 && r <= r2 && c >= c1 && c <= c2;
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
  activeCell,
  setActiveCell,
  editingCell,
  setEditingCell,
  selection,
  setSelection,
  isDraggingRef,
  anchorRef,
  onMouseDownCell,
  onMouseEnterCell,
  onMouseUpCell,
  onSaveSnapshot,
}: {
  years: number[];
  data: FinancePLRow[];
  onDataChange: (rows: FinancePLRow[]) => void;
  onAddYear: () => void;
  onRemoveYear: (year: number) => void;
  onRenameYear: (oldYear: number, newYear: number) => boolean;
  focusedCell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null;
  setFocusedCell: (cell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null) => void;
  activeCell: CellPos | null;
  setActiveCell: (cell: CellPos | null) => void;
  editingCell: CellPos | null;
  setEditingCell: (cell: CellPos | null) => void;
  selection: Selection;
  setSelection: (sel: Selection) => void;
  isDraggingRef: MutableRefObject<boolean>;
  anchorRef: MutableRefObject<CellPos | null>;
  onMouseDownCell: (table: 'pl' | 'bs', r: number, c: number) => void;
  onMouseEnterCell: (table: 'pl' | 'bs', r: number, c: number) => void;
  onMouseUpCell: () => void;
  onSaveSnapshot: () => void;
}) {
  const [renamingYear, setRenamingYear] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  /**
   * ★ 重要: draft を「セル単位」で保持
   * - 以前の実装では draftValue がテーブル内で1つだけだったため、
   *   別セルに移動した時に前セルの入力が残り、"勝手な数値が出る/消える" 事象の原因になっていました。
   */
  const [draft, setDraft] = useState<{ key: string; value: string }>({ key: '', value: '' });

  const dataMap = useMemo(() => {
    const map = new Map<number, FinancePLRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const getDisplayValue = useCallback(
    (year: number, field: PLFieldKey) => {
      const row = dataMap.get(year);
      const v = row?.[field];
      return v !== undefined && v !== null ? String(v) : '';
    },
    [dataMap]
  );

  // focusedCell が変わったら draft を同期（常に「今フォーカスしているセル」の文字列を保持）
  useEffect(() => {
    if (!focusedCell || focusedCell.table !== 'pl') {
      setDraft({ key: '', value: '' });
      return;
    }
    const fieldKey = focusedCell.fieldKey as PLFieldKey;
    const key = getCellRefKey('pl', fieldKey, focusedCell.year);
    const value = getDisplayValue(focusedCell.year, fieldKey);
    setDraft({ key, value });
  }, [focusedCell?.table, focusedCell?.year, focusedCell?.fieldKey, getDisplayValue]);

  const upsertCellValue = useCallback(
    (year: number, field: PLFieldKey, raw: string) => {
      const existingRow = dataMap.get(year) ?? { year };
      const num = toNum(raw);

      // undefined の時はフィールドを削除（Excel的に「空=クリア」）
      const nextRow: any = { ...existingRow };
      if (num === undefined) {
        delete nextRow[field];
      } else {
        nextRow[field] = num;
      }

      const newData = data.filter((r) => r.year !== year);
      newData.push(nextRow as FinancePLRow);
      newData.sort((a, b) => a.year - b.year);
      onDataChange(newData);
    },
    [data, dataMap, onDataChange]
  );

  const commitActiveCell = useCallback(() => {
    if (!focusedCell || focusedCell.table !== 'pl') return;
    const fieldKey = focusedCell.fieldKey as PLFieldKey;
    upsertCellValue(focusedCell.year, fieldKey, draft.value);
    onSaveSnapshot();
  }, [focusedCell, draft.value, upsertCellValue, onSaveSnapshot]);

  const handleRenameSubmit = useCallback(
    (oldYear: number) => {
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
    },
    [renameValue, onRenameYear]
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed text-xs border border-zinc-200 border-separate border-spacing-0">
          <colgroup>
            <col style={{ width: 180 }} />
            {years.map((y) => (
              <col key={y} style={{ width: 120 }} />
            ))}
          </colgroup>
          <thead className="bg-zinc-50 sticky top-0 z-20">
            <tr>
              <th className="px-3 py-2 text-left border-r border-zinc-200 sticky left-0 bg-zinc-50 z-10 w-[180px]">
                項目
              </th>
              {years.map((y) => (
                <th key={y} className="px-3 py-2 text-center border-r border-zinc-200 w-[120px]">
                  {renamingYear === y ? (
                    <div className="flex items-center gap-1 justify-center">
                      <input
                        type="text"
                        className="w-20 text-xs border rounded px-1 py-0.5"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit(y);
                          if (e.key === 'Escape') {
                            setRenamingYear(null);
                            setRenameValue('');
                          }
                        }}
                        autoFocus
                      />
                      <button
                        className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded"
                        onClick={() => handleRenameSubmit(y)}
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        className="text-xs font-semibold text-zinc-900 hover:underline"
                        onClick={() => {
                          setRenamingYear(y);
                          setRenameValue(String(y));
                        }}
                        title="クリックして年度名を編集"
                        type="button"
                      >
                        {y}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-zinc-200 text-zinc-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition"
                        title={`${y}年度を削除`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`${y}年度を削除しますか？`)) onRemoveYear(y);
                        }}
                        aria-label={`${y}年度を削除`}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {PL_FIELDS.map((field, fieldIndex) => {
              const isActiveField = focusedCell?.table === 'pl' && focusedCell?.fieldKey === field.key;
              return (
                <tr key={field.key} className="border-b border-zinc-200">
                  <td
                    className={`px-3 py-2 sticky left-0 border-r border-zinc-200 transition-all ${
                      isActiveField ? 'bg-sky-100/60 text-gray-900 font-medium' : 'bg-white text-zinc-700'
                    }`}
                  >
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </td>

                  {years.map((y, yearIndex) => {
                    const isSelectedCell =
                      activeCell?.table === 'pl' && activeCell.r === fieldIndex && activeCell.c === yearIndex;
                    const isEditing =
                      editingCell?.table === 'pl' && editingCell.r === fieldIndex && editingCell.c === yearIndex;

                    const isCrossRow = activeCell?.table === 'pl' && activeCell.r === fieldIndex;
                    const isCrossCol = activeCell?.table === 'pl' && activeCell.c === yearIndex;
                    const row = dataMap.get(y);
                    const numVal = (row as any)?.[field.key] as number | undefined;
                    const formattedValue = numVal !== undefined && numVal !== null ? formatNum(numVal) : '';
                    const rawValue = numVal !== undefined && numVal !== null ? String(numVal) : '';


                    const isSelected = isCellInSelection(selection, 'pl', fieldIndex, yearIndex);
                    return (
                      <td
                        key={y}
                        onMouseDown={() => {
                          // Excelモード: クリック=選択（編集は Enter/F2/ダブルクリック）
                          setEditingCell(null);
                          setFocusedCell({ table: 'pl', year: y, fieldKey: field.key });
                          onMouseDownCell('pl', fieldIndex, yearIndex);
                        }}
                        onDoubleClick={() => {
                          setFocusedCell({ table: 'pl', year: y, fieldKey: field.key });
                          setActiveCell({ table: 'pl', r: fieldIndex, c: yearIndex });
                          setSelection({ table: 'pl', start: { table: 'pl', r: fieldIndex, c: yearIndex }, end: { table: 'pl', r: fieldIndex, c: yearIndex } });
                          setEditingCell({ table: 'pl', r: fieldIndex, c: yearIndex });
                        }}
                        onMouseMove={() => {
                          if (isDraggingRef.current && anchorRef.current) {
                            onMouseEnterCell('pl', fieldIndex, yearIndex);
                          }
                        }}
                        onMouseUp={onMouseUpCell}
                        className={`px-2 py-1 border-r border-zinc-200 border-b transition-colors h-8 text-xs align-middle overflow-hidden ${
                          isSelectedCell ? 'bg-white ring-2 ring-sky-500 ring-inset' : 'bg-white'
                        } ${isSelected ? 'bg-sky-100/60' : ''} ${!isSelected && (isCrossRow || isCrossCol) ? 'bg-sky-50/60' : ''} hover:bg-sky-50/40`}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            ref={(el) => {
                              if (el) cellInputRefs.set(getCellRefKey('pl', field.key, y), el);
                            }}
                            className="w-full min-w-0 bg-transparent border-0 px-2 py-1 text-right text-xs tabular-nums font-mono outline-none focus:outline-none"
                            value={draft.key === getCellRefKey('pl', field.key, y) ? draft.value : rawValue}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => setFocusedCell({ table: 'pl', year: y, fieldKey: field.key })}
                            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                            onBlur={() => {
                              commitActiveCell();
                              setEditingCell(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setDraft((d) => ({ ...d, value: rawValue }));
                                setEditingCell(null);
                                return;
                              }

                              const commitAndMove = (nextFieldIndex: number, nextYearIndex: number) => {
                                commitActiveCell();
                                setEditingCell(null);
                                if (
                                  nextFieldIndex >= 0 &&
                                  nextFieldIndex < PL_FIELDS.length &&
                                  nextYearIndex >= 0 &&
                                  nextYearIndex < years.length
                                ) {
                                  const nextField = PL_FIELDS[nextFieldIndex];
                                  const nextYear = years[nextYearIndex];
                                  setFocusedCell({ table: 'pl', year: nextYear, fieldKey: nextField.key });
                                  setActiveCell({ table: 'pl', r: nextFieldIndex, c: nextYearIndex });
                                } else {
                                  setActiveCell(null);
                                  setFocusedCell(null);
                                }
                              };

                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitAndMove(fieldIndex + 1, yearIndex);
                                return;
                              }
                              if (e.key === 'Tab') {
                                e.preventDefault();
                                commitAndMove(fieldIndex, yearIndex + (e.shiftKey ? -1 : 1));
                                return;
                              }

                              const keyMap: Record<string, { dr: number; dc: number } | undefined> = {
                                ArrowUp: { dr: -1, dc: 0 },
                                ArrowDown: { dr: 1, dc: 0 },
                                ArrowLeft: { dr: 0, dc: -1 },
                                ArrowRight: { dr: 0, dc: 1 },
                              };
                              const move = keyMap[e.key];
                              if (move) {
                                e.preventDefault();
                                commitAndMove(fieldIndex + move.dr, yearIndex + move.dc);
                              }
                            }}
                            placeholder="0"
                          />
                        ) : (
                          <div className="text-right px-2 py-1 w-full text-xs tabular-nums font-mono truncate">{formattedValue}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 年度追加ボタン */}
      <div className="flex gap-2">
        <button onClick={onAddYear} className="inline-flex items-center gap-2 text-xs font-semibold bg-sky-600 text-white px-3 py-2 rounded-lg hover:bg-sky-700 shadow-sm" type="button">
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
  activeCell,
  setActiveCell,
  editingCell,
  setEditingCell,
  selection,
  setSelection,
  isDraggingRef,
  anchorRef,
  onMouseDownCell,
  onMouseEnterCell,
  onMouseUpCell,
  onSaveSnapshot,
}: {
  years: number[];
  data: FinanceBSRow[];
  onDataChange: (rows: FinanceBSRow[]) => void;
  onAddYear: () => void;
  onRemoveYear: (year: number) => void;
  onRenameYear: (oldYear: number, newYear: number) => boolean;
  focusedCell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null;
  setFocusedCell: (cell: { table: 'pl' | 'bs'; year: number; fieldKey: string } | null) => void;
  activeCell: CellPos | null;
  setActiveCell: (cell: CellPos | null) => void;
  editingCell: CellPos | null;
  setEditingCell: (cell: CellPos | null) => void;
  selection: Selection;
  setSelection: (sel: Selection) => void;
  isDraggingRef: MutableRefObject<boolean>;
  anchorRef: MutableRefObject<CellPos | null>;
  onMouseDownCell: (table: 'pl' | 'bs', r: number, c: number) => void;
  onMouseEnterCell: (table: 'pl' | 'bs', r: number, c: number) => void;
  onMouseUpCell: () => void;
  onSaveSnapshot: () => void;
}) {
  const [renamingYear, setRenamingYear] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [draft, setDraft] = useState<{ key: string; value: string }>({ key: '', value: '' });

  const dataMap = useMemo(() => {
    const map = new Map<number, FinanceBSRow>();
    data.forEach((row) => map.set(row.year, row));
    return map;
  }, [data]);

  const getDisplayValue = useCallback(
    (year: number, field: BSFieldKey) => {
      const row = dataMap.get(year);
      const v = row?.[field];
      return v !== undefined && v !== null ? String(v) : '';
    },
    [dataMap]
  );

  useEffect(() => {
    if (!focusedCell || focusedCell.table !== 'bs') {
      setDraft({ key: '', value: '' });
      return;
    }
    const fieldKey = focusedCell.fieldKey as BSFieldKey;
    const key = getCellRefKey('bs', fieldKey, focusedCell.year);
    const value = getDisplayValue(focusedCell.year, fieldKey);
    setDraft({ key, value });
  }, [focusedCell?.table, focusedCell?.year, focusedCell?.fieldKey, getDisplayValue]);

  const upsertCellValue = useCallback(
    (year: number, field: BSFieldKey, raw: string) => {
      const existingRow = dataMap.get(year) ?? { year };
      const num = toNum(raw);

      const nextRow: any = { ...existingRow };
      if (num === undefined) {
        delete nextRow[field];
      } else {
        nextRow[field] = num;
      }

      const newData = data.filter((r) => r.year !== year);
      newData.push(nextRow as FinanceBSRow);
      newData.sort((a, b) => a.year - b.year);
      onDataChange(newData);
    },
    [data, dataMap, onDataChange]
  );

  const commitActiveCell = useCallback(() => {
    if (!focusedCell || focusedCell.table !== 'bs') return;
    const fieldKey = focusedCell.fieldKey as BSFieldKey;
    upsertCellValue(focusedCell.year, fieldKey, draft.value);
    onSaveSnapshot();
  }, [focusedCell, draft.value, upsertCellValue, onSaveSnapshot]);

  const handleRenameSubmit = useCallback(
    (oldYear: number) => {
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
    },
    [renameValue, onRenameYear]
  );

  // 投下資本（自動計算）
  const computedIC = useMemo(() => {
    const map = new Map<number, number>();
    years.forEach((y) => {
      const row = dataMap.get(y);
      const ar = row?.ar ?? 0;
      const inv = row?.inventory ?? 0;
      const ap = row?.ap ?? 0;
      const fa = row?.fixedAssets ?? 0;
      const ic = ar + inv - ap + fa;
      map.set(y, ic);
    });
    return map;
  }, [years, dataMap]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed text-xs border border-zinc-200 border-separate border-spacing-0">
          <colgroup>
            <col style={{ width: 180 }} />
            {years.map((y) => (
              <col key={y} style={{ width: 120 }} />
            ))}
          </colgroup>
          <thead className="bg-zinc-50 sticky top-0 z-20">
            <tr>
              <th className="px-3 py-2 text-left border-r border-zinc-200 sticky left-0 bg-zinc-50 z-10 w-[180px]">
                項目
              </th>
              {years.map((y) => (
                <th key={y} className="px-3 py-2 text-center border-r border-zinc-200 w-[120px]">
                  {renamingYear === y ? (
                    <div className="flex items-center gap-1 justify-center">
                      <input
                        type="text"
                        className="w-20 text-xs border rounded px-1 py-0.5"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit(y);
                          if (e.key === 'Escape') {
                            setRenamingYear(null);
                            setRenameValue('');
                          }
                        }}
                        autoFocus
                      />
                      <button
                        className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded"
                        onClick={() => handleRenameSubmit(y)}
                        type="button"
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        className="text-xs font-semibold text-zinc-900 hover:underline"
                        onClick={() => {
                          setRenamingYear(y);
                          setRenameValue(String(y));
                        }}
                        title="クリックして年度名を編集"
                        type="button"
                      >
                        {y}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-zinc-200 text-zinc-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition"
                        title={`${y}年度を削除`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`${y}年度を削除しますか？`)) onRemoveYear(y);
                        }}
                        aria-label={`${y}年度を削除`}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {BS_FIELDS.map((field, fieldIndex) => {
              const isActiveField = focusedCell?.table === 'bs' && focusedCell?.fieldKey === field.key;
              return (
                <tr key={field.key} className="border-b border-zinc-200">
                  <td
                    className={`px-3 py-2 sticky left-0 border-r border-zinc-200 transition-all ${
                      isActiveField ? 'bg-sky-100/60 text-gray-900 font-medium' : 'bg-white text-zinc-700'
                    }`}
                  >
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </td>

                  {years.map((y, yearIndex) => {
                    const isSelectedCell =
                      activeCell?.table === 'bs' && activeCell.r === fieldIndex && activeCell.c === yearIndex;
                    const isEditing =
                      editingCell?.table === 'bs' && editingCell.r === fieldIndex && editingCell.c === yearIndex;

                    const isCrossRow = activeCell?.table === 'bs' && activeCell.r === fieldIndex;
                    const isCrossCol = activeCell?.table === 'bs' && activeCell.c === yearIndex;

                    const isSelected = isCellInSelection(selection, 'bs', fieldIndex, yearIndex);


                    const row = dataMap.get(y);
                    const numVal = (row as any)?.[field.key] as number | undefined;
                    const formattedValue = numVal !== undefined && numVal !== null ? formatNum(numVal) : '';
                    const rawValue = numVal !== undefined && numVal !== null ? String(numVal) : '';

                    return (
                      <td
                        key={y}
                        onMouseDown={() => {
                          setEditingCell(null);
                          setFocusedCell({ table: 'bs', year: y, fieldKey: field.key });
                          onMouseDownCell('bs', fieldIndex, yearIndex);
                        }}
                        onDoubleClick={() => {
                          setFocusedCell({ table: 'bs', year: y, fieldKey: field.key });
                          setActiveCell({ table: 'bs', r: fieldIndex, c: yearIndex });
                          setSelection({ table: 'bs', start: { table: 'bs', r: fieldIndex, c: yearIndex }, end: { table: 'bs', r: fieldIndex, c: yearIndex } });
                          setEditingCell({ table: 'bs', r: fieldIndex, c: yearIndex });
                        }}
                        onMouseMove={() => {
                          if (isDraggingRef.current && anchorRef.current) {
                            onMouseEnterCell('bs', fieldIndex, yearIndex);
                          }
                        }}
                        onMouseUp={onMouseUpCell}
                        className={`px-2 py-1 border-r border-zinc-200 border-b transition-colors h-8 text-xs align-middle overflow-hidden ${
                          isSelectedCell ? 'bg-white ring-2 ring-sky-500 ring-inset' : 'bg-white'
                        } ${isSelected ? 'bg-sky-100/60' : ''} ${!isSelected && (isCrossRow || isCrossCol) ? 'bg-sky-50/60' : ''} hover:bg-sky-50/40`}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            ref={(el) => {
                              if (el) cellInputRefs.set(getCellRefKey('bs', field.key, y), el);
                            }}
                            className="w-full min-w-0 bg-transparent border-0 px-2 py-1 text-right text-xs tabular-nums font-mono outline-none focus:outline-none"
                            value={draft.key === getCellRefKey('bs', field.key, y) ? draft.value : rawValue}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => setFocusedCell({ table: 'bs', year: y, fieldKey: field.key })}
                            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                            onBlur={() => {
                              commitActiveCell();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setDraft((d) => ({ ...d, value: rawValue }));
                                setEditingCell(null);
                                return;
                              }

                              const commitAndMove = (nextFieldIndex: number, nextYearIndex: number) => {
                                commitActiveCell();
                                if (
                                  nextFieldIndex >= 0 &&
                                  nextFieldIndex < BS_FIELDS.length &&
                                  nextYearIndex >= 0 &&
                                  nextYearIndex < years.length
                                ) {
                                  const nextField = BS_FIELDS[nextFieldIndex];
                                  const nextYear = years[nextYearIndex];
                                  setFocusedCell({ table: 'bs', year: nextYear, fieldKey: nextField.key });
                                  setActiveCell({ table: 'bs', r: nextFieldIndex, c: nextYearIndex });
                                } else {
                                  setFocusedCell(null);
                                }
                              };

                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitAndMove(fieldIndex + 1, yearIndex);
                                return;
                              }
                              if (e.key === 'Tab') {
                                e.preventDefault();
                                commitAndMove(fieldIndex, yearIndex + (e.shiftKey ? -1 : 1));
                                return;
                              }

                              const keyMap: Record<string, { dr: number; dc: number } | undefined> = {
                                ArrowUp: { dr: -1, dc: 0 },
                                ArrowDown: { dr: 1, dc: 0 },
                                ArrowLeft: { dr: 0, dc: -1 },
                                ArrowRight: { dr: 0, dc: 1 },
                              };
                              const move = keyMap[e.key];
                              if (move) {
                                e.preventDefault();
                                commitAndMove(fieldIndex + move.dr, yearIndex + move.dc);
                              }
                            }}
                            placeholder="0"
                          />
                        ) : (
                          <div className="text-right px-2 py-1 w-full text-xs tabular-nums font-mono truncate">{formattedValue}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            <tr className="border-b border-zinc-200 bg-sky-50">
              <td className="px-3 py-2 text-zinc-700 font-medium sticky left-0 bg-sky-50 border-r border-zinc-200">
                投下資本（自動計算）
              </td>
              {years.map((y) => (
                <td key={y} className="px-3 py-2 text-right text-zinc-700 border-r border-zinc-200">
                  {computedIC.get(y) !== undefined ? formatNum(computedIC.get(y)) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">投下資本 = 売掛金 + 棚卸資産 - 買掛金 + 固定資産</p>

      {/* 年度追加ボタン */}
      <div className="flex gap-2">
        <button onClick={onAddYear} className="inline-flex items-center gap-2 text-xs font-semibold bg-sky-600 text-white px-3 py-2 rounded-lg hover:bg-sky-700 shadow-sm" type="button">
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

  // ★ ドラッグ範囲選択用の state
  const [activeCell, setActiveCell] = useState<CellPos | null>(null);

  // ★ Excelモード: 選択(クリック)と編集(Enter/ダブルクリック)を分離
  const [editingCell, setEditingCell] = useState<CellPos | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const isDraggingRef = useRef(false);
  const anchorRef = useRef<CellPos | null>(null);

  // ★ Undo/Redo スタック
  const [history, setHistory] = useState<SnapshotState[]>([]);
  const [future, setFuture] = useState<SnapshotState[]>([]);

  // ★ 編集モードに入ったセルへ確実に focus を当てる（Excelモード）
  useEffect(() => {
    if (!editingCell || !focusedCell) return;
    if (editingCell.table !== focusedCell.table) return;

    const refKey = getCellRefKey(focusedCell.table, focusedCell.fieldKey, focusedCell.year);
    const inputEl = cellInputRefs.get(refKey);

    if (inputEl) {
      // setTimeout で確実に focus（再描画直後）
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 0);
    }
  }, [editingCell, focusedCell]);

  // 全社データ
  const financePL = useStrategyStore((s: StrategyState) => s.financePL ?? []);
  const financeBS = useStrategyStore((s: StrategyState) => s.financeBS ?? []);
  const segmentPL = useStrategyStore((s: StrategyState) => s.segmentPL ?? {});
  const segmentBS = useStrategyStore((s: StrategyState) => s.segmentBS ?? {});

  // Actions
  const addFinanceYear = useStrategyStore((s: StrategyState) => s.addFinanceYear);
  const renameFinanceYear = useStrategyStore((s: StrategyState) => s.renameFinanceYear);
  const removeFinanceYear = useStrategyStore((s: StrategyState) => s.removeFinanceYear);
  const setFinancePL = useStrategyStore((s: StrategyState) => s.setFinancePL);
  const setFinanceBS = useStrategyStore((s: StrategyState) => s.setFinanceBS);
  const addSegmentFinanceYear = useStrategyStore((s: StrategyState) => s.addSegmentFinanceYear);
  const renameSegmentFinanceYear = useStrategyStore((s: StrategyState) => s.renameSegmentFinanceYear);
  const removeSegmentFinanceYear = useStrategyStore((s: StrategyState) => s.removeSegmentFinanceYear);
  const upsertSegmentPL = useStrategyStore((s: StrategyState) => s.upsertSegmentPL);
  const upsertSegmentBS = useStrategyStore((s: StrategyState) => s.upsertSegmentBS);

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

  // ★ ドラッグ範囲選択ハンドラ
  const onMouseDownCell = useCallback(
    (table: 'pl' | 'bs', r: number, c: number) => {
      const cell: CellPos = { table, r, c };
      anchorRef.current = cell;
      setActiveCell(cell);
      setSelection({ table, start: cell, end: cell });
      isDraggingRef.current = true;
    },
    []
  );

  const onMouseEnterCell = useCallback(
    (table: 'pl' | 'bs', r: number, c: number) => {
      if (!isDraggingRef.current || !anchorRef.current) return;
      if (anchorRef.current.table !== table) return;

      const cell: CellPos = { table, r, c };
      setSelection({
        table,
        start: anchorRef.current,
        end: cell,
      });
    },
    []
  );

  const onMouseUpCell = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // ★ Undo/Redo ロジック
  const saveSnapshot = useCallback(() => {
    // 現在の状態をスナップショットとして保存
    const snapshot: SnapshotState = {
      // ★ 参照のままだと履歴が後から書き換わるので、必ずコピーを保存
      financePL: mode === 'company' ? plData.map((r) => ({ ...r })) : [],
      financeBS: mode === 'company' ? bsData.map((r) => ({ ...r })) : [],
      ...(mode === 'segment' && {
        segmentPL: Object.fromEntries(Object.entries(segmentPL).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
        segmentBS: Object.fromEntries(Object.entries(segmentBS).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
      }),
    };
    setHistory((prev) => [...prev, snapshot]);
    setFuture([]); // redo スタックをクリア
  }, [mode, plData, bsData, segmentPL, segmentBS]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;

    // 現在の状態をfutureに
    const currentSnapshot: SnapshotState = {
      financePL: plData.map((r) => ({ ...r })),
      financeBS: bsData.map((r) => ({ ...r })),
      ...(mode === 'segment' && { segmentPL, segmentBS }),
    };
    setFuture((prev) => [...prev, currentSnapshot]);

    // 過去の状態を復元
    const newHistory = [...history];
    const previousSnapshot = newHistory.pop()!;
    setHistory(newHistory);

    // store に反映
    if (mode === 'company') {
      if (previousSnapshot.financePL.length > 0) setFinancePL(previousSnapshot.financePL);
      if (previousSnapshot.financeBS.length > 0) setFinanceBS(previousSnapshot.financeBS);
    }
  }, [history, future, mode, plData, bsData, segmentPL, segmentBS, setFinancePL, setFinanceBS]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;

    // 現在の状態をhistoryに
    const currentSnapshot: SnapshotState = {
      financePL: plData.map((r) => ({ ...r })),
      financeBS: bsData.map((r) => ({ ...r })),
      ...(mode === 'segment' && { segmentPL, segmentBS }),
    };
    setHistory((prev) => [...prev, currentSnapshot]);

    // 次の状態に復元
    const newFuture = [...future];
    const nextSnapshot = newFuture.pop()!;
    setFuture(newFuture);

    // store に反映
    if (mode === 'company') {
      if (nextSnapshot.financePL.length > 0) setFinancePL(nextSnapshot.financePL);
      if (nextSnapshot.financeBS.length > 0) setFinanceBS(nextSnapshot.financeBS);
    }
  }, [history, future, mode, plData, bsData, segmentPL, segmentBS, setFinancePL, setFinanceBS]);

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

  // ★ Ctrl+C で TSV コピー（years の定義後に配置）
  const handleCopySelection = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'c') return;
      if (!selection) return;

      e.preventDefault();

      const FIELDS = selection.table === 'pl' ? PL_FIELDS : BS_FIELDS;
      const startR = Math.min(selection.start.r, selection.end.r);
      const endR = Math.max(selection.start.r, selection.end.r);
      const startC = Math.min(selection.start.c, selection.end.c);
      const endC = Math.max(selection.start.c, selection.end.c);

      const currentData = selection.table === 'pl' ? plData : bsData;
      const dataMap = new Map<number, any>();
      currentData.forEach((row) => dataMap.set(row.year, row));

      // TSV 生成
      const rows: string[] = [];
      for (let r = startR; r <= endR; r++) {
        const field = FIELDS[r];
        if (!field) continue;
        const cols: string[] = [];
        for (let c = startC; c <= endC; c++) {
          const year = years[c];
          if (!year) {
            cols.push('');
            continue;
          }
          const row = dataMap.get(year);
          const val = row?.[field.key];
          cols.push(val !== undefined && val !== null ? String(val) : '');
        }
        rows.push(cols.join('\t'));
      }

      const tsv = rows.join('\n');

      // クリップボードにコピー
      try {
        await navigator.clipboard.writeText(tsv);
        console.log('[handleCopySelection] Copied to clipboard:', { size: tsv.length });
      } catch (err) {
        console.error('[handleCopySelection] Copy failed:', err);
      }
    },
    [selection, plData, bsData, years]
  );



  // ★ Excelモード: 選択状態でのキーボード操作（Enter=編集開始、矢印移動、Delete=クリア）
  const handleKeyDownContainer = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, tableType: 'pl' | 'bs') => {
      // まず Ctrl/Cmd+C を処理（範囲コピー）
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        // handleCopySelection 内で preventDefault 済み
        // @ts-ignore
        return handleCopySelection(e);
      }

      // 編集中は input 側に任せる
      if (editingCell && editingCell.table === tableType) return;

      // 対象テーブルの選択セルがない場合は何もしない
      if (!activeCell || activeCell.table !== tableType) return;

      const FIELDS = tableType === 'pl' ? PL_FIELDS : BS_FIELDS;
      const maxR = FIELDS.length - 1;
      const maxC = years.length - 1;

      const setSingleSelection = (next: CellPos) => {
        setActiveCell(next);
        setSelection({ table: tableType, start: next, end: next });

        const fieldKey = FIELDS[next.r]?.key;
        const year = years[next.c];
        if (fieldKey && year) setFocusedCell({ table: tableType, fieldKey, year });
      };

      const move = (dr: number, dc: number) => {
        const nr = Math.max(0, Math.min(maxR, activeCell.r + dr));
        const nc = Math.max(0, Math.min(maxC, activeCell.c + dc));
        setSingleSelection({ table: tableType, r: nr, c: nc });
      };

      // Enter / F2: 編集開始
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        const fieldKey = FIELDS[activeCell.r]?.key;
        const year = years[activeCell.c];
        if (!fieldKey || !year) return;
        setFocusedCell({ table: tableType, fieldKey, year });
        setEditingCell(activeCell);
        return;
      }

      // 矢印移動（選択のみ）
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1, 0);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1, 0);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move(0, -1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        move(0, 1);
        return;
      }

      // Delete / Backspace: 選択範囲をクリア
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection || selection.table !== tableType) return;
        e.preventDefault();

        const startR = Math.min(selection.start.r, selection.end.r);
        const endR = Math.max(selection.start.r, selection.end.r);
        const startC = Math.min(selection.start.c, selection.end.c);
        const endC = Math.max(selection.start.c, selection.end.c);

        const currentData = tableType === 'pl' ? plData : bsData;
        const working = new Map<number, any>();
        currentData.forEach((row) => working.set(row.year, { ...row }));

        for (let r = startR; r <= endR; r++) {
          const field = FIELDS[r];
          if (!field) continue;
          for (let c = startC; c <= endC; c++) {
            const year = years[c];
            if (!year) continue;
            const row = working.get(year) ?? { year };
            const nextRow: any = { ...row };
            delete nextRow[field.key];
            working.set(year, nextRow);
          }
        }

        const newData = Array.from(working.values()).sort((a, b) => a.year - b.year);
        if (tableType === 'pl') handleSetPL(newData);
        else handleSetBS(newData);

        saveSnapshot();
        return;
      }
    },
    [
      handleCopySelection,
      editingCell,
      activeCell,
      selection,
      years,
      plData,
      bsData,
      handleSetPL,
      handleSetBS,
      saveSnapshot,
      setFocusedCell,
      setEditingCell,
      setActiveCell,
      setSelection,
    ]
  );
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


  // ★ Ctrl+Z / Ctrl+Shift+Z ショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

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

          // 空セルは「クリア」として扱う（Excel貼付けの挙動に合わせる）
          const isBlank = cellValue === undefined || cellValue === null || String(cellValue).trim() === '';
          const num = isBlank ? undefined : sanitizeNumber(cellValue);

          // Map に書き込む（num===undefined の場合は該当フィールドを削除）
          const existingRow = working.get(targetYear) ?? { year: targetYear };
          const updatedRow: any = { ...existingRow };
          if (num === undefined) {
            delete updatedRow[targetField.key];
          } else {
            updatedRow[targetField.key] = num;
          }
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
        // ★ Paste 後に Undo/Redo スナップショット保存
        saveSnapshot();
      }
    },
    [focusedCell, years, plData, bsData, handleSetPL, handleSetBS, saveSnapshot]
  );

  const title = mode === 'company' ? '全社' : segmentName ? `${segmentName}` : '事業部';
  const description = mode === 'company'
    ? 'PL/BSを入力すると、企業価値指標（ROIC等）が自動計算されます。'
    : 'PL/BSを入力すると、セグメント別の分析が可能になります。';

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">財務データ入力（{title}）</h2>
        <p className="text-sm text-zinc-600">{description}</p>
      </div>

      {/* 初期化メッセージ */}
      {plData.length === 0 && bsData.length === 0 && (
        <div className="bg-sky-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
          📋 初期表示として直近3年が表示されます。データ入力を開始するには、「年度追加」ボタンをクリックして年度を設定してください。
        </div>
      )}

      {/* Undo/Redo ボタン */}
      <div className="flex gap-2">
        <button
          onClick={handleUndo}
          disabled={history.length === 0}
          className="text-sm px-3 py-2 bg-gray-200 text-zinc-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          title="戻る (Ctrl+Z)"
        >
          ↶ 戻る
        </button>
        <button
          onClick={handleRedo}
          disabled={future.length === 0}
          className="text-sm px-3 py-2 bg-gray-200 text-zinc-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          title="やり直す (Ctrl+Shift+Z)"
        >
          ↷ やり直す
        </button>
      </div>

      {/* PL */}
      <div
        className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm"
        onPasteCapture={(e) => handlePasteFromContainer(e, 'pl')}
        onKeyDown={(e) => handleKeyDownContainer(e, 'pl')}
        tabIndex={0}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold">{title} PL（損益計算書）</h3>
          <button
            type="button"
            className="text-xs text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-2"
            title="貼り付け: セルを選択して Ctrl+V / 編集: Enter または ダブルクリック / 取消: Ctrl+Z"
          >
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-100">?</span>
            <span className="hidden sm:inline">操作ヒント</span>
          </button>
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
          activeCell={activeCell}
          setActiveCell={setActiveCell}
          editingCell={editingCell}
          setEditingCell={setEditingCell}
          selection={selection}
          setSelection={setSelection}
          isDraggingRef={isDraggingRef}
          anchorRef={anchorRef}
          onMouseDownCell={onMouseDownCell}
          onMouseEnterCell={onMouseEnterCell}
          onMouseUpCell={onMouseUpCell}
          onSaveSnapshot={saveSnapshot}
        />
      </div>

      {/* BS */}
      <div
        className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm"
        onPasteCapture={(e) => handlePasteFromContainer(e, 'bs')}
        onKeyDown={(e) => handleKeyDownContainer(e, 'bs')}
        tabIndex={0}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold">{title} BS（貸借対照表）</h3>
          <button
            type="button"
            className="text-xs text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-2"
            title="貼り付け: セルを選択して Ctrl+V / 編集: Enter または ダブルクリック / 取消: Ctrl+Z"
          >
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-100">?</span>
            <span className="hidden sm:inline">操作ヒント</span>
          </button>
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
          activeCell={activeCell}
          setActiveCell={setActiveCell}
          editingCell={editingCell}
          setEditingCell={setEditingCell}
          selection={selection}
          setSelection={setSelection}
          isDraggingRef={isDraggingRef}
          anchorRef={anchorRef}
          onMouseDownCell={onMouseDownCell}
          onMouseEnterCell={onMouseEnterCell}
          onMouseUpCell={onMouseUpCell}
          onSaveSnapshot={saveSnapshot}
        />
      </div>
    </section>
  );
}

export default FinanceYearEditorTable;
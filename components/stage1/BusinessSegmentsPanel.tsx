// /components/stage1/BusinessSegmentsPanel.tsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import type { BusinessSegment, StrategicUnitType } from '@/types/strategy';

/* ===============================
 * 安定した空参照（selector で ?? [] を使わないため）
 * =============================== */

const EMPTY_SEGMENTS: BusinessSegment[] = Object.freeze([]) as unknown as BusinessSegment[];

const MAX_SEGMENTS = 10;

function generateId(): string {
  return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * keyCustomers を正規化：カンマ区切り → 配列 → trim → 空要素除去 → 最大3件
 */
function normalizeKeyCustomers(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** カンマ区切り入力 → 配列（件数制限なし。主要製品・課題・既存KPI用） */
function parseCommaList(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 数値入力 → number | undefined（空欄・不正値は undefined で未設定に戻す） */
function parseNumberOrUndefined(input: string): number | undefined {
  if (input.trim() === '') return undefined;
  const n = Number(input);
  return Number.isFinite(n) ? n : undefined;
}

/** 種別（StrategicUnitType）の選択肢 */
const UNIT_TYPE_OPTIONS: { value: StrategicUnitType; label: string }[] = [
  { value: 'business_unit', label: '事業部' },
  { value: 'function', label: '機能部門' },
  { value: 'site', label: '拠点' },
  { value: 'project', label: '重点プロジェクト' },
  { value: 'subsidiary', label: '子会社' },
  { value: 'segment', label: '事業セグメント' },
  { value: 'other', label: 'その他' },
];

export default function BusinessSegmentsPanel({ readOnly, disabled }: { readOnly?: boolean; disabled?: boolean }) {
  // 安定した参照を使用（毎回新しい [] を作らない）
  const businessSegments = useStrategyStore((s: StrategyState) => s.businessSegments ?? EMPTY_SEGMENTS);
  const setProfile = useStrategyStore((s: StrategyState) => s.setProfile);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleAdd = useCallback(() => {
    if (disabled || businessSegments.length >= MAX_SEGMENTS) return;
    const newSegment: BusinessSegment = {
      id: generateId(),
      name: '',
    };
    setProfile({ businessSegments: [...businessSegments, newSegment] });
    setEditingId(newSegment.id);
    setEditName('');
  }, [businessSegments, setProfile, disabled]);

  const handleDelete = useCallback(
    (id: string) => {
      if (disabled) return;
      const next = businessSegments.filter((seg) => seg.id !== id);
      setProfile({ businessSegments: next });
      if (editingId === id) {
        setEditingId(null);
        setEditName('');
      }
    },
    [businessSegments, setProfile, editingId, disabled]
  );

  const handleStartEdit = useCallback((seg: BusinessSegment) => {
    if (disabled) return;
    setEditingId(seg.id);
    setEditName(seg.name);
  }, [disabled]);

  const handleSaveEdit = useCallback(
    (id: string) => {
      if (disabled) return;
      const next = businessSegments.map((seg) =>
        seg.id === id ? { ...seg, name: editName.trim() } : seg
      );
      setProfile({ businessSegments: next });
      setEditingId(null);
      setEditName('');
    },
    [businessSegments, editName, setProfile, disabled]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      // Mac/Windows の日本語IME入力中は送信しない
      if (e.nativeEvent.isComposing) return;
      if ((e.nativeEvent as any).keyCode === 229) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveEdit(id);
      } else if (e.key === 'Escape') {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit]
  );

  /**
   * segment の特定フィールドを更新（updateSegment(id, { summary: "...", keyCustomers: [...] })）
   */
  const updateSegment = useCallback(
    (id: string, patch: Partial<BusinessSegment>) => {
      if (disabled) return;
      const next = businessSegments.map((seg) =>
        seg.id === id ? { ...seg, ...patch } : seg
      );
      setProfile({ businessSegments: next });
    },
    [businessSegments, setProfile, disabled]
  );

  /**
   * keyCustomers を string 配列として取得（nullなら []）
   */
  const getKeyCustomers = useCallback((seg: BusinessSegment): string[] => {
    const kc = seg.keyCustomers;
    if (!kc) return [];
    if (!Array.isArray(kc)) return [];
    return kc.map((s) => String(s)).filter(Boolean);
  }, []);

  const emptyNameWarnings = useMemo(() => {
    return businessSegments.filter((seg) => !seg.name.trim()).map((seg) => seg.id);
  }, [businessSegments]);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">事業セグメント定義</h2>

      <p className="text-sm text-gray-600 mb-6">
        分析対象とする事業セグメントを定義します。事業部別の財務データを入力する場合に使用します。
      </p>

      {businessSegments.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center">
          <p className="text-gray-500 text-sm mb-4">
            事業セグメントが未定義です。
            <br />
            事業部別分析を行う場合は、セグメントを追加してください。
          </p>
          <button
            onClick={handleAdd}
            disabled={disabled}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            + セグメントを追加
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {businessSegments.map((seg, idx) => {
            const isEditing = editingId === seg.id;
            const hasWarning = emptyNameWarnings.includes(seg.id);
            const currentKeyCustomers = getKeyCustomers(seg);
            const keyCustomersText = currentKeyCustomers.join(', ');

            return (
              <div
                key={seg.id}
                className={`bg-white border rounded-lg ${
                  hasWarning ? 'border-amber-400' : 'border-gray-200'
                } p-4`}
              >
                {/* 上行：番号＋セグメント名＋削除ボタン */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-gray-400 text-sm font-medium w-6">
                    {idx + 1}.
                  </span>

                  {isEditing ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, seg.id)}
                      onBlur={() => handleSaveEdit(seg.id)}
                      disabled={disabled}
                      autoFocus
                      className="flex-1 border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                      placeholder="セグメント名（例：製造事業）"
                    />
                  ) : (
                    <div
                      className={`flex-1 ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-gray-50'} px-2 py-1 rounded`}
                      onClick={() => handleStartEdit(seg)}
                    >
                      {seg.name ? (
                        <span className="text-sm font-medium">{seg.name}</span>
                      ) : (
                        <span className="text-sm text-gray-400 italic">
                          クリックして名前を入力...
                        </span>
                      )}
                    </div>
                  )}

                  {hasWarning && !isEditing && (
                    <span className="text-amber-500 text-xs">名前が未入力</span>
                  )}

                  <button
                    onClick={() => handleDelete(seg.id)}
                    disabled={disabled}
                    className="text-gray-400 hover:text-red-500 transition p-1 disabled:cursor-not-allowed disabled:opacity-50"
                    title="削除"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* 中行：事業概要（summary） */}
                <div className="mb-3 ml-9">
                  <label className="block text-xs text-gray-600 mb-1">事業概要</label>
                  <input
                    type="text"
                    value={seg.summary || ''}
                    onChange={(e) => updateSegment(seg.id, { summary: e.target.value })}
                    disabled={disabled}
                    className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    placeholder="例：中堅製造業向けに設備保全の予兆検知をSaaSで提供"
                  />
                </div>

                {/* 下行：主要顧客（keyCustomers） */}
                <div className="ml-9">
                  <label className="block text-xs text-gray-600 mb-1">
                    主要顧客（カンマ区切り、最大3件）
                  </label>
                  <input
                    type="text"
                    value={keyCustomersText}
                    onChange={(e) => {
                      const normalized = normalizeKeyCustomers(e.target.value);
                      updateSegment(seg.id, { keyCustomers: normalized });
                    }}
                    disabled={disabled}
                    className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    placeholder="例：中堅製造業, 自治体, 個人ユーザー"
                  />
                  {/* Chip表示 */}
                  {currentKeyCustomers.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {currentKeyCustomers.map((customer, cidx) => (
                        <div
                          key={cidx}
                          className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs flex items-center gap-1"
                        >
                          {customer}
                          <button
                            onClick={() => {
                              const next = currentKeyCustomers.filter((_, i) => i !== cidx);
                              updateSegment(seg.id, { keyCustomers: next });
                            }}
                            disabled={disabled}
                            className="hover:text-blue-900 ml-1 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ★事業・部門情報（中計用・任意）：STAGE3「事業・部門別戦略」の前提情報 */}
                <details className="ml-9 mt-3 border-t border-gray-100 pt-3">
                  <summary className="text-xs text-gray-600 cursor-pointer select-none hover:text-blue-600">
                    事業・部門情報（中計用・任意）
                  </summary>

                  <div className="mt-3 space-y-3">
                    {/* 種別 */}
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">種別</label>
                      <select
                        value={seg.unitType ?? ''}
                        onChange={(e) =>
                          updateSegment(seg.id, {
                            unitType: e.target.value
                              ? (e.target.value as StrategicUnitType)
                              : undefined,
                          })
                        }
                        disabled={disabled}
                        className="border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                      >
                        <option value="">未選択</option>
                        {UNIT_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 主要製品・サービス */}
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        主要製品・サービス（カンマ区切り）
                      </label>
                      <input
                        type="text"
                        value={(seg.mainProductsServices ?? []).join(', ')}
                        onChange={(e) =>
                          updateSegment(seg.id, {
                            mainProductsServices: parseCommaList(e.target.value),
                          })
                        }
                        disabled={disabled}
                        className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="例：予兆検知SaaS, 保守サービス"
                      />
                    </div>

                    {/* 売上・利益 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">売上（百万円）</label>
                        <input
                          type="number"
                          value={seg.revenue ?? ''}
                          onChange={(e) =>
                            updateSegment(seg.id, { revenue: parseNumberOrUndefined(e.target.value) })
                          }
                          disabled={disabled}
                          className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                          placeholder="例：1200"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">利益（百万円）</label>
                        <input
                          type="number"
                          value={seg.profit ?? ''}
                          onChange={(e) =>
                            updateSegment(seg.id, { profit: parseNumberOrUndefined(e.target.value) })
                          }
                          disabled={disabled}
                          className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                          placeholder="例：150"
                        />
                      </div>
                    </div>

                    {/* 主な課題 */}
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        主な課題（カンマ区切り）
                      </label>
                      <input
                        type="text"
                        value={(seg.currentIssues ?? []).join(', ')}
                        onChange={(e) =>
                          updateSegment(seg.id, { currentIssues: parseCommaList(e.target.value) })
                        }
                        disabled={disabled}
                        className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="例：既存顧客の更新率低下, 人材不足"
                      />
                    </div>

                    {/* 中計で期待される役割 */}
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">中計で期待される役割</label>
                      <textarea
                        value={seg.expectedRoleInMidtermPlan ?? ''}
                        onChange={(e) =>
                          updateSegment(seg.id, {
                            expectedRoleInMidtermPlan: e.target.value || undefined,
                          })
                        }
                        disabled={disabled}
                        rows={2}
                        className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="例：成長ドライバーとして売上構成比を30%まで引き上げる"
                      />
                    </div>

                    {/* 既存KPI */}
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        既存KPI（カンマ区切り）
                      </label>
                      <input
                        type="text"
                        value={(seg.existingKpis ?? []).join(', ')}
                        onChange={(e) =>
                          updateSegment(seg.id, { existingKpis: parseCommaList(e.target.value) })
                        }
                        disabled={disabled}
                        className="w-full border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="例：ARR, 解約率, 受注件数"
                      />
                    </div>
                  </div>
                </details>
              </div>
            );
          })}

          {businessSegments.length < MAX_SEGMENTS && (
            <button
              onClick={handleAdd}
              disabled={disabled}
              className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-sm hover:border-blue-400 hover:text-blue-600 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              + セグメントを追加
            </button>
          )}

          {businessSegments.length >= MAX_SEGMENTS && (
            <p className="text-xs text-gray-400 text-center">
              最大{MAX_SEGMENTS}件まで登録できます
            </p>
          )}
        </div>
      )}

      {businessSegments.length > 0 && emptyNameWarnings.length > 0 && (
        <p className="mt-3 text-xs text-amber-600">
          名前が未入力のセグメントがあります。事業部別分析を行う場合は、すべてのセグメントに名前を入力してください。
        </p>
      )}
    </section>
  );
}

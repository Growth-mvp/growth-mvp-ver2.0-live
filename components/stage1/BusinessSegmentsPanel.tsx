// /components/stage1/BusinessSegmentsPanel.tsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type { BusinessSegment } from '@/types/strategy';

/* ===============================
 * 安定した空参照（selector で ?? [] を使わないため）
 * =============================== */

const EMPTY_SEGMENTS: BusinessSegment[] = Object.freeze([]) as unknown as BusinessSegment[];

const MAX_SEGMENTS = 10;

function generateId(): string {
  return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function BusinessSegmentsPanel() {
  // 安定した参照を使用（毎回新しい [] を作らない）
  const businessSegments = useStrategyStore((s) => s.businessSegments ?? EMPTY_SEGMENTS);
  const setProfile = useStrategyStore((s) => s.setProfile);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleAdd = useCallback(() => {
    if (businessSegments.length >= MAX_SEGMENTS) return;
    const newSegment: BusinessSegment = {
      id: generateId(),
      name: '',
    };
    setProfile({ businessSegments: [...businessSegments, newSegment] });
    setEditingId(newSegment.id);
    setEditName('');
  }, [businessSegments, setProfile]);

  const handleDelete = useCallback(
    (id: string) => {
      const next = businessSegments.filter((seg) => seg.id !== id);
      setProfile({ businessSegments: next });
      if (editingId === id) {
        setEditingId(null);
        setEditName('');
      }
    },
    [businessSegments, setProfile, editingId]
  );

  const handleStartEdit = useCallback((seg: BusinessSegment) => {
    setEditingId(seg.id);
    setEditName(seg.name);
  }, []);

  const handleSaveEdit = useCallback(
    (id: string) => {
      const next = businessSegments.map((seg) =>
        seg.id === id ? { ...seg, name: editName.trim() } : seg
      );
      setProfile({ businessSegments: next });
      setEditingId(null);
      setEditName('');
    },
    [businessSegments, editName, setProfile]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveEdit(id);
      } else if (e.key === 'Escape') {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit]
  );

  const emptyNameWarnings = useMemo(() => {
    return businessSegments.filter((seg) => !seg.name.trim()).map((seg) => seg.id);
  }, [businessSegments]);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">② 事業セグメント定義</h2>

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
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition"
          >
            + セグメントを追加
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {businessSegments.map((seg, idx) => {
            const isEditing = editingId === seg.id;
            const hasWarning = emptyNameWarnings.includes(seg.id);

            return (
              <div
                key={seg.id}
                className={`flex items-center gap-3 p-3 bg-white border rounded-lg ${
                  hasWarning ? 'border-amber-400' : 'border-gray-200'
                }`}
              >
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
                    autoFocus
                    className="flex-1 border px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="セグメント名（例：製造事業）"
                  />
                ) : (
                  <div
                    className="flex-1 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
                    onClick={() => handleStartEdit(seg)}
                  >
                    {seg.name ? (
                      <span className="text-sm">{seg.name}</span>
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
                  className="text-gray-400 hover:text-red-500 transition p-1"
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
            );
          })}

          {businessSegments.length < MAX_SEGMENTS && (
            <button
              onClick={handleAdd}
              className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-sm hover:border-blue-400 hover:text-blue-600 transition"
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

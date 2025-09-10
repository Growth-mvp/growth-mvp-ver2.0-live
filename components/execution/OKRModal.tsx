'use client';

import React, { useState } from 'react';
import { emit } from '@/utils/actionBus';
import { saveProgressLog } from '@/utils/supabase';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';

interface OKRModalProps {
  open: boolean;
  onClose: () => void;
  okrId: string;
  objective?: string;
  keyResults?: string[];
  owner?: string;
}

export default function OKRModal({
  open,
  onClose,
  okrId,
  objective,
  keyResults,
  owner,
}: OKRModalProps) {
  const { user } = useUserStore();
  // const { strategyId } = useStrategyStore();
const s = useStrategyStore();
const strategyId = (s as any).strategyId as string | undefined;

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const onSave = async () => {
    if (!user?.id || !okrId) return;
    setSaving(true);
    try {
      // utils/supabase.ts に実装済み想定：saveProgressLog(userId, okrId, { content: string })
      const { data, error } = await saveProgressLog(user.id, okrId, {
        content: text,
      } as any);

      if (error) throw error;
      const logId = data?.id ?? '';
      // ★EventBus：進捗ログ登録→他画面を同報更新
      if (strategyId) {
        emit('okr:progress:logged', { strategyId, okrId, logId });
      }
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !saving && onClose()}
      />
      {/* modal */}
      <div className="relative z-[101] w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
        <header className="mb-3">
          <h3 className="text-lg font-bold">進捗ログの追加</h3>
          <p className="text-xs text-gray-500">
            OKR: {objective ?? '（タイトル未設定）'}
          </p>
        </header>

        {Array.isArray(keyResults) && keyResults.length > 0 && (
          <div className="mb-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <div className="mb-1 font-semibold">Key Results</div>
            <ul className="list-disc pl-5">
              {keyResults.map((kr, i) => (
                <li key={i}>{kr}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-gray-500">Owner</div>
            <div className="font-semibold">{owner ?? '未設定'}</div>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-gray-500">OKR ID</div>
            <div className="font-semibold">{okrId}</div>
          </div>
        </div>

        <textarea
          className="h-32 w-full rounded-lg border p-3 text-sm outline-none focus:ring"
          placeholder="今日の進捗・所感・課題を記入"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={onSave}
            disabled={saving || !text.trim()}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              saving || !text.trim()
                ? 'bg-gray-200 text-gray-500'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

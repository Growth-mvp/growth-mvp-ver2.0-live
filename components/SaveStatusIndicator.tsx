'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

/**
 * SaveStatusIndicator (Apple Minimal Save Status)
 *
 * Stageページヘッダー右端に統合
 * - 通常時：保存済み HH:MM (text-sm font-medium text-zinc-500 opacity-70 tracking-wide)
 * - 保存中：保存中… (opacity-90)
 * - エラー：保存エラー (text-red-600)
 *
 * No icon, no animation, no fixed positioning, no z-index changes, logic unchanged
 */
export default function SaveStatusIndicator() {
  const isSaving = useStrategyStore((s) => s.boot?.isSaving ?? false);
  const lastSavedAt = useStrategyStore((s) => s.lastSavedAt);
  const saveError = useStrategyStore((s) => s.saveError);

  const [displayTime, setDisplayTime] = useState<string>('');

  // lastSavedAt を表示用時刻に変換（なければ現在時刻を使用）
  useEffect(() => {
    const timestamp = lastSavedAt || Date.now();
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    setDisplayTime(`${hours}:${minutes}`);
  }, [lastSavedAt]);

  // エラーがある場合（赤、persistent）
  if (saveError) {
    return (
      <span className="text-red-600 text-sm font-medium whitespace-nowrap">
        保存エラー
      </span>
    );
  }

  // 保存中（opacity-90）
  if (isSaving) {
    return (
      <span className="text-zinc-500 text-sm font-medium opacity-90 whitespace-nowrap tracking-wide">
        保存中…
      </span>
    );
  }

  // 通常状態（Apple Minimal）
  return (
    <span className="text-zinc-500 text-sm font-medium opacity-70 whitespace-nowrap tracking-wide">
      保存済み {displayTime}
    </span>
  );
}

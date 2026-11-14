'use client';

import type { FinanceEffect } from '@/types/strategy';

/* 確認済みの財務効果の修正の操作（旧 /okr）。修正中の内容は保存するまで確認済みの効果に入らない。 */
export function FinanceRevisionControls({
  saved,
  revising,
  disabled,
  onStart,
  onCancel,
  onSave,
  onUnconfirm,
}: {
  saved: FinanceEffect | undefined;
  revising: boolean;
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
  onSave: () => void;
  onUnconfirm: () => void;
}) {
  const button = 'rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
  if (revising) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900">
        <span>修正中です。保存するまで、確認済みの内容のままです。</span>
        <button type="button" className={button} disabled={disabled} onClick={onSave}>
          修正内容を保存
        </button>
        <button type="button" className={button} onClick={onCancel}>
          修正をやめる
        </button>
      </div>
    );
  }
  if (saved?.confirmed !== true) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <button type="button" className={button} disabled={disabled} onClick={onStart}>
        修正する
      </button>
      <button type="button" className={button} disabled={disabled} onClick={onUnconfirm}>
        確認を解除する
      </button>
    </div>
  );
}

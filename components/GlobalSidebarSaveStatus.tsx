'use client';

import { useState } from 'react';
import { useSaveStatus } from '@/hooks/useSaveStatus';
import { useStrategyStore } from '@/store/strategyStore';

/**
 * GlobalSidebarSaveStatus
 *
 * Displays save status + manual save button in sidebar footer
 *
 * States:
 * - Error: Red dot + "保存に失敗" + help text
 * - Saving: Blue dot + spinner + "保存中…"
 * - Dirty: Orange dot + "未保存の変更あり" + help text
 * - Saved: Green dot + "保存済み" + last saved time
 *
 * Reuses judgment logic from useSaveStatus hook (no code duplication)
 */
export default function GlobalSidebarSaveStatus() {
  const { status, message, helpText, buttonDisabled } = useSaveStatus();
  const [isSavingManually, setIsSavingManually] = useState(false);

  const statusConfig = {
    error: {
      dotColor: 'bg-danger',
      textColor: 'text-danger',
      bgColor: 'bg-danger-soft',
    },
    saving: {
      dotColor: 'bg-accent',
      textColor: 'text-accent-ink',
      bgColor: 'bg-accent-soft',
    },
    dirty: {
      dotColor: 'bg-caution',
      textColor: 'text-caution',
      bgColor: 'bg-caution-soft',
    },
    saved: {
      dotColor: 'bg-success',
      textColor: 'text-zinc-800',
      bgColor: 'bg-white',
    },
  };

  const config = statusConfig[status];

  const handleSaveClick = async () => {
    setIsSavingManually(true);
    try {
      await useStrategyStore.getState().saveStrategyData({ reason: 'manual-save-button' });
    } finally {
      setIsSavingManually(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-zinc-200 px-4 py-3 space-y-2">
      {/* Status header with dot */}
      <div className={`rounded-2xl border border-zinc-200 ${config.bgColor} p-3`}>
        <div className="flex items-center gap-2 mb-1">
          <div className={`h-2 w-2 rounded-full ${config.dotColor} flex-shrink-0`} />
          <div className={`text-sm font-semibold ${config.textColor}`}>{message}</div>
        </div>

        {/* Help text */}
        {helpText && (
          <div className="text-[12px] text-zinc-600 ml-4 leading-snug">
            {helpText}
          </div>
        )}
      </div>

      {/* Save button */}
      <button
        onClick={handleSaveClick}
        disabled={buttonDisabled || isSavingManually}
        className={[
          'w-full h-10 rounded-xl px-3 text-[14px] font-medium transition-colors',
          'flex items-center justify-center gap-2',
          buttonDisabled || isSavingManually
            ? 'bg-zinc-100 text-zinc-500 cursor-not-allowed'
            : 'border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100',
        ].join(' ')}
        title={
          buttonDisabled
            ? '保存中です…'
            : status === 'saved'
              ? 'いつでも手動保存できます'
              : '今すぐ保存します'
        }
      >
        {isSavingManually && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        <span>全体保存</span>
      </button>
    </div>
  );
}

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
      dotColor: 'bg-red-600',
      textColor: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    saving: {
      dotColor: 'bg-blue-600',
      textColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    dirty: {
      dotColor: 'bg-orange-600',
      textColor: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    saved: {
      dotColor: 'bg-green-600',
      textColor: 'text-zinc-700',
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
    <div className="shrink-0 border-t border-gray-200 px-4 py-3 space-y-2">
      {/* Status header with dot */}
      <div className={`rounded-lg ${config.bgColor} p-3`}>
        <div className="flex items-center gap-2 mb-1">
          <div className={`h-2 w-2 rounded-full ${config.dotColor} flex-shrink-0`} />
          <div className={`text-sm font-semibold ${config.textColor}`}>{message}</div>
        </div>

        {/* Help text */}
        {helpText && (
          <div className="text-xs text-gray-600 ml-4 leading-snug">
            {helpText}
          </div>
        )}
      </div>

      {/* Save button */}
      <button
        onClick={handleSaveClick}
        disabled={buttonDisabled || isSavingManually}
        className={[
          'w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          'flex items-center justify-center gap-2',
          buttonDisabled || isSavingManually
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : status === 'saved'
              ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100',
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

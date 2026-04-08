'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';

export type SaveStatusType = 'error' | 'saving' | 'dirty' | 'saved';

export interface SaveStatusInfo {
  status: SaveStatusType;
  message: string;
  helpText?: string;
  displayTime?: string;
  buttonDisabled?: boolean;
}

/**
 * useSaveStatus Hook
 *
 * Shared judgment logic for save status across all components
 * Avoids code duplication between SaveStatusIndicator and GlobalSidebarSaveStatus
 *
 * Returns:
 * - status: 'error' | 'saving' | 'dirty' | 'saved'
 * - message: Display text (e.g., "保存エラー", "保存中…", "未保存の変更あり", "保存済み HH:MM")
 * - helpText?: Additional explanation
 * - displayTime?: Formatted time (HH:MM) if saved
 * - buttonDisabled?: Whether save button should be disabled
 */
export function useSaveStatus(): SaveStatusInfo {
  const isSaving = useStrategyStore((s: StrategyState) => s.boot?.isSaving ?? false);
  const lastSavedAt = useStrategyStore((s: StrategyState) => s.lastSavedAt);
  const saveError = useStrategyStore((s: StrategyState) => s.saveError);
  const dirty = useStrategyStore((s: StrategyState) => s.dirty ?? false);

  const [displayTime, setDisplayTime] = useState<string>('');

  // lastSavedAt を表示用時刻に変換（なければ現在時刻を使用）
  useEffect(() => {
    const timestamp = lastSavedAt || Date.now();
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    setDisplayTime(`${hours}:${minutes}`);
  }, [lastSavedAt]);

  // Priority: error > saving > dirty > saved
  if (saveError) {
    return {
      status: 'error',
      message: '保存に失敗',
      helpText: '再試行してください',
      buttonDisabled: false,
    };
  }

  if (isSaving) {
    return {
      status: 'saving',
      message: '保存中…',
      buttonDisabled: true,
    };
  }

  if (dirty) {
    return {
      status: 'dirty',
      message: '未保存の変更あり',
      helpText: 'このまま保存されない場合は、画面を更新したり移動したりしないでください',
      buttonDisabled: false,
    };
  }

  return {
    status: 'saved',
    message: '保存済み',
    helpText: `最終保存 ${displayTime}`,
    displayTime,
    buttonDisabled: false,
  };
}

/**
 * /components/export/StagePdfExportButton.tsx
 *
 * 目的：
 * - STAGE1～4 PDF出力ボタンの統一コンポーネント
 * - 見た目・ラベル・動作を統一
 */

'use client';

import React, { useState } from 'react';

interface StagePdfExportButtonProps {
  /**
   * PDF出力関数（useStageXPdfExport で提供される exportToPdf）
   */
  exportToPdf: () => Promise<void>;

  /**
   * ボタンを無効化するか（デフォルト: false）
   */
  disabled?: boolean;

  /**
   * クラス名を追加する（カスタマイズ用）
   */
  className?: string;
  /** ボタンの表示名（既定: PDF出力） */
  label?: string;
}

export function StagePdfExportButton({
  exportToPdf,
  disabled = false,
  className = '',
  label = 'PDF出力',
}: StagePdfExportButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (isLoading || disabled) return;

    setIsLoading(true);
    try {
      await exportToPdf();
    } catch (error) {
      console.error('[StagePdfExportButton] PDF export failed:', error);
      // ユーザーへのエラー通知は画面のtoastなどで行われると想定
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading || disabled}
      className={`
        inline-flex items-center gap-2
        h-10 px-4
        border border-zinc-300 bg-white hover:bg-zinc-100
        text-zinc-900
        rounded-xl
        text-[14px] font-medium
        transition-colors duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
      title="STAGE内容をPDF形式で出力します"
    >
      {/* ダウンロードアイコン */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>

      {/* ラベル */}
      <span>{isLoading ? '出力中...' : label}</span>
    </button>
  );
}

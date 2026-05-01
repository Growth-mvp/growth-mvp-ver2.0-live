/**
 * /components/export/StagePdfExportButton.tsx
 *
 * 目的：
 * - STAGE画面で使用するPDFエクスポートボタン
 * - 動的レンダリング対応（SSR回避）
 */

'use client';

import React, { useState, useCallback } from 'react';
import { Download } from 'lucide-react';

interface StagePdfExportButtonProps {
  stageNumber: 1 | 2 | 3 | 4 | 5 | 6;
  reportType: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost';
  onExport?: () => Promise<void>;
}

/**
 * STAGE PDF エクスポートボタン
 *
 * 使用例：
 * ```tsx
 * <StagePdfExportButton
 *   stageNumber={3}
 *   reportType="部門戦略レポート"
 *   label="PDF保存"
 *   onExport={async () => {
 *     // PDFダウンロード処理
 *   }}
 * />
 * ```
 */
export function StagePdfExportButton({
  stageNumber,
  reportType,
  label = 'PDF保存',
  size = 'md',
  variant = 'primary',
  onExport,
}: StagePdfExportButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (onExport) {
        await onExport();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラーが発生しました';
      setError(message);
      console.error('[StagePdfExportButton] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [onExport]);

  const sizeClasses = {
    sm: 'px-3 py-1 text-sm gap-1',
    md: 'px-4 py-2 text-base gap-2',
    lg: 'px-6 py-3 text-lg gap-2',
  };

  const variantClasses = {
    primary:
      'bg-black text-white hover:bg-gray-800 disabled:bg-gray-400',
    secondary:
      'bg-gray-100 text-black hover:bg-gray-200 disabled:bg-gray-300',
    ghost:
      'bg-transparent text-gray-700 hover:bg-gray-100 disabled:opacity-50',
  };

  const iconSize = size === 'sm' ? 16 : size === 'md' ? 20 : 24;

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={isLoading}
        className={`
          ${sizeClasses[size]}
          ${variantClasses[variant]}
          inline-flex items-center rounded-lg font-medium
          transition-colors duration-200
          cursor-pointer
          ${isLoading ? 'opacity-60 cursor-wait' : ''}
        `}
        title={label}
      >
        <Download size={iconSize} />
        {isLoading ? '生成中...' : label}
      </button>

      {error && (
        <p
          style={{
            marginTop: '0.5rem',
            fontSize: '0.875rem',
            color: '#dc2626',
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

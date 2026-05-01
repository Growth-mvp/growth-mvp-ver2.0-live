/**
 * /components/export/ExportPdfButton.tsx
 *
 * 目的：
 * - レポート出力ボタン（print 実行）
 * - 既存画面に配置するだけで使用可
 * - 既存機能に影響しない
 */

'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';

interface ExportPdfButtonProps {
  /**
   * ボタンラベル（デフォルト: "PDF保存"）
   */
  label?: string;

  /**
   * ボタンのクラス名（カスタムスタイル用）
   */
  className?: string;

  /**
   * ボタンサイズ：'sm' | 'md' | 'lg'
   */
  size?: 'sm' | 'md' | 'lg';

  /**
   * ボタンの外観：'primary' | 'secondary' | 'ghost'
   */
  variant?: 'primary' | 'secondary' | 'ghost';

  /**
   * ボタンクリック時のコールバック（オプション）
   */
  onBeforePrint?: () => void;
  onAfterPrint?: () => void;
}

/**
 * 戦略レポートをPDF（印刷）出力するボタン
 *
 * 使用例：
 * ```tsx
 * <ExportPdfButton label="レポートを保存" size="md" variant="primary" />
 * ```
 */
export function ExportPdfButton({
  label = 'PDF保存',
  className = '',
  size = 'md',
  variant = 'primary',
  onBeforePrint,
  onAfterPrint,
}: ExportPdfButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handlePrint = () => {
    setIsLoading(true);

    // ユーザー定義のコールバック
    onBeforePrint?.();

    // 次のフレームで print ダイアログを開く
    // （DOM の準備ができていることを確保）
    setTimeout(() => {
      window.print();

      // print ダイアログが閉じられるのは検知困難なため、
      // short timeout 後に loading を解除
      setTimeout(() => {
        setIsLoading(false);
        onAfterPrint?.();
      }, 500);
    }, 100);
  };

  // サイズ別のクラス
  const sizeClasses = {
    sm: 'px-3 py-1 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  // variant 別のクラス
  const variantClasses = {
    primary:
      'bg-black text-white hover:bg-gray-800 disabled:bg-gray-400',
    secondary:
      'bg-gray-100 text-black hover:bg-gray-200 disabled:bg-gray-300',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 disabled:opacity-50',
  };

  return (
    <button
      onClick={handlePrint}
      disabled={isLoading}
      className={`
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        inline-flex items-center gap-2 rounded-lg font-medium
        transition-colors duration-200
        cursor-pointer no-print
        ${className}
      `}
      title={label}
    >
      <Download size={size === 'sm' ? 16 : size === 'md' ? 20 : 24} />
      {!isLoading ? label : '準備中...'}
    </button>
  );
}

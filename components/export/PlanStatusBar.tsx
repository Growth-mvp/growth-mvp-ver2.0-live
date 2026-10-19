'use client';

import React, { useState } from 'react';

import type { PlanDocument } from '@/lib/plans/planDocumentState';

/**
 * 経営計画書の保存状態と操作（生成・再生成・未保存時のコピー／ダウンロード）
 */

export interface PlanStatusBarProps {
  doc: PlanDocument | null;
  isRestoring: boolean;
  isGenerating: boolean;
  error: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onCopy: () => Promise<boolean>;
  onDownload: () => void;
  accentClassName?: string;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '不明' : date.toLocaleString('ja-JP');
}

export default function PlanStatusBar({
  doc,
  isRestoring,
  isGenerating,
  error,
  canGenerate,
  onGenerate,
  onCopy,
  onDownload,
  accentClassName = 'bg-blue-600 hover:bg-blue-700',
}: PlanStatusBarProps) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const handleCopy = async () => {
    const ok = await onCopy();
    setCopyMessage(ok ? 'コピーしました' : 'コピーできませんでした');
  };

  const generateLabel = isGenerating
    ? '生成中...'
    : doc
      ? 'AIで再生成'
      : 'AI本文を生成';

  return (
    <div className="space-y-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-5 py-4">
        <div className="text-sm text-gray-700">
          {isRestoring && <span>保存済みの計画書を確認中...</span>}
          {!isRestoring && doc && doc.saveStatus === 'saved' && (
            <span>
              保存済み ／ 生成日時: <span className="font-semibold">{formatDateTime(doc.generatedAt)}</span>
            </span>
          )}
          {!isRestoring && doc && doc.saveStatus === 'unsaved' && (
            <span className="font-semibold text-amber-700">
              未保存 ／ 生成日時: {formatDateTime(doc.generatedAt)}
            </span>
          )}
          {!isRestoring && !doc && (
            <span>
              {canGenerate
                ? '計画書はまだ生成されていません。'
                : '計画書はまだ作成されていません。管理者またはマネージャーに生成を依頼してください。'}
            </span>
          )}
        </div>

        {canGenerate && !isRestoring && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className={`${accentClassName} disabled:bg-gray-400 text-white px-4 py-2 rounded font-semibold`}
          >
            {generateLabel}
          </button>
        )}
      </div>

      {doc && doc.saveStatus === 'unsaved' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-semibold">
            この本文は保存されていません（{doc.saveReason === 'conflict' ? '別の操作で更新されたため' : '保存に失敗したため'}）。
          </p>
          <p className="mt-1">
            画面を閉じる前に、コピーまたはダウンロードで手元に残してください。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100"
            >
              本文をコピー
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="rounded border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100"
            >
              Markdownでダウンロード
            </button>
            {copyMessage && <span className="text-xs text-amber-800">{copyMessage}</span>}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';

import type { PlanDocument, PlanAudience } from '@/lib/plans/planDocumentState';

/**
 * 保存済み計画書の出力操作（Word・PDF・印刷）
 * 出力には画面で取得済みの保存済み本文のみを使い、AI生成 API は呼ばない
 */

export interface PlanExportButtonsProps {
  doc: PlanDocument | null;
  audience: PlanAudience;
  companyName?: string | null;
  accentClassName?: string;
}

type ExportKind = 'word' | 'pdf';

export default function PlanExportButtons({
  doc,
  audience,
  companyName,
  accentClassName = 'bg-blue-600 hover:bg-blue-700',
}: PlanExportButtonsProps) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportable = doc !== null && doc.saveStatus === 'saved';
  const disabled = !exportable || busy !== null;

  const runExport = async (kind: ExportKind) => {
    if (!doc || !exportable) return;
    setBusy(kind);
    setError(null);
    try {
      const { buildPlanExportDocument, planExportFileName } = await import(
        '@/lib/plans/export/planExportDocument'
      );
      const exportDoc = buildPlanExportDocument({
        audience,
        companyName,
        generatedAt: doc.generatedAt,
        markdown: doc.generatedText,
      });
      const fileName = planExportFileName(audience, doc.generatedAt, kind === 'word' ? 'docx' : 'pdf');
      if (kind === 'word') {
        const { downloadPlanWord } = await import('@/lib/plans/export/toWord');
        await downloadPlanWord(exportDoc, fileName);
      } else {
        const { downloadPlanPdf } = await import('@/lib/plans/export/downloadPlanPdf');
        await downloadPlanPdf(exportDoc, fileName);
      }
    } catch (err) {
      console.error('[PlanExport] export failed', err);
      setError(
        kind === 'word'
          ? 'Wordファイルの作成に失敗しました。もう一度お試しください。'
          : 'PDFファイルの作成に失敗しました。もう一度お試しください。'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => runExport('word')}
          disabled={disabled}
          title={exportable ? undefined : '保存済みの計画書のみ出力できます'}
          className={`${accentClassName} rounded px-4 py-2 font-semibold text-white disabled:bg-gray-400`}
        >
          {busy === 'word' ? 'Word作成中…' : 'Wordダウンロード'}
        </button>
        <button
          type="button"
          onClick={() => runExport('pdf')}
          disabled={disabled}
          title={exportable ? undefined : '保存済みの計画書のみ出力できます'}
          className={`${accentClassName} rounded px-4 py-2 font-semibold text-white disabled:bg-gray-400`}
        >
          {busy === 'pdf' ? 'PDF作成中…' : 'PDFダウンロード'}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-800 hover:bg-gray-50"
        >
          印刷
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

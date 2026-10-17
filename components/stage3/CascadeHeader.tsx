'use client';

import { StagePdfExportButton } from '@/components/export/StagePdfExportButton';

interface CascadeHeaderProps {
  exportToPdf?: () => Promise<void>;
}

export function CascadeHeader({ exportToPdf }: CascadeHeaderProps) {
  return (
    <header className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
      <div className="flex-1">
        {/* 主見出し */}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          STAGE3｜各部門の役割は何か
        </h1>

        {/* 副見出し */}
        <div className="mt-1 text-sm font-medium text-gray-700">
          事業・部門別戦略
        </div>

        {/* 説明文 */}
        <p className="mt-2 text-sm text-gray-600">
          全社戦略を、各事業・部門の役割と重点テーマに展開します。
        </p>

        {/* STAGE3固有メッセージ */}
        <div className="mt-3 text-sm font-semibold text-blue-900 bg-blue-50 border border-blue-200 rounded px-3 py-2">
          そのKPIは、会社を成長へシフトさせているか。
        </div>
      </div>

      {exportToPdf && (
        <div className="shrink-0 pt-1 sm:pt-0">
          <StagePdfExportButton exportToPdf={exportToPdf} />
        </div>
      )}
    </header>
  );
}

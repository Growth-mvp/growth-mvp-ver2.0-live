'use client';

import { StagePdfExportButton } from '@/components/export/StagePdfExportButton';

interface OKRHeaderProps {
  isHydrating: boolean;
  exportToPdf?: () => Promise<void>;
}

export function OKRHeader({ isHydrating, exportToPdf }: OKRHeaderProps) {
  return (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex-1">
        {/* 主見出し */}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          STAGE4｜現場は何をするのか
        </h1>

        {/* 副見出し */}
        <div className="mt-1 text-sm font-medium text-gray-700">
          実行計画策定
        </div>

        {/* 説明文 */}
        <p className="mt-2 text-sm text-gray-600">
          戦略とKPIを、現場が実行できる具体的な行動に変えます。
        </p>
      </div>

      <div className="shrink-0 flex flex-col items-stretch sm:items-end gap-2">
        {exportToPdf && <StagePdfExportButton exportToPdf={exportToPdf} />}
        <div className="text-right text-[11px] text-zinc-500">{isHydrating ? '読み込み中…' : '準備OK'}</div>
      </div>
    </div>
  );
}

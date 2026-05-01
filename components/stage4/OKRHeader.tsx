'use client';

import { StagePdfExportButton } from '@/components/export/StagePdfExportButton';

interface OKRHeaderProps {
  isHydrating: boolean;
  exportToPdf?: () => Promise<void>;
}

export function OKRHeader({ isHydrating, exportToPdf }: OKRHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold text-zinc-500"></div>
        <h1 className="mt-1 text-[20px] font-bold text-zinc-900">STAGE４　実行計画策定</h1>
        <div className="mt-1 text-[12px] text-zinc-600">
          左でプロジェクトを選び、各プロジェクトチーム内で「目的・成果指標・実行計画」を議論の上、入力設定します。
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-2">
        {exportToPdf && <StagePdfExportButton exportToPdf={exportToPdf} />}
        <div className="text-right text-[11px] text-zinc-500">{isHydrating ? '読み込み中…' : '準備OK'}</div>
      </div>
    </div>
  );
}

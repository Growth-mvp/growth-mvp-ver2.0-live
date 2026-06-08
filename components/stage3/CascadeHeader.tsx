'use client';

import { StagePdfExportButton } from '@/components/export/StagePdfExportButton';

interface CascadeHeaderProps {
  exportToPdf?: () => Promise<void>;
}

export function CascadeHeader({ exportToPdf }: CascadeHeaderProps) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold mb-2">STAGE 3：部門戦略策定</h1>
        <p className="text-zinc-600 text-sm">
          経営ストーリーを基に、各部門のミッション・プロジェクト案・KPI案を全体最適を図りながら、部門長・マネージャー層で議論し、明確化します。<br /> 特にKPIについては、既存業務の延長ではなく、未来の成長に向けて現場の判断と行動を変えるためのKPIを設定します。
        </p>
        
      </div>
      {exportToPdf && (
        <div className="shrink-0">
          <StagePdfExportButton exportToPdf={exportToPdf} />
        </div>
      )}
    </header>
  );
}

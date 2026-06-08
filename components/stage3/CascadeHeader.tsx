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

       <p className="text-[18px] font-bold text-zinc-900 mb-1 tracking-tight">
  そのKPIは、会社を成長へシフトさせているか。
</p>
<p className="text-sm text-zinc-500 mb-5">
  過去を管理するKPIから、未来の成長を動かすKPIへ。
</p>
<br /> 
        <p className="text-zinc-600 text-sm">
          経営ストーリーを基に、各部門のミッション・プロジェクト案・KPI案を全体最適を図りながら、部門長・マネージャー層で議論し、明確化します。<br /> 特に、現場の行動に直結するKPIについては、これまでの既存業務の延長ではなく、経営戦略と連動した未来の成長に向けたKPIを設定します。
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

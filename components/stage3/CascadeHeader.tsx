'use client';

import { StagePdfExportButton } from '@/components/export/StagePdfExportButton';

interface CascadeHeaderProps {
  exportToPdf?: () => Promise<void>;
}

export function CascadeHeader({ exportToPdf }: CascadeHeaderProps) {
  return (
    <header className="mb-8 flex items-start justify-between gap-6">
  <div className="max-w-[880px]">
    <h1 className="text-[28px] font-semibold tracking-tight text-zinc-950 mb-3">
      STAGE 3：事業・部門別戦略
    </h1>

    <div className="mb-5">
      <p className="text-[19px] font-bold tracking-tight text-zinc-950 leading-snug">
        そのKPIは、会社を成長へシフトさせているか。
      </p>
      
    </div>

    <p className="text-[14px] leading-[1.9] text-zinc-600">
      STAGE2で定めた全社戦略をもとに、各事業・部門の役割、重点テーマ、KPIを設計します。
      <br />
       単なる数値目標の割り振りではなく、「自部門は会社の成長にどう貢献するのか」を明確にし、
      <br />
      経営戦略とつながったミッション、重点プロジェクト、KPIへ具体化します。
    </p>
  </div>

  {exportToPdf && (
    <div className="shrink-0 pt-1">
      <StagePdfExportButton exportToPdf={exportToPdf} />
    </div>
  )}
</header>
  );
}

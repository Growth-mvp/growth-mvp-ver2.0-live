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
      <p className="mt-1.5 text-[14px] font-medium text-zinc-500 leading-relaxed">
        数値目標を管理するだけのKPIから、未来の成長を生み出し、動かすKPIへ。
      </p>
    </div>

    <p className="text-[14px] leading-[1.9] text-zinc-600">
      STAGE2の全社戦略をもとに、各事業・部門が実行できる役割と重点テーマに展開します。
      <br />
      経営ストーリーを起点に、各事業・部門のミッション、重点プロジェクト、KPIを全体最適の視点で整理します。
      <br />
      ただ数値目標を割り振るだけのKPIではなく、経営戦略とつながり、会社の成長に向けてシフトできるかを重視します。
      <br />
      部門長・マネージャー層との対話を通じて、「自部門は経営戦略の実現にどう貢献するのか」を明確化し、成長を生み出すKPIを設計します。
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

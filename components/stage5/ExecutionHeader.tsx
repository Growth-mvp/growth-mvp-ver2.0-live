'use client';

import { CheckCircle2 } from 'lucide-react';

interface ExecutionHeaderProps {
  isHydrating: boolean;
  selected: unknown;
}

export function ExecutionHeader({ isHydrating, selected }: ExecutionHeaderProps) {
  return (
    <div className="bg-white/90 border-b border-black/10 sticky top-0 z-20 backdrop-blur-xl">
      <div className="px-4 md:px-6 lg:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">STAGE5 実行計画支援</h1>
          <div className="mt-2 text-sm text-gray-600">ストーリー＞部門＞プロジェクト の順に表示。各カードをクリックして詳細を確認します。</div>
          {isHydrating && <div className="mt-2 text-sm text-gray-500">サーバーのデータを読み込み中です…</div>}
        </div>
        <div className="flex items-center gap-4">
          {selected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800">
              <CheckCircle2 className="h-3 w-3" />
              実行支援を表示中
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

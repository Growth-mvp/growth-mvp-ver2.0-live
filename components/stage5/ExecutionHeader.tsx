'use client';

import { CheckCircle2 } from 'lucide-react';

interface ExecutionHeaderProps {
  isHydrating: boolean;
  selected: unknown;
}

export function ExecutionHeader({ isHydrating, selected }: ExecutionHeaderProps) {
  return (
    <div className="bg-white/90 border-b border-black/10 sticky top-0 z-20 backdrop-blur-xl">
      <div className="px-4 md:px-6 lg:px-6 py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1">
          {/* 主見出し */}
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            STAGE5｜どうやって前に進めるか
          </h1>

          {/* 副見出し */}
          <div className="mt-1 text-sm font-medium text-gray-700">
            実行支援
          </div>

          {/* 説明文 */}
          <p className="mt-2 text-sm text-gray-600">
            進捗と課題を捉え、計画を止めずに前へ進めます。
          </p>

          {isHydrating && <div className="mt-2 text-sm text-gray-500">サーバーのデータを読み込み中です…</div>}
        </div>

        <div className="flex items-center gap-4 sm:shrink-0">
          {selected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800 whitespace-nowrap">
              <CheckCircle2 className="h-3 w-3" />
              実行支援を表示中
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

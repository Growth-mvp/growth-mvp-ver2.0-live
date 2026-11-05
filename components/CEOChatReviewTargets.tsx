'use client';

import Link from 'next/link';
import type { ReviewTarget } from '@/lib/ceoChat/reviewTargets';

type Props = {
  targets: ReviewTarget[];
  currentStrategyId: string | null | undefined;
};

/** 見直し箇所への案内。表示と画面遷移だけを行い、データは変更しない */
export default function CEOChatReviewTargets({ targets, currentStrategyId }: Props) {
  const visible = currentStrategyId
    ? targets.filter((t) => t.strategyId === String(currentStrategyId))
    : [];
  if (visible.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200 pt-2" aria-label="見直し箇所">
      {visible.map((t) => (
        <div key={t.candidateId} className="text-[12px] leading-5 text-zinc-700">
          <div className="font-semibold text-zinc-800">STAGE4｜実行計画</div>
          <div>
            {t.projectTitle}
            {t.departmentName ? <span className="text-zinc-500">（{t.departmentName}）</span> : null}
          </div>
          <div className="text-zinc-500">確認する項目：{t.checkItems.join('・')}</div>
          <Link href={t.href} className="mt-1 inline-block underline text-zinc-900">
            該当プロジェクトを開く
          </Link>
        </div>
      ))}
    </div>
  );
}

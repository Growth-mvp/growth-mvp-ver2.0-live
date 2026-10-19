'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

import { usePlanDocument } from '@/hooks/usePlanDocument';
import type { PlanAudience, PlanRole } from '@/lib/plans/planDocumentState';

/**
 * 経営計画書の入口カード（保存状態の表示と、計画書画面への遷移）
 * 閲覧のみで AI 生成 API は呼ばない（保存済み取得のみ）
 */

export interface PlanEntryCardProps {
  audience: PlanAudience;
  title: string;
  description: string;
  href: string;
  companyId: string | null | undefined;
  strategyId: string | null | undefined;
  role: PlanRole;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '不明' : date.toLocaleString('ja-JP');
}

export default function PlanEntryCard({
  audience,
  title,
  description,
  href,
  companyId,
  strategyId,
  role,
}: PlanEntryCardProps) {
  const router = useRouter();
  const plan = usePlanDocument({ companyId, strategyId, audience }, role);

  const checking = !companyId || !strategyId || plan.isRestoring;
  const doc = checking ? null : plan.doc;

  return (
    <div className="flex flex-col rounded-lg border border-neutral-300 bg-white p-6">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <p className="mt-2 text-sm text-neutral-600">{description}</p>

      <div className="mt-5 flex-1 space-y-2 text-sm">
        {checking && (
          <span className="inline-block rounded bg-neutral-100 px-2 py-0.5 text-neutral-600">確認中…</span>
        )}
        {!checking && doc && (
          <>
            <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
              生成済み
            </span>
            <p className="text-neutral-600">最終生成日時: {formatDateTime(doc.generatedAt)}</p>
          </>
        )}
        {!checking && !doc && (
          <span className="inline-block rounded bg-neutral-100 px-2 py-0.5 text-neutral-600">未生成</span>
        )}
        {plan.error && <p className="text-red-700">{plan.error}</p>}
        {!checking && !doc && !plan.canGenerate && !plan.error && (
          <p className="text-neutral-600">管理者またはマネージャーに生成を依頼してください。</p>
        )}
      </div>

      {!checking && (doc || plan.error) && (
        <button
          type="button"
          onClick={() => router.push(href)}
          className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          計画書を見る
        </button>
      )}
      {!checking && !doc && !plan.error && plan.canGenerate && (
        <button
          type="button"
          onClick={() => router.push(href)}
          className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          計画書を生成
        </button>
      )}
    </div>
  );
}

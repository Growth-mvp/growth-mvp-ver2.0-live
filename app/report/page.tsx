'use client';

import StrategyGuard from '@/app/StrategyGuard';
import PlanEntryCard from '@/components/export/PlanEntryCard';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';

const PLAN_ENTRIES = [
  {
    audience: 'bank',
    title: '銀行向け経営改善・事業計画書',
    description: '経営課題・改善計画・資金繰り・返済計画',
    href: '/report/bank-plan',
  },
  {
    audience: 'shareholder',
    title: '株主向け中期経営計画書',
    description: '成長戦略・中期目標・財務計画・企業価値',
    href: '/report/shareholder-plan',
  },
  {
    audience: 'employee',
    title: '社員向け経営方針・実行計画書',
    description: '全社方針・部門別戦略・実行計画・育成計画',
    href: '/report/employee-plan',
  },
] as const;

export default function ReportPage() {
  const companyId = useStrategyStore((state) => state.companyId);
  const strategyId = useStrategyStore((state) => state.strategyId);
  const role = useUserStore((state) => state.role);

  return (
    <StrategyGuard>
      <div className="min-h-screen bg-neutral-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-neutral-900">経営計画書</h1>
            <p className="mt-2 text-base text-neutral-600">
              STAGE1〜6の情報をもとに、目的に応じた経営計画書を作成・確認できます。
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {PLAN_ENTRIES.map((entry) => (
              <PlanEntryCard
                key={entry.audience}
                audience={entry.audience}
                title={entry.title}
                description={entry.description}
                href={entry.href}
                companyId={companyId}
                strategyId={strategyId}
                role={role}
              />
            ))}
          </div>
        </div>
      </div>
    </StrategyGuard>
  );
}

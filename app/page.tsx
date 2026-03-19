// /app/page.tsx（修正版フルコード）
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import PyramidNavigator from '@/components/home/PyramidNavigator';
import ExecutionPanel from '@/components/home/ExecutionPanel';
import { useUserStore } from '@/store/userStore';
import { motion } from 'framer-motion';

export default function Home() {
  const { user } = useUserStore();

  useEffect(() => {
    if (user?.id && user?.role) {
      // 必要なら自動遷移
      // router.push('/strategy');
    }
  }, [user?.id, user?.role]);

  const steps = [
    { step: 1, title: 'STAGE 1：企業価値分析', path: '/stage1' },
    { step: 2, title: 'STAGE 2：経営戦略策定', path: '/stage2' },
    { step: 3, title: 'STAGE 3：部門戦略策定', path: '/cascade' },
    { step: 4, title: 'STAGE 4：実行計画策定', path: '/okr' },
    { step: 5, title: 'STAGE 5：実行計画支援', path: '/execution' },
    { step: 6, title: 'STAGE 6：業績シミュレーション', path: '/stage6' },
  ];

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-white">
      {/* ===== Hero ===== */}
      <section className="container mx-auto px-6 pt-16 pb-10 heroPad">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-lg sm:text-2xl font-semibold tracking-wide text-neutral-700 dark:text-neutral-200">
  企業の成長を自動運転へ。
</p>

<h1 className="mt-6 text-6xl font-extrabold tracking-tight sm:text-7xl heroTitle">
  GROWTH/戦略実行SaaS
</h1>

<p className="mt-5 text-lg sm:text-xl leading-relaxed text-neutral-600 dark:text-neutral-300">
  戦略を実行に、実行を成果をつなぐ経営プラットフォーム

</p>

          <div className="mt-8">
            <Link
              href="/stage1"
              className="inline-flex items-center justify-center rounded-full bg-neutral-900 px-8 py-3.5 text-base font-semibold text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              さっそく始める
            </Link>
          </div>
        </div>
      </section>

      {/* ===== Pyramid + Execution（左右対称）===== */}
      <section className="container mx-auto px-6 pb-14">
        <h2 className="sr-only">GROWTHピラミッドナビゲーション</h2>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="motion-reduce:transition-none motion-reduce:transform-none"
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch homeGrid">
            {/* LEFT: STRATEGY */}
            <div className="h-full rounded-3xl bg-white p-4 shadow-[0_1px_30px_rgba(0,0,0,0.06)] ring-1 ring-neutral-200/70 dark:bg-neutral-950 dark:ring-neutral-800">
              <div className="mb-3">
                <div className="text-xs font-medium tracking-widest text-neutral-500 dark:text-neutral-400">
                  STRATEGY
                </div>
                <div className="text-lg font-semibold text-neutral-900 dark:text-white">戦略設計</div>
              </div>
              <PyramidNavigator />
            </div>

            {/* RIGHT: EXECUTION */}
            <div className="h-full rounded-3xl bg-white p-4 shadow-[0_1px_30px_rgba(0,0,0,0.06)] ring-1 ring-neutral-200/70 dark:bg-neutral-950 dark:ring-neutral-800">
              <div className="mb-3">
                <div className="text-xs font-medium tracking-widest text-neutral-500 dark:text-neutral-400">
                  EXECUTION
                </div>
                <div className="text-lg font-semibold text-neutral-900 dark:text-white">戦略実行</div>
              </div>
              <div className="lg:sticky lg:top-6 homeSticky">
                <ExecutionPanel />
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ===== Steps：モバイル補助導線 ===== */}
      <section className="container mx-auto px-6 pb-24 md:hidden">
        <h2 className="sr-only">GROWTHのステップ</h2>
        <div className="grid grid-cols-1 gap-4">
          {steps.map((item) => (
            <Link key={item.step} href={item.path} aria-label={item.title} className="group">
              <div className="relative rounded-2xl bg-white p-5 shadow-soft ring-1 ring-neutral-200/70 transition duration-200 hover:-translate-y-0.5 hover:shadow-card dark:bg-neutral-950 dark:ring-neutral-800">
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-tr from-neutral-50 to-transparent opacity-0 transition-opacity group-hover:opacity-100 dark:from-neutral-900/40" />
                <h3 className="text-[16px] font-semibold tracking-tight text-neutral-900 dark:text-white">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
                  {item.step} / 6
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
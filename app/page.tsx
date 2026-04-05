// /app/page.tsx
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
      <section className="border-b border-neutral-200/60 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-950">
        <div className="container mx-auto px-6 pt-10 pb-6 sm:pt-12 sm:pb-8 lg:pt-14 lg:pb-9">
          <div className="mx-auto max-w-4xl text-center">
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              className="mx-auto max-w-3xl text-[26px] font-semibold leading-[1.3] tracking-[-0.035em] text-neutral-900 sm:text-[33px] lg:text-[40px] dark:text-neutral-50"
            >
              企業成長を、自律自走で加速する。
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.06 }}
              className="mt-4 text-[21px] font-medium tracking-[0.01em] text-neutral-800 sm:text-[27px] lg:text-[31px] dark:text-neutral-100"
            >
              GROWTH ｜ 戦略実行SaaS
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.68, delay: 0.12 }}
              className="mx-auto mt-4 max-w-3xl text-[15px] leading-7 text-neutral-600 sm:text-[16px] dark:text-neutral-300"
            >
              やるべきことを絞り、全員でやりきる経営プラットフォーム
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.74, delay: 0.18 }}
              className="mt-7"
            >
              <Link
                href="/stage1"
                className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-neutral-950 px-8 py-4 text-[15px] font-semibold text-white shadow-[0_14px_36px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:opacity-95 dark:bg-white dark:text-neutral-950"
              >
                さっそく始める
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===== Overview Panels ===== */}
      <section className="container mx-auto px-6 pb-16 lg:pb-20">
        <div className="h-4 sm:h-5 lg:h-6" />
        <h2 className="sr-only">GROWTHトップ概要</h2>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
          className="motion-reduce:transition-none motion-reduce:transform-none"
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
            {/* LEFT: STRATEGY */}
            <div className="h-full overflow-hidden rounded-[28px] border border-neutral-200/70 bg-white shadow-[0_1px_30px_rgba(0,0,0,0.06)] dark:border-neutral-800 dark:bg-neutral-950">
              <div className="border-b border-neutral-200/80 px-6 py-5 dark:border-neutral-800">
                <div className="text-[11px] font-semibold tracking-[0.18em] text-neutral-500 dark:text-neutral-400">
                  STRATEGY
                </div>
                <div className="mt-1 text-[24px] font-bold tracking-[-0.03em] text-neutral-950 dark:text-white">
                  戦略設計
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                  企業価値分析から経営戦略、部門戦略、実行計画までを一気通貫で設計します。
                </p>
              </div>

              <div className="px-5 py-5">
                <PyramidNavigator />
              </div>
            </div>

            {/* RIGHT: EXECUTION */}
            <div className="h-full overflow-hidden rounded-[28px] border border-neutral-200/70 bg-white shadow-[0_1px_30px_rgba(0,0,0,0.06)] dark:border-neutral-800 dark:bg-neutral-950">
              <div className="border-b border-neutral-200/80 px-6 py-5 dark:border-neutral-800">
                <div className="text-[11px] font-semibold tracking-[0.18em] text-neutral-500 dark:text-neutral-400">
                  EXECUTION
                </div>
                <div className="mt-1 text-[24px] font-bold tracking-[-0.03em] text-neutral-950 dark:text-white">
                  戦略実行
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                  実行状況、チェックイン、進捗、業績インパクトを可視化し、戦略を成果へつなげます。
                </p>
              </div>

              <div className="px-5 py-5">
                <div className="lg:sticky lg:top-6">
                  <ExecutionPanel />
                </div>
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
              <div className="relative rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-[0_1px_18px_rgba(0,0,0,0.05)] transition duration-200 hover:-translate-y-0.5 dark:border-neutral-800 dark:bg-neutral-950">
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

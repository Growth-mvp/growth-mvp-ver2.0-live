'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import PyramidNavigator from '@/components/home/PyramidNavigator';
import ExecutionPanel from '@/components/home/ExecutionPanel';
import { ExportPdfButton } from '@/components/export/ExportPdfButton';
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
        <div className="container mx-auto px-6 pt-14 pb-5 sm:pt-16 sm:pb-6 lg:pt-20 lg:pb-7">
          <div className="mx-auto max-w-6xl -translate-y-4 text-center sm:-translate-y-5 lg:-translate-y-6">
            <motion.h1
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6 }}
  className="text-[28px] font-bold tracking-[-0.04em] text-neutral-950 sm:text-[36px] lg:text-[44px] dark:text-white"
>
  過去の延長では、もう勝てない。
</motion.h1>

<motion.div
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6, delay: 0.08 }}
  className="mt-4 text-[15px] font-semibold tracking-[0.06em] text-neutral-800 sm:text-[17px] lg:text-[20px] dark:text-neutral-100"
>
  GROWTH SHIFT｜AI戦略実行プラットフォーム
</motion.div>

<motion.p
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6, delay: 0.16 }}
  className="mt-3 text-[14px] font-medium leading-relaxed text-neutral-700 sm:text-[15px] lg:text-[16px] dark:text-neutral-300"
>
  やるべきことを絞り、組織を動かし、業績につなぐ変革の仕組み
</motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.74, delay: 0.18 }}
              className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Link
                href="/stage1"
                className="inline-flex min-w-[180px] items-center justify-center rounded-full bg-neutral-950 px-8 py-3 text-[15px] font-semibold text-white shadow-[0_14px_36px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:opacity-95 dark:bg-white dark:text-neutral-950"
              >
                さっそく始める
              </Link>
              <Link
                href="/report/preview"
                className="inline-flex min-w-[180px] items-center justify-center rounded-full border-2 border-neutral-950 px-8 py-2.5 text-[15px] font-semibold text-neutral-950 transition hover:-translate-y-0.5 hover:bg-neutral-50 dark:border-white dark:text-white dark:hover:bg-neutral-950"
              >
                レポートを見る
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===== Overview Panels ===== */}
      <section className="container mx-auto px-6 pt-0 pb-14 sm:pt-0 lg:pt-0 lg:pb-16">
        <h2 className="sr-only">GROWTHトップ概要</h2>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
          className="motion-reduce:transition-none motion-reduce:transform-none"
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
            {/* LEFT: STRATEGY */}
            <div className="flex h-full flex-col">
              <div className="mb-1.5 px-1">
                <h3 className="text-[20px] font-bold tracking-[-0.035em] text-neutral-950 dark:text-white">
                  戦略設計
                </h3>
              </div>

              <div className="h-full overflow-hidden rounded-[26px] border border-neutral-200/70 bg-white shadow-[0_1px_30px_rgba(0,0,0,0.06)] dark:border-neutral-800 dark:bg-neutral-950">
                <div className="px-5 pt-3 pb-0">
                  <p className="text-[11.5px] leading-5 text-neutral-500 dark:text-neutral-400">
                    企業価値分析から実行計画までを一気通貫で設計します。
                  </p>
                </div>
                <div className="px-4 pt-1 pb-3">
                  <PyramidNavigator />
                </div>
              </div>
            </div>

            {/* RIGHT: EXECUTION */}
            <div className="flex h-full flex-col">
              <div className="mb-1.5 px-1">
                <h3 className="text-[20px] font-bold tracking-[-0.035em] text-neutral-950 dark:text-white">
                  戦略実行
                </h3>
              </div>

              <div className="h-full overflow-hidden rounded-[26px] border border-neutral-200/70 bg-white shadow-[0_1px_30px_rgba(0,0,0,0.06)] dark:border-neutral-800 dark:bg-neutral-950">
                <div className="px-5 pt-3 pb-0">
                  <p className="text-[11.5px] leading-5 text-neutral-500 dark:text-neutral-400">
                    進捗と業績インパクトを可視化し、戦略を成果へつなげます。
                  </p>
                </div>
                <div className="px-4 pt-1 pb-3">
                  <div className="lg:sticky lg:top-6">
                    <ExecutionPanel />
                  </div>
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

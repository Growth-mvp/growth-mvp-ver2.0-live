'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import PyramidNavigator from '@/components/home/PyramidNavigator';
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
    { step: 1, title: 'STAGE 1：経営基本情報', description: '経営基本情報・MVV・SWOT・財務等を入力', path: '/strategy' },
    { step: 2, title: 'STAGE 2：経営戦略策定', description: 'たたき台ストーリー→AI質問生成→最終ストーリー', path: '/story-process' },
    { step: 3, title: 'STAGE 3：部門戦略策定', description: '部門ミッション・プロジェクト生成', path: '/cascade' },
    { step: 4, title: 'STAGE 4：実行計画策定', description: 'OKRの検討・設定', path: '/okr' },
    { step: 5, title: 'STAGE 5：実行計画支援', description: '実行状況の可視化、評価アドバイス', path: '/execution' },
  ];

  return (
    <main className="min-h-screen bg-white text-neutral-900 antialiased [--accent:#0a0a0a] dark:bg-black dark:text-white">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        {/* 背景：放射グラデ + ノイズ（/public/noise.png を配置） */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 left-1/2 h-[120vh] w-[120vh] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.06),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_60%)]" />
          <div className="absolute inset-0 opacity-[0.06] mix-blend-multiply [background-image:url('/noise.png')]" />
        </div>

        <div className="container mx-auto px-6 pt-20 pb-12 md:pt-28 md:pb-20">
          <div className="mx-auto max-w-5xl text-center">
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="text-5xl font-extrabold tracking-tight sm:text-6xl md:text-7xl motion-reduce:transition-none motion-reduce:transform-none"
            >
              <span className="block leading-[1.05] text-[clamp(48px,8vw,96px)]">GROWTH</span>
              <span
                className="
                  mt-3 block whitespace-nowrap
                  max-[360px]:whitespace-normal
                  text-[clamp(16px,3.5vw,28px)]
                  bg-clip-text text-transparent
                  bg-gradient-to-r from-black via-neutral-700 to-black
                  dark:from-white dark:via-neutral-300 dark:to-white
                "
              >
                現状を壊し、未来を変える 企業変革プラットフォーム
              </span>
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.6 }}
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row motion-reduce:transition-none motion-reduce:transform-none"
            >
              <Link
                href="/strategy"
                className="inline-flex h-12 items-center justify-center rounded-full bg-neutral-900 px-7 text-sm font-semibold text-white shadow-sm transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                aria-label="さっそく始める"
              >
                さっそく始める
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===== Pyramid（デスクトップ主体） ===== */}
      <section className="container mx-auto px-6 -mt-8 md:-mt-12">
        <h2 className="sr-only">GROWTHピラミッドナビゲーション</h2>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="motion-reduce:transition-none motion-reduce:transform-none"
        >
          <div className="rounded-3xl bg-white p-4 shadow-[0_1px_30px_rgba(0,0,0,0.06)] ring-1 ring-neutral-200/70 dark:bg-neutral-950 dark:ring-neutral-800">
            <PyramidNavigator />
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
                <h3 className="text-[16px] font-semibold tracking-tight text-neutral-900 dark:text-white">{item.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-neutral-600 dark:text-neutral-300">{item.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

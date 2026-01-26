// /app/page.tsx（修正版フルコード）
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
    { step: 1, title: 'STAGE 1：企業価値分析', description: '財務事実から企業価値の現状を整理', path: '/stage1' },
    { step: 2, title: 'STAGE 2：経営戦略策定', description: 'たたき台ストーリー→AI質問生成→最終ストーリー', path: '/story-process' },
    { step: 3, title: 'STAGE 3：部門戦略策定', description: '部門ミッション・プロジェクト生成', path: '/cascade' },
    { step: 4, title: 'STAGE 4：実行計画策定', description: 'OKRの検討・設定', path: '/okr' },
    { step: 5, title: 'STAGE 5：実行計画支援', description: '実行状況の可視化、評価アドバイス', path: '/execution' },
  ];

  return (
    <main className="min-h-screen bg-white text-neutral-900 antialiased [--accent:#0a0a0a] dark:bg-black dark:text-white">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        {/* 背景：放射グラデ + ノイズ（データURLで404回避） */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="
              absolute -top-32 left-1/2 h-[120vh] w-[120vh] -translate-x-1/2 rounded-full
              bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.08),transparent_60%)]
              dark:bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.12),transparent_60%)]
            "
          />
          <div
            className="
              absolute inset-0 opacity-[0.06] mix-blend-multiply
              [background-image:url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y3w5b8AAAAASUVORK5CYII=')]
            "
          />
        </div>

        <div className="container mx-auto px-6 pt-20 pb-12 md:pt-28 md:pb-20">
          <div className="mx-auto max-w-5xl text-center">
            {/* 上：日本語サブヘッド（少しだけサイズを落として上品に） */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="
                font-semibold tracking-tight text-neutral-900 dark:text-neutral-100
                leading-tight
                text-[clamp(30px,3.2vw,30px)]
              "
            >
              現状を壊し、未来を変える
            </motion.p>

            {/* 中央：GROWTH（横余白を確保しつつ存在感） */}
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="
                mt-3 font-extrabold tracking-[-0.02em] select-none
                text-[clamp(120px,10vw,120px)] leading-none
                text-neutral-900 dark:text-neutral-100
              "
            >
              GROWTH
            </motion.h1>

            {/* 下：サブコピー（読みやすさ優先で少し大きく） */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.6 }}
              className="
                mt-5 mx-auto max-w-3xl
                text-[clamp(22px,2.5vw,20px)] leading-relaxed
                text-neutral-600 dark:text-neutral-300
              "
            >
              戦略を行動に変え、成果を企業価値につなぐ経営プラットフォーム
            </motion.p>

            {/* CTA（既存機能維持） */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.6 }}
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row motion-reduce:transition-none motion-reduce:transform-none"
            >
              <Link
                href="/stage1"
                className="
                  inline-flex h-12 items-center justify-center rounded-full
                  bg-neutral-900 px-7 text-sm font-semibold text-white shadow-sm transition
                  hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400
                  dark:bg-white dark:text-black dark:hover:bg-neutral-200
                "
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

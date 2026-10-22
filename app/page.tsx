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
    { step: 1, title: 'STAGE1｜会社の現状はどうか', subtitle: '企業価値分析', description: '現状の業績・資本効率・成長課題を整理し、どこを変えるべきかを明らかにします。', path: '/stage1' },
    { step: 2, title: 'STAGE2｜会社は何を目指すのか', subtitle: '全社戦略', description: '中計全体の方向性、重点テーマ、目指す成果を定めます。', path: '/stage2' },
    { step: 3, title: 'STAGE3｜各部門の役割は何か', subtitle: '事業・部門別戦略', description: '全社戦略を、各事業・部門が担う役割と重点テーマに展開します。', path: '/cascade' },
    { step: 4, title: 'STAGE4｜現場は何をするのか', subtitle: '実行計画策定', description: '戦略とKPIを、現場が実行できる具体的な行動計画に落とし込みます。', path: '/okr' },
    { step: 5, title: 'STAGE5｜どうやって前に進めるか', subtitle: '実行支援', description: '進捗・課題・変化を確認しながら、計画の実行を前に進めます。', path: '/execution' },
    { step: 6, title: 'STAGE6｜成果を確かめる', subtitle: '業績シミュレーション', description: '実行の結果が、売上・利益・企業価値にどうつながるかを確認します。', path: '/stage6' },
  ];

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* ===== Hero ===== */}
      <section className="border-b border-neutral-200/60 bg-neutral-50 xl:dark:border-neutral-900 xl:dark:bg-neutral-950">
        <div className="container mx-auto px-6 pt-10 pb-4 sm:pt-12 sm:pb-5 lg:pt-14 lg:pb-6">
          <div className="mx-auto max-w-3xl text-center">
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-[28px] font-bold tracking-[-0.04em] text-neutral-950 sm:text-[36px] lg:text-[44px] xl:dark:text-white"
            >
              戦略を行動へ。企業を成長へ。
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08 }}
              className="mt-2 text-[15px] font-semibold tracking-[0.06em] text-neutral-800 sm:text-[17px] lg:text-[20px] xl:dark:text-neutral-100"
            >
            GROWTH SHIFT｜経営戦略をつくり、組織を動かし、実現につなぐ仕組み
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16 }}
              className="mt-2 text-[14px] font-medium leading-relaxed text-neutral-700 sm:text-[15px] lg:text-[16px] xl:dark:text-neutral-300"
            >
              

            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.74, delay: 0.18 }}
              className="mt-6 flex items-center justify-center gap-3 sm:flex-row"
            >
              <Link
                href="/stage1"
                className="inline-flex items-center justify-center rounded-full bg-gray-900 px-6 py-2.5 text-[14px] font-semibold text-white shadow-[0_14px_36px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:opacity-95 xl:dark:bg-neutral-950"
              >
                さっそく始める
              </Link>
              <Link
                href="/report"
                className="inline-flex items-center justify-center rounded-full border-2 border-gray-900 px-6 py-2 text-[14px] font-semibold text-gray-900 transition hover:-translate-y-0.5 hover:bg-gray-100 xl:dark:border-white xl:dark:text-white xl:dark:hover:bg-neutral-950"
              >
                経営計画書を見る
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===== Overview Panels ===== */}
      <section className="container mx-auto px-6 pt-0 pb-8 sm:pt-0 lg:pt-0 lg:pb-10">
        <h2 className="sr-only">GROWTHトップ概要</h2>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
          className="motion-reduce:transition-none motion-reduce:transform-none"
        >
          <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2 xl:items-stretch xl:gap-4">
            {/* LEFT: STRATEGY */}
            <div className="flex h-full flex-col">
              <div className="mb-1.5 px-1">
                <h3 className="text-[20px] font-bold tracking-[-0.035em] text-neutral-950 xl:dark:text-white">
                  経営戦略をつくる
                </h3>
              </div>

              <div className="h-full overflow-hidden rounded-[26px] border border-neutral-200/70 bg-white shadow-[0_1px_30px_rgba(0,0,0,0.06)] xl:dark:bg-neutral-950">
                <div className="px-5 pt-3 pb-0">
                  <p className="text-[11.5px] leading-5 text-neutral-500 dark:text-neutral-400">
                    会社の現状を捉え、目指す方向を定め、各部門の役割と実行テーマまで一気通貫で設計します。
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
                <h3 className="text-[20px] font-bold tracking-[-0.035em] text-neutral-950 xl:dark:text-white">
                  経営戦略を動かす
                </h3>
              </div>

              <div className="h-full overflow-hidden rounded-[26px] border border-neutral-200/70 bg-white shadow-[0_1px_30px_rgba(0,0,0,0.06)] xl:dark:bg-neutral-950">
                <div className="px-5 pt-3 pb-0">
                  <p className="text-[11.5px] leading-5 text-neutral-500 dark:text-neutral-400">
                    進捗と変化を捉えながら、戦略を現場の行動につなぎ、成果につなげていきます。
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

    </main>
  );
}

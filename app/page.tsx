'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useUserStore } from '@/store/userStore';

export default function Home() {
  const { user } = useUserStore();

  useEffect(() => {
    if (user?.id && user?.role) {
      // 自動遷移したければ有効化
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
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="container mx-auto px-6 py-14 md:py-20">
        <div className="relative overflow-hidden rounded-[28px] bg-white shadow-card px-8 py-14 md:px-16">
          {/* ごく薄いアクセントのトーン */}
          <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-neutral-100 blur-3xl" />
          <p className="text-[44px] md:text-[56px] leading-[1.1] tracking-tight font-extrabold text-neutral-900">
            伝わる戦略、動く組織
          </p>
          <h1 className="mt-1 text-[24px] md:text-[28px] font-semibold tracking-tight text-neutral-600">
            Growth — 戦略の策定・浸透・実行を支援する企業変革プラットフォーム
          </h1>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/strategy"
              className="inline-flex h-12 items-center justify-center rounded-full bg-neutral-900 px-6 text-[15px] font-semibold text-white hover:bg-black transition"
              aria-label="さっそく始める"
            >
              さっそく始める
            </Link>
            <Link
              href="/story-process"
              className="inline-flex h-12 items-center justify-center rounded-full border border-neutral-300 bg-white px-6 text-[15px] font-semibold text-neutral-900 hover:bg-neutral-50 transition"
              aria-label="ストーリープロセスを見る"
            >
              戦略ストーリーを見る
            </Link>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="container mx-auto px-6 pb-20">
        <h2 className="sr-only">GROWTHのステップ</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {steps.map((item) => (
            <Link key={item.step} href={item.path} aria-label={item.title} className="group">
              <div
                className="
                  relative rounded-2xl bg-white p-6 md:p-7 shadow-soft ring-1 ring-neutral-200/70
                  transition duration-200
                  hover:-translate-y-0.5 hover:shadow-card
                "
              >
                {/* うっすらグラデーションの光 */}
                <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-tr from-neutral-50 to-transparent rounded-2xl" />

                {/* ▼ STEPバッジ削除済み */}

                <h3 className="text-[18px] md:text-[20px] font-semibold tracking-tight text-neutral-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-neutral-600">{item.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

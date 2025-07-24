'use client';

import { useEffect } from 'react';
import { useUserStore } from '@/store/userStore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Home() {
  const { user } = useUserStore();
  const router = useRouter();

  useEffect(() => {
    if (user?.id && user?.role) {
      // 任意でログイン済み時の自動遷移を有効化できます
      // router.push('/strategy');
    }
  }, [user?.id]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-100 py-16 px-6">
      <section className="text-center max-w-3xl mx-auto mb-16">
        <h1 className="text-6xl font-bold text-gray-800 mb-4">GROWTH</h1>
        <p className="text-lg text-gray-600 mb-6">
          ー経営と現場をつなぎ、戦略を行動に変えるー
        </p>
        <Link href="/strategy">
          <button className="inline-block bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 transition text-lg font-semibold">
            さっそく始める →
          </button>
        </Link>
      </section>

      <section className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">STEP 1：経営情報の入力</h2>
          <p className="text-gray-600 text-sm">会社の思い、SWOT、財務情報などを入力</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">STEP 2：ストーリー生成と対話</h2>
          <p className="text-gray-600 text-sm">AIとの対話を通じて深掘りし、共感ある戦略を形成</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">STEP 3：戦略カスケード</h2>
          <p className="text-gray-600 text-sm">部門戦略・プロジェクト・OKRに展開しピラミッド化</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">STEP 4：OKR実行支援</h2>
          <p className="text-gray-600 text-sm">担当者ごとの進捗記録やSlack風の対話サポート</p>
        </div>
      </section>
    </main>
  );
}

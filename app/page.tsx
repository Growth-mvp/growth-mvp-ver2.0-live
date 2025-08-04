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
      // 自動遷移させたい場合
      // router.push('/strategy');
    }
  }, [user?.id]);

  const chapters = [
    {
      title: '第1章：この会社は何者か？',
      description: '経営情報、MVV、SWOT、財務などの入力',
      path: '/strategy',
    },
    {
      title: '第2章：未来を描く',
      description: 'ストーリー生成・質問・深掘り対話',
      path: '/story-process',
    },
    {
      title: '第3章：各部門の役割',
      description: '部門ミッション・プロジェクト生成・深掘り質問',
      path: '/cascade',
    },
    {
      title: '第4章：物語を行動に落とす',
      description: 'OKR（Objective・Key Results・Owner）の入力・表示',
      path: '/okr',
    },
    {
      title: '最終章：本番の舞台へ',
      description: 'メンバーの実行支援・進捗・フィードバック',
      path: '/execution',
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-100 py-16 px-6">
      <section className="text-center max-w-3xl mx-auto mb-16">
        <h1 className="text-6xl font-bold text-gray-800 mb-4">GROWTH</h1>
        <p className="text-lg text-gray-600 mb-6">
          ― 伝わる戦略、動く組織へ ―
        </p>
        <Link href="/strategy">
          <button className="inline-block bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 transition text-lg font-semibold">
            さっそく始める 
          </button>
        </Link>
      </section>

      <section className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        {chapters.map((chapter, index) => (
          <Link href={chapter.path} key={index}>
            <div className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition cursor-pointer">
              <h2 className="text-xl font-semibold text-gray-800 mb-2">{chapter.title}</h2>
              <p className="text-gray-600 text-sm">{chapter.description}</p>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}

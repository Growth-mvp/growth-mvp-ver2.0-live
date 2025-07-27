'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';

export default function StoryPage() {
  const router = useRouter();
  const { user } = useUserStore();
  const { story } = useStrategyStore();

  const [storyChapters, setStoryChapters] = useState<{ title: string; body: string }[]>([]);

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    if (story && typeof story === 'string') {
      // 文字列から構造化されていない場合：■で4章に分割
      const matches = story.match(/■[^\n]+\n[\s\S]*?(?=(■[^\n]+\n)|$)/g) || [];
      const parsed = matches.map((section) => {
        const [titleLine, ...bodyLines] = section.trim().split('\n');
        return {
          title: titleLine.replace(/^■/, '').trim(),
          body: bodyLines.join('\n').trim(),
        };
      });
      setStoryChapters(parsed);
    } else if (Array.isArray(story)) {
      // すでに構造化されている場合（title, body）
      setStoryChapters(story);
    }
  }, [user, story]);

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-2xl font-bold mb-6 text-center">🎉 最終ストーリー</h1>

      {storyChapters.length === 0 ? (
        <p className="text-center text-gray-500">ストーリーが未生成です。</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {storyChapters.map((chapter, idx) => (
            <div key={idx} className="p-4 bg-white border rounded shadow-sm">
              <h2 className="text-lg font-semibold text-indigo-700 mb-2">
                第{idx + 1}章：{chapter.title}
              </h2>
              <p className="whitespace-pre-wrap text-gray-800 text-sm">{chapter.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 text-center">
        <button
          onClick={() => router.push('/story-process')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          ✏️ ストーリー再生成へ戻る
        </button>
      </div>
    </main>
  );
}

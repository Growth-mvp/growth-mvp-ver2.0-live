'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';

type ChapterStory = { title: string; body: string };

export default function StoryPage() {
  const router = useRouter();
  const { user } = useUserStore();
  const { story, finalStory } = useStrategyStore();

  const [storyChapters, setStoryChapters] = useState<ChapterStory[]>([]);

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    // 優先順位: finalStory → story(string/array)
    if (Array.isArray(finalStory) && finalStory.length > 0) {
      const validChapters = finalStory.filter(
        (item): item is ChapterStory =>
          typeof item.title === 'string' && typeof item.body === 'string'
      );
      setStoryChapters(validChapters);
    } else if (typeof story === 'string') {
      const matches = story.match(/■[^\n]+\n[\s\S]*?(?=(■[^\n]+\n)|$)/g) || [];
      const parsed = matches.map((section: string): ChapterStory => {
        const [titleLine, ...bodyLines] = section.trim().split('\n');
        return {
          title: titleLine.replace(/^■/, '').trim(),
          body: bodyLines.join('\n').trim(),
        };
      });
      setStoryChapters(parsed);
    } else if (Array.isArray(story)) {
      const validChapters = story.filter(
        (item): item is ChapterStory =>
          typeof item.title === 'string' && typeof item.body === 'string'
      );
      setStoryChapters(validChapters);
    } else {
      setStoryChapters([]);
    }
  }, [user, story, finalStory, router]);

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-2xl font-bold mb-6 text-center">🎉 最終ストーリー</h1>

      {storyChapters.length === 0 ? (
        <p className="text-center text-gray-500">※ ストーリーが未生成です。</p>
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

'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import { supabase } from '@/lib/supabaseClient';
import { useStrategyStore } from '@/store/strategyStore';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/button';

interface StoryHistory {
  id: string;
  story: string;
  summary: string;
  created_at: string;
  answers: string[];
  answers2: any[];
}

export default function StoryHistoryPage() {
  const { user } = useUserStore();
  const { setStory, setAnswers, setAnswers2 } = useStrategyStore();
  const router = useRouter();

  const [histories, setHistories] = useState<StoryHistory[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchHistories = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('story_histories')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('履歴取得エラー:', error);
      } else {
        setHistories(data || []);
      }

      setLoading(false);
    };

    fetchHistories();
  }, [user]);

  const handleReuse = (history: StoryHistory) => {
    setStory(history.story);
    setAnswers(history.answers || []);
    setAnswers2(history.answers2 || []);
    router.push('/story-process');
  };

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-2xl font-bold text-center mb-6">📚 ストーリー履歴</h1>

      {loading ? (
        <p className="text-center text-gray-500">読み込み中...</p>
      ) : histories.length === 0 ? (
        <p className="text-center text-gray-500">保存された履歴はありません。</p>
      ) : (
        <ul className="space-y-4">
          {histories.map((history) => (
            <li key={history.id} className="bg-white shadow rounded-md p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-semibold text-gray-800">{history.summary}</p>
                  <p className="text-sm text-gray-500">
                    作成日: {new Date(history.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="space-x-2">
                  <Button onClick={() => setExpandedId(expandedId === history.id ? null : history.id)}>
                    {expandedId === history.id ? '閉じる' : '全文を見る'}
                  </Button>
                  <Button onClick={() => handleReuse(history)} className="bg-blue-600 text-white hover:bg-blue-700">
                    再利用する
                  </Button>
                </div>
              </div>
              {expandedId === history.id && (
                <div className="mt-4 whitespace-pre-wrap text-gray-800 border-t pt-4">{history.story}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

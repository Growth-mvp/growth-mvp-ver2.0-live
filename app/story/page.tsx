'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldAlert,
  Navigation,
  Network,
  Users,
  MessageCircleQuestion,
} from 'lucide-react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { loadStrategyData } from '@/utils/supabase';

export default function StoryPage() {
  const router = useRouter();
  const {
    vision,
    industry,
    revenue,
    employees,
    strength,
    weakness,
    opportunity,
    threat,
    thought,
    story,
    setStory,
    setStrategySummary,
    mission,
    value,
    csvFinanceData,
    answers,
    answers2,
  } = useStrategyStore();

  const { user } = useUserStore();
  const isAdmin = user?.role === 'admin';

  const [localStory, setLocalStory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;
      const { data, error } = await loadStrategyData(user.id);
      if (error) {
        console.error('❌ Supabaseからの読み込み失敗:', error);
        return;
      }
      if (data?.story) {
        setStory(data.story);
        setLocalStory(data.story);
      }
      if (data?.strategySummary) {
        setStrategySummary(data.strategySummary);
      }
    };
    load();
  }, [user?.id]);

  const generateStory = async () => {
    if (!vision || !strength || !weakness || !opportunity || !threat || !thought) {
      setError('必要な情報（思い・ビジョン・SWOT）が不足しています。');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thought,
          vision,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          mission,
          value,
          csvFinanceData,
          answers,
          answers2,
        }),
      });

      const data = await res.json();

      if (res.ok && data.story) {
        setStory(data.story);
        setStrategySummary(data.summary);
        setLocalStory(data.story);
      } else {
        setError('ストーリー生成に失敗しました');
      }
    } catch (err) {
      console.error('❌ ストーリー生成失敗:', err);
      setError('ストーリー生成時にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const parts = localStory ? localStory.split('■') : [];

  return (
    <div className="p-8 min-h-screen bg-gradient-to-b from-white to-blue-50">
      <h1 className="text-3xl font-semibold mb-4 text-gray-900">戦略ストーリー</h1>

      <p className="text-sm text-gray-500 mb-8">
        ※ このストーリーはAIが生成したたたき台です。後のステップで「質問による掘り下げ」が可能です。
      </p>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <button
            onClick={generateStory}
            disabled={loading}
            className="bg-blue-700 text-white px-6 py-2 rounded-md hover:bg-blue-800 transition text-sm"
          >
            {loading ? '生成中...' : '📘 ストーリー生成'}
          </button>

          <button
            onClick={() => router.push('/story-guide')}
            className="flex items-center bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 transition text-sm"
          >
            <MessageCircleQuestion className="w-4 h-4 mr-2" />
            質問でさらに深掘りする
          </button>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      )}

      {parts.length < 5 ? (
        <p className="text-gray-500 text-sm italic">※ まだストーリーが生成されていません。</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white shadow rounded-xl p-6 border-l-4 border-red-500 max-h-[400px] overflow-auto">
            <div className="flex items-center mb-3 text-red-600 font-semibold">
              <ShieldAlert className="w-5 h-5 mr-2" />
              <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold mr-2">①</span>
              現状の危機や背景
            </div>
            <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[1]?.trim()}</p>
          </div>

          <div className="bg-white shadow rounded-xl p-6 border-l-4 border-blue-500 max-h-[400px] overflow-auto">
            <div className="flex items-center mb-3 text-blue-600 font-semibold">
              <Navigation className="w-5 h-5 mr-2" />
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold mr-2">②</span>
              目指す方向性
            </div>
            <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[2]?.trim()}</p>
          </div>

          <div className="bg-white shadow rounded-xl p-6 border-l-4 border-purple-500 max-h-[400px] overflow-auto">
            <div className="flex items-center mb-3 text-purple-600 font-semibold">
              <Network className="w-5 h-5 mr-2" />
              <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold mr-2">③</span>
              SWOTに基づく戦略
            </div>
            <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[3]?.trim()}</p>
          </div>

          <div className="bg-white shadow rounded-xl p-6 border-l-4 border-green-500 md:col-span-2 max-h-[400px] overflow-auto">
            <div className="flex items-center mb-3 text-green-600 font-semibold">
              <Users className="w-5 h-5 mr-2" />
              <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold mr-2">④</span>
              社員に求める行動や期待
            </div>
            <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[4]?.trim()}</p>
          </div>
        </div>
      )}

      <div className="mt-16 flex justify-center">
        <button
          onClick={() => router.push('/cascade')}
          className="bg-green-700 text-white px-8 py-3 text-base rounded-lg shadow hover:bg-green-800 transition font-medium"
        >
          戦略カスケードを生成する →
        </button>
      </div>
    </div>
  );
}

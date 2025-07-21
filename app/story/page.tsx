'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldAlert,
  Navigation,
  Network,
  Users,
} from 'lucide-react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';

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
  } = useStrategyStore();

  const { user } = useUserStore();

  const [localStory, setLocalStory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (story) setLocalStory(story);
  }, [story]);

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
        }),
      });

      const data = await res.json();
      setStory(data.story);
      setStrategySummary(data.summary);
      setLocalStory(data.story);
    } catch (err) {
      console.error('❌ ストーリー生成失敗:', err);
      setError('生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const parts = localStory.split('■');

  return (
    <div className="p-8 min-h-screen bg-gradient-to-b from-white to-blue-50">
      <h1 className="text-3xl font-semibold mb-6 text-gray-900 tracking-tight">戦略ストーリー</h1>

      {/* 生成ボタン（adminのみ） */}
      {isAdmin && (
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={generateStory}
            disabled={loading}
            className="bg-blue-700 text-white px-6 py-3 rounded-lg hover:bg-blue-800 transition text-sm font-medium"
          >
            {loading ? '生成中...' : '📘 ストーリー生成'}
          </button>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      )}

      {/* ストーリー表示 */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* ① 現状の危機や背景 */}
        <div className="bg-white shadow-lg rounded-xl p-6 border-l-4 border-red-500 max-h-[400px] overflow-auto">
          <div className="flex items-center mb-3 text-red-600 font-semibold text-base">
            <ShieldAlert className="w-5 h-5 mr-2" />
            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold mr-2">①</span>
            現状の危機や背景
          </div>
          <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[1]?.trim()}</p>
        </div>

        {/* ② 目指す方向性 */}
        <div className="bg-white shadow-lg rounded-xl p-6 border-l-4 border-blue-500 max-h-[400px] overflow-auto">
          <div className="flex items-center mb-3 text-blue-600 font-semibold text-base">
            <Navigation className="w-5 h-5 mr-2" />
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold mr-2">②</span>
            目指す方向性
          </div>
          <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[2]?.trim()}</p>
        </div>

        {/* ③ SWOT戦略 */}
        <div className="bg-white shadow-lg rounded-xl p-6 border-l-4 border-purple-500 max-h-[400px] overflow-auto">
          <div className="flex items-center mb-3 text-purple-600 font-semibold text-base">
            <Network className="w-5 h-5 mr-2" />
            <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold mr-2">③</span>
            SWOTに基づく戦略
          </div>
          <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[3]?.trim()}</p>
        </div>

        {/* ④ 社員への期待 */}
        <div className="bg-white shadow-lg rounded-xl p-6 border-l-4 border-green-500 md:col-span-2 max-h-[400px] overflow-auto">
          <div className="flex items-center mb-3 text-green-600 font-semibold text-base">
            <Users className="w-5 h-5 mr-2" />
            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold mr-2">④</span>
            社員に求める行動や期待
          </div>
          <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{parts[4]?.trim()}</p>
        </div>
      </div>

      {/* カスケードへの遷移 */}
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

'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import CascadeEditView from '@/components/CascadeEditView';
import CascadeVisualView from '@/components/CascadeVisualView';
import { Wand2, Edit3, LayoutPanelTop } from 'lucide-react';

export default function CascadePage() {
  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');

  const {
    story,
    strategySummary,
    thought,
    vision,
    mission,
    industry,
    revenue,
    employees,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    csvFinanceData,
    editableCascadeResult,
    setEditableCascadeResult,
    notification,
    setNotification,
  } = useStrategyStore();

  const handleGenerateCascade = async () => {
    setNotification('⏳ カスケード生成中...');
    try {
      const response = await fetch('/api/generate-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story,
          strategySummary,
          thought,
          vision,
          mission,
          industry,
          revenue,
          employees,
          value,
          strength,
          weakness,
          opportunity,
          threat,
          csvFinanceData,
          departments: editableCascadeResult,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setEditableCascadeResult(data.departments || []);
        setNotification('✅ カスケード生成に成功しました');
      } else {
        setNotification(`❌ 生成失敗: ${data.error}`);
      }
    } catch (err) {
      setNotification('❌ 通信エラーが発生しました');
    }
  };

  return (
    <main className="p-8 min-h-screen bg-gradient-to-b from-white to-gray-50">
      <h1 className="text-2xl font-semibold text-gray-800 text-center mb-4">
        戦略カスケード
      </h1>

      {/* ✅ 経営戦略の要約表示 */}
      {strategySummary && (
        <div className="bg-white shadow border-l-4 border-blue-600 rounded-md p-4 mb-6 max-w-4xl mx-auto">
          <h2 className="text-blue-700 font-semibold text-sm mb-2">経営戦略の要約</h2>
          <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">
            {strategySummary}
          </p>
        </div>
      )}

      {/* カスケード生成ボタン */}
      <div className="flex justify-center mb-6">
        <button
          onClick={handleGenerateCascade}
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded hover:bg-gray-700 transition text-sm"
        >
          <Wand2 className="w-4 h-4" />
          カスケードを生成
        </button>
      </div>

      {/* タブ切り替え */}
      <div className="flex justify-center gap-4 mb-6">
        <button
          onClick={() => setActiveTab('edit')}
          className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition border ${
            activeTab === 'edit'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
          }`}
        >
          <Edit3 className="w-4 h-4" />
          編集ビュー
        </button>
        <button
          onClick={() => setActiveTab('visual')}
          className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition border ${
            activeTab === 'visual'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
          }`}
        >
          <LayoutPanelTop className="w-4 h-4" />
          構造ビュー
        </button>
      </div>

      {/* 通知エリア */}
      {notification && (
        <div className="text-center text-sm text-gray-600 mb-4">
          {notification}
        </div>
      )}

      {/* ビュー切り替え */}
      {activeTab === 'edit' ? <CascadeEditView /> : <CascadeVisualView />}
    </main>
  );
}

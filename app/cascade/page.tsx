'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import CascadeEditView from '@/components/CascadeEditView';
import CascadeVisualView from '@/components/CascadeVisualView';

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
    setNotification,
  } = useStrategyStore();

  const handleGenerateCascade = async () => {
    setNotification('⏳ カスケード生成中...');
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
  };

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-blue-50 to-blue-100">
      <h1 className="text-2xl font-bold text-center mb-4 text-gray-800">戦略カスケード画面</h1>

      {/* ✅ カスケード生成ボタン */}
      <div className="flex justify-center mb-4">
        <button
          className="bg-green-600 text-white px-4 py-2 rounded-md text-sm"
          onClick={handleGenerateCascade}
        >
          🚀 戦略からカスケード生成
        </button>
      </div>

      {/* タブ切替 */}
      <div className="flex justify-center gap-4 mb-6">
        <button
          className={`px-4 py-2 rounded-md font-semibold text-sm ${
            activeTab === 'edit'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-blue-600 border border-blue-600'
          }`}
          onClick={() => setActiveTab('edit')}
        >
          ✏️ 編集ビュー
        </button>
        <button
          className={`px-4 py-2 rounded-md font-semibold text-sm ${
            activeTab === 'visual'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-blue-600 border border-blue-600'
          }`}
          onClick={() => setActiveTab('visual')}
        >
          🧱 構造ビュー
        </button>
      </div>

      {/* 通知表示 */}
      {useStrategyStore.getState().notification && (
        <div className="text-center text-sm text-green-700 mb-4">
          {useStrategyStore.getState().notification}
        </div>
      )}

      {/* タブごとのビュー */}
      {activeTab === 'edit' ? <CascadeEditView /> : <CascadeVisualView />}
    </main>
  );
}

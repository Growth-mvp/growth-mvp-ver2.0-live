'use client';
import Link from 'next/link';
import { useStrategyStore } from '../store/strategyStore';

export default function Sidebar() {
  const {
    saveToSupabase,
    loadFromSupabase,
    clearAllData,
    notification,
    setNotification,
  } = useStrategyStore();

  const handleSave = async () => {
    await saveToSupabase();
    setNotification('✅ データ保存に成功しました');
  };

  const handleLoad = async () => {
    await loadFromSupabase();
    setNotification('🔁 データ復元に成功しました');
  };

  const handleClear = async () => {
    await clearAllData();
    setNotification('🗑️ すべてのデータを削除しました');
  };

  return (
    <aside className="h-screen w-72 bg-gray-50 border-r shadow-lg flex flex-col justify-between p-6">
      <div>
        <h1 className="text-2xl font-bold text-blue-700 mb-8 tracking-tight">GROWTH</h1>
        <nav className="space-y-4 text-base font-medium text-gray-800">
          <Link href="/strategy" className="block hover:text-blue-600 transition">
            📝 経営情報入力
          </Link>
          <Link href="/story" className="block hover:text-blue-600 transition">
            📖 戦略ストーリー
          </Link>
          <Link href="/cascade" className="block hover:text-blue-600 transition">
            📐 カスケード生成
          </Link>
        </nav>

        <div className="mt-10 space-y-2">
          <button
            onClick={handleSave}
            className="w-full text-left px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
          >
            💾 保存
          </button>
          <button
            onClick={handleLoad}
            className="w-full text-left px-4 py-2 bg-green-100 text-green-700 rounded hover:bg-green-200 transition"
          >
            ♻️ 復元
          </button>
          <button
            onClick={handleClear}
            className="w-full text-left px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
          >
            🗑️ 全削除
          </button>
        </div>

        {notification && (
          <div className="mt-4 text-sm text-green-600">{notification}</div>
        )}
      </div>

      <div className="text-xs text-gray-400 mt-8">
        © 2025 GROWTH Strategy Platform
      </div>
    </aside>
  );
}

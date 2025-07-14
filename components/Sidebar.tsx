'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStrategyStore } from '../store/strategyStore';
import {
  FileText,
  BookOpen,
  Layers,
  Save,
  RefreshCcw,
  Trash2,
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
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
    <aside className="h-screen w-72 bg-gray-900 text-white flex flex-col justify-between p-6 shadow-xl">
      <div>
        <h1 className="text-2xl font-bold text-white mb-10 tracking-wide">GROWTH</h1>

        <nav className="space-y-3">
          <Link
            href="/strategy"
            className={`flex items-center gap-3 px-4 py-2 rounded-md ${
              pathname === '/strategy'
                ? 'bg-blue-600 text-white'
                : 'hover:bg-gray-800 text-gray-300'
            }`}
          >
            <FileText className="w-5 h-5" />
            経営情報入力
          </Link>

          <Link
            href="/story"
            className={`flex items-center gap-3 px-4 py-2 rounded-md ${
              pathname === '/story'
                ? 'bg-blue-600 text-white'
                : 'hover:bg-gray-800 text-gray-300'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            戦略ストーリー
          </Link>

          <Link
            href="/cascade"
            className={`flex items-center gap-3 px-4 py-2 rounded-md ${
              pathname === '/cascade'
                ? 'bg-blue-600 text-white'
                : 'hover:bg-gray-800 text-gray-300'
            }`}
          >
            <Layers className="w-5 h-5" />
            カスケード構造
          </Link>
        </nav>

        <div className="mt-10 space-y-2 text-sm">
          <button
            onClick={handleSave}
            className="w-full flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition"
          >
            <Save className="w-4 h-4" />
            保存
          </button>
          <button
            onClick={handleLoad}
            className="w-full flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded hover:bg-green-200 transition"
          >
            <RefreshCcw className="w-4 h-4" />
            復元
          </button>
          <button
            onClick={handleClear}
            className="w-full flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
          >
            <Trash2 className="w-4 h-4" />
            全削除
          </button>
        </div>

        {notification && (
          <div className="mt-4 text-sm text-green-400">{notification}</div>
        )}
      </div>

      <div className="text-xs text-gray-500 mt-8">
        © 2025 GROWTH Strategy Platform
      </div>
    </aside>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import {
  FileText,
  BookMarked,
  Share,
  Download,
  XOctagon,
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
    const confirmed = confirm('⚠ 本当にすべてのデータを削除しますか？');
    if (confirmed) {
      await clearAllData();
      setNotification('🗑️ すべてのデータを削除しました');
    }
  };

  // 通知は一定時間で自動クリア
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification('');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [notification, setNotification]);

  return (
    <aside className="h-screen w-72 bg-gray-900 text-white flex flex-col justify-between p-6 shadow-xl">
      <div>
        <h1 className="text-2xl font-bold mb-10 tracking-wide text-white">GROWTH</h1>

        {/* ナビゲーション */}
        <nav className="space-y-3">
          <SidebarLink
            href="/strategy"
            icon={<FileText className="w-5 h-5" />}
            label="経営情報入力"
            active={pathname === '/strategy'}
          />
          <SidebarLink
            href="/story"
            icon={<BookMarked className="w-5 h-5" />}
            label="戦略ストーリー"
            active={pathname === '/story'}
          />
          <SidebarLink
            href="/cascade"
            icon={<Share className="w-5 h-5" />}
            label="カスケード構造"
            active={pathname === '/cascade'}
          />
        </nav>

        {/* アクションボタン */}
        <div className="mt-10 space-y-2 text-sm">
          <ActionButton
            onClick={handleSave}
            icon={<Download className="w-4 h-4 text-white" />}
            label="保存"
            color="blue"
          />
          <ActionButton
            onClick={handleLoad}
            icon={<BookMarked className="w-4 h-4 text-white" />}
            label="復元"
            color="green"
          />
          <ActionButton
            onClick={handleClear}
            icon={<XOctagon className="w-4 h-4 text-white" />}
            label="全削除"
            color="red"
          />
        </div>

        {/* 通知表示 */}
        {notification && (
          <div
            className={`mt-4 text-sm px-3 py-2 rounded transition ${
              notification.includes('削除')
                ? 'bg-rose-100 text-rose-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {notification}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 mt-8">
        © 2025 GROWTH Strategy Platform
      </div>
    </aside>
  );
}

// ナビゲーションリンク
function SidebarLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-2 rounded-md transition ${
        active ? 'bg-sky-700 text-white' : 'hover:bg-gray-800 text-gray-300'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

// アクションボタン（保存・復元・削除）
function ActionButton({
  onClick,
  icon,
  label,
  color,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: 'blue' | 'green' | 'red';
}) {
  const baseStyle = 'w-full flex items-center gap-2 px-4 py-2 rounded-md transition transform hover:scale-[1.02] active:scale-95';
  const colorClasses = {
    blue: 'bg-sky-700 hover:bg-sky-800 text-white',
    green: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    red: 'bg-rose-600 hover:bg-rose-700 text-white',
  }[color];

  return (
    <button onClick={onClick} className={`${baseStyle} ${colorClasses}`}>
      {icon}
      {label}
    </button>
  );
}

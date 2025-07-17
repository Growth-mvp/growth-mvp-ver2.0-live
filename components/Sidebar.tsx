'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import LogoutButton from './LogoutButton'; // 🔹追加
import {
  FileText,
  BookMarked,
  Share,
  Activity,
  BarChart,
  Settings,
  Download,
  RotateCcw,
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

  const { user } = useUserStore();

  const handleSave = async () => {
    if (!user?.id) {
      setNotification('⚠️ ログインが必要です');
      return;
    }

    await saveToSupabase();
    setNotification('✅ データ保存に成功しました');
  };

  const handleLoad = async () => {
    if (!user?.id) {
      setNotification('⚠️ ログインが必要です');
      return;
    }

    await loadFromSupabase();
    setNotification('🔁 データ復元に成功しました');
  };

  const handleClear = async () => {
    if (!user?.id) {
      setNotification('⚠️ ログインが必要です');
      return;
    }

    const confirmed = confirm('⚠ 本当にすべてのデータを削除しますか？');
    if (confirmed) {
      await clearAllData();
      setNotification('🗑️ すべてのデータを削除しました');
    }
  };

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification, setNotification]);

  return (
    <aside className="h-screen w-72 bg-gray-900 text-white flex flex-col justify-between p-6 shadow-xl">
      <div>
        <h1 className="text-2xl font-bold mb-10 tracking-wide text-white">
          GROWTH<span className="text-sm text-gray-400 ml-1">戦略実行</span>
        </h1>

        <nav className="space-y-2">
          <SidebarLink href="/strategy" icon={<FileText />} label="経営情報入力" active={pathname === '/strategy'} />
          <SidebarLink href="/story" icon={<BookMarked />} label="戦略ストーリー" active={pathname === '/story'} />
          <SidebarLink href="/cascade" icon={<Share />} label="カスケード構造" active={pathname === '/cascade'} />
          <SidebarLink href="/execution" icon={<Activity />} label="OKR実行支援" active={pathname === '/execution'} />
          <SidebarLink href="/review" icon={<BarChart />} label="OKRレビュー" active={pathname === '/review'} />
          <SidebarLink href="/admin" icon={<Settings />} label="管理画面" active={pathname === '/admin'} />
        </nav>

        <div className="mt-8 space-y-2 text-sm">
          <ActionButton onClick={handleSave} icon={<Download size={16} />} label="保存" color="blue" />
          <ActionButton onClick={handleLoad} icon={<RotateCcw size={16} />} label="復元" color="green" />
          <ActionButton onClick={handleClear} icon={<Trash2 size={16} />} label="全削除" color="red" />
        </div>

        {notification && (
          <div
            className={`mt-4 text-sm px-3 py-2 rounded transition shadow ${
              notification.includes('削除')
                ? 'bg-rose-100 text-rose-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {notification}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 mt-8 space-y-2">
        <div>© 2025 GROWTH Platform</div>
        {user && <LogoutButton />} {/* 🔹 ログイン中のみ表示 */}
      </div>
    </aside>
  );
}

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
      <span>{label}</span>
    </Link>
  );
}

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
  const baseStyle =
    'w-full flex items-center gap-2 px-4 py-2 rounded-md transition transform hover:scale-[1.02] active:scale-95 shadow-sm';
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

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import LogoutButton from './LogoutButton';
import {
  FileText,
  BookOpen,
  Share,
  Activity,
  Settings,
  Download,
  RotateCcw,
  Trash2,
  Clock,
  CheckCircle,
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

  const { user, setUser } = useUserStore();

  const handleSave = async () => {
    if (!user) return setNotification('⚠️ ログインが必要です');
    await saveToSupabase();
    setNotification('✅ データ保存に成功しました');
  };

  const handleLoad = async () => {
    if (!user) return setNotification('⚠️ ログインが必要です');
    await loadFromSupabase();
    setNotification('🔁 データ復元に成功しました');
  };

  const handleClear = async () => {
    if (!user) return setNotification('⚠️ ログインが必要です');
    const confirmed = confirm('⚠ 本当にすべてのデータを削除しますか？');
    if (confirmed) {
      await clearAllData();
      setNotification('🗑️ すべてのデータを削除しました');
    }
  };

  useEffect(() => {
    const restoreUserFromCookie = async () => {
      if (!user) {
        const match = document.cookie.match(/user_id=([^;]+)/);
        if (match) {
          const userId = match[1];
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

          if (!error && data) {
            setUser({
              id: data.id,
              email: data.email ?? '',
              role: data.role ?? 'member',
              department: data.department ?? '',
              name: data.name ?? '未設定',
            });
          }
        }
      }
    };
    restoreUserFromCookie();
  }, [user, setUser]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification, setNotification]);

  return (
    <aside className="fixed top-0 left-0 z-50 min-h-screen w-72 bg-gray-900 text-white flex flex-col justify-between p-6 shadow-xl overflow-y-auto">
      <div>
        {/* ユーザー情報 */}
        {user && (
          <div className="mb-6 text-sm text-gray-300">
            <div className="mb-1">ログイン中: {user.email}</div>
            <LogoutButton />
          </div>
        )}

        {/* タイトル */}
        <h1 className="text-2xl font-bold mb-8 tracking-wide text-white">
          GROWTH<span className="text-sm text-gray-400 ml-1">戦略実行</span>
        </h1>

        {/* ナビゲーションリンク */}
        <nav className="space-y-2 text-sm">
          <SidebarLink href="/strategy" icon={<FileText size={16} />} label="第1章：この会社は何者か？" active={pathname === '/strategy'} />
          <SidebarLink href="/story-process" icon={<BookOpen size={16} />} label="第2章：未来を描く" active={pathname === '/story-process'} />
          <SidebarLink href="/cascade" icon={<Share size={16} />} label="第3章：各部門の役割" active={pathname === '/cascade'} />
          <SidebarLink href="/okr" icon={<CheckCircle size={16} />} label="第4章：物語を行動に" active={pathname === '/okr'} />
          <SidebarLink href="/execution" icon={<Activity size={16} />} label="最終章：本番の舞台へ" active={pathname === '/execution'} />
          <SidebarLink href="/story-history" icon={<Clock size={16} />} label="📚 ストーリー履歴" active={pathname === '/story-history'} />
          {user?.role === 'admin' && (
            <SidebarLink href="/admin" icon={<Settings size={16} />} label="管理者専用" active={pathname === '/admin'} />
          )}
        </nav>

        {/* アクションボタン群 */}
        <div className="mt-8 space-y-2 text-sm">
          <ActionButton onClick={handleSave} icon={<Download size={16} />} label="保存" color="blue" />
          <ActionButton onClick={handleLoad} icon={<RotateCcw size={16} />} label="復元" color="green" />
          <ActionButton onClick={handleClear} icon={<Trash2 size={16} />} label="全削除" color="red" />
        </div>

        {/* 通知エリア */}
        {notification && (
          <div
            role="alert"
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

      {/* フッター */}
      <div className="text-xs text-gray-500 mt-8">© 2025 GROWTH Platform</div>
    </aside>
  );
}

// サイドバーリンク
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
      className={`flex items-center gap-3 px-4 py-2 rounded-md transition text-sm ${
        active ? 'bg-sky-700 text-white' : 'hover:bg-gray-800 text-gray-300'
      }`}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

// アクションボタン
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
    'w-full flex items-center gap-2 px-4 py-2 rounded-md transition transform hover:scale-[1.02] active:scale-95 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2';
  const colorClasses = {
    blue: 'bg-sky-700 hover:bg-sky-800 text-white focus:ring-sky-400',
    green: 'bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-400',
    red: 'bg-rose-600 hover:bg-rose-700 text-white focus:ring-rose-400',
  }[color];

  return (
    <button onClick={onClick} className={`${baseStyle} ${colorClasses}`} tabIndex={0}>
      {icon}
      {label}
    </button>
  );
}

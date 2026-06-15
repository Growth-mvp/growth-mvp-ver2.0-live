'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import { useAccess } from '@/utils/access';
import LogoutButton from './LogoutButton';
import GlobalSidebarSaveStatus from './GlobalSidebarSaveStatus';
import {
  FileText,
  BookOpen,
  Share,
  Activity,
  Settings,
  CheckCircle,
  LogIn,
  UserPlus,
  LineChart,
  UsersRound,
  Menu,
  X,
} from 'lucide-react';

function AIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] items-center justify-center opacity-75">
      {children}
    </span>
  );
}

const ITEM_TEXT_CLASS = 'font-normal tracking-[0.01em] leading-6 text-[13.5px]';

export default function Sidebar() {
  const pathname = usePathname();

  const userStore = useUserStore();
  const user = userStore.user;

  const { canEditCompany } = useAccess();

  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isActive = (href: string) => {
    // /org-transformation は /org-transformation/shared の親パスでもあるため、
    // 前方一致にすると「違和感を伝えるルーム」と「全社すり合わせルーム」が同時に active になる。
    // そのため、組織変革トップだけは完全一致で判定する。
    if (href === '/org-transformation') {
      return pathname === '/org-transformation';
    }

    return pathname === href || pathname.startsWith(href + '/');
  };
  const adminDisabledVisual = !canEditCompany();

  const currentUserId: string | undefined = user?.id;

  return (
    <>
      {/* Mobile: Menu Button */}
      <button
        type="button"
        aria-label="メニューを開く"
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-[60] inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
      >
        <Menu size={18} strokeWidth={1.5} />
        メニュー
      </button>

      {/* Mobile: Backdrop */}
      <div
        className={[
          'lg:hidden fixed inset-0 z-[55] bg-black/30 transition-opacity',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={() => setOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={[
          'z-[56] h-full w-full bg-gray-50 border-r border-gray-200 shadow-sm text-gray-800 flex flex-col',
          'lg:translate-x-0',
          'fixed top-0 left-0 h-screen w-[16rem] max-w-[80vw] transition-transform duration-200 ease-out lg:static lg:h-full lg:max-w-none',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="lg:hidden shrink-0 flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="text-sm font-semibold tracking-wide text-gray-700">メニュー</div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setOpen(false)}
            className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="shrink-0 overflow-visible border-b border-gray-200 px-1 py-3">
          <Link href="/" aria-label="トップページへ" className="flex justify-center no-underline">
            <img
              src="/GROWTH SHIFT.png"
              alt="GROWTH Logo"
              className="block h-auto w-[270px] max-w-none object-contain transition-transform hover:scale-[1.02]"
            />
          </Link>
        </div>

        <div className="shrink-0 px-4 py-3 border-b border-gray-200">
          {user ? (
            <div className={`flex items-center justify-between gap-2 text-gray-600 ${ITEM_TEXT_CLASS}`}>
              <span className="truncate max-w-[10rem]">{user.email}</span>
              <LogoutButton />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <Link
                href="/login"
                className="no-underline inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-[12px] text-gray-800 shadow-sm hover:bg-gray-50"
              >
                <LogIn size={14} strokeWidth={1.5} />
                ログイン
              </Link>
              <Link
                href="/signup"
                className="no-underline inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-[12px] text-white shadow-sm hover:bg-black/90"
              >
                <UserPlus size={14} strokeWidth={1.5} />
                新規登録
              </Link>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-6 overscroll-contain">
          <nav className="space-y-[18px]" role="navigation" aria-label="メインナビゲーション">
            <PillLink
              href="/stage1"
              icon={<FileText size={18} strokeWidth={1.5} />}
              label="STAGE 1：企業価値分析"
              active={isActive('/stage1')}
            />
            <PillLink
              href="/stage2"
              icon={<BookOpen size={18} strokeWidth={1.5} />}
              label="STAGE 2：全社戦略"
              active={isActive('/stage2')}
            />
            <PillLink
              href="/cascade"
              icon={<Share size={18} strokeWidth={1.5} />}
              label="STAGE 3：事業・部門別戦略"
              active={isActive('/cascade')}
            />
            <PillLink
              href="/okr"
              icon={<CheckCircle size={18} strokeWidth={1.5} />}
              label="STAGE 4：実行計画策定"
              active={isActive('/okr')}
            />
            <PillLink
              href="/execution"
              icon={<Activity size={18} strokeWidth={1.5} />}
              label="STAGE 5：実行計画支援"
              active={isActive('/execution')}
            />
            <PillLink
              href="/stage6"
              icon={<LineChart size={18} strokeWidth={1.5} />}
              label="STAGE 6：業績シミュレーション"
              active={isActive('/stage6')}
            />
            <PillLink
              href="/org-transformation"
              icon={<UsersRound size={18} strokeWidth={1.5} />}
              label="組織変革・違和感を伝えるルーム"
              active={isActive('/org-transformation')}
            />
            <PillLink
              href="/org-transformation/shared"
              icon={<UsersRound size={18} strokeWidth={1.5} />}
              label="組織変革・全社すり合わせルーム"
              active={isActive('/org-transformation/shared')}
            />

            <div className="h-px bg-gray-200/50 my-4" />

            {/* ★STEP9: 出力・レポート */}
            <PillLink
              href="/report"
              icon={<FileText size={18} strokeWidth={1.5} />}
              label="レポート"
              active={pathname === '/report'}
            />

            <div className="h-px bg-gray-200/50 my-4" />

            <PillLink
              href="/admin/members"
              icon={<Settings size={18} strokeWidth={1.5} />}
              label="管理者専用"
              active={isActive('/admin/members')}
              disabled={adminDisabledVisual}
            />
          </nav>
        </div>

        <GlobalSidebarSaveStatus />

        <footer className={`shrink-0 border-t border-gray-200 px-4 py-3 text-gray-500 ${ITEM_TEXT_CLASS}`}>
          © 2025 GROWTH Platform
         
        </footer>
      </aside>
    </>
  );
}

function PillLink({
  href,
  icon,
  label,
  active,
  disabled,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={[
        'no-underline group flex h-10 items-center gap-2 rounded-full px-3 transition',
        ITEM_TEXT_CLASS,
        active
          ? 'bg-gray-900 text-white shadow hover:bg-black/90'
          : 'bg-white text-gray-800 hover:bg-white/90 shadow-sm border border-gray-200',
        'focus:outline-none focus:ring-1 focus:ring-black/10',
        disabled ? 'opacity-60 pointer-events-auto cursor-not-allowed' : '',
      ].join(' ')}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
    >
      <AIcon>{icon}</AIcon>
      <span className="truncate">{label}</span>
    </Link>
  );
}
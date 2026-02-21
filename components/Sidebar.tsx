// /components/Sidebar.tsx（修正版・storeアクション連動・/stage6統一・未使用整理）
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStrategyStore /*, refetchFromServer as refetchViaExport*/ } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAccess } from '@/utils/access';
import LogoutButton from './LogoutButton';
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
} from 'lucide-react';

/* ---------------- 小物 ---------------- */
function AIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] items-center justify-center opacity-75">
      {children}
    </span>
  );
}

/* 共通テキストクラス（Apple風：細め・字間少し広め・行間ゆったり・13.5px） */
const ITEM_TEXT_CLASS = 'font-normal tracking-[0.01em] leading-6 text-[13.5px]';

/* ---------------- 本体 ---------------- */
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // store
  const userStore = useUserStore();
  const user = userStore.user;
  const companyId = userStore.companyId;
  const hydratedUser = userStore.hydrated; // userStore 側のハイドレーション完了フラグ想定

  const { canView, canEditCompany } = useAccess();

  const [domHydrated, setDomHydrated] = useState(false);
  useEffect(() => setDomHydrated(true), []);

  const currentUserId: string | undefined = user?.id;

  /* ===== アクション ===== */

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const adminDisabledVisual = !canEditCompany();

  return (
    <aside
      className="fixed top-0 left-0 z-50 h-screen w-64 md:w-72
      bg-gray-50 border-r border-gray-200 shadow-sm
      text-gray-800 flex flex-col"
    >
      {/* ロゴ */}
      <div className="shrink-0 border-b border-gray-200 px-4 py-4">
        <Link href="/" aria-label="トップページへ" className="block no-underline">
          <img
            src="/growth-logo4.png"
            alt="GROWTH Logo"
            className="block mx-auto h-[60px] w-auto md:h-[140px] transition-transform hover:scale-[1.02]"
          />
        </Link>
      </div>

      {/* 認証行 */}
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

      {/* コンテンツ */}
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
            label="STAGE 2：経営戦略策定"
            active={isActive('/stage2')}
          />
          <PillLink
            href="/cascade"
            icon={<Share size={18} strokeWidth={1.5} />}
            label="STAGE 3：部門戦略策定"
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
          {/* 重要：/simulation ではなく /stage6 に統一 */}
          <PillLink
            href="/stage6"
            icon={<LineChart size={18} strokeWidth={1.5} />}
            label="STAGE 6：業績シミュレーション"
            active={isActive('/stage6')}
          />

          {/* 管理画面セクション区切り */}
          <div className="h-px bg-gray-200/50 my-4" />

          {/* 管理者 */}
          <PillLink
            href="/admin/members"
            icon={<Settings size={18} strokeWidth={1.5} />}
            label="管理者専用"
            active={isActive('/admin/members')}
            disabled={adminDisabledVisual}
          />
        </nav>

      </div>

      {/* フッター */}
      <footer className={`shrink-0 border-t border-gray-200 px-4 py-3 text-gray-500 ${ITEM_TEXT_CLASS}`}>
        © 2025 GROWTH Platform
        {currentUserId ? ` · uid:${String(currentUserId).slice(0, 6)}…` : ''}
      </footer>
    </aside>
  );
}

/* ============ 小物 ============ */
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

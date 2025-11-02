// /components/Sidebar.tsx（修正版・storeアクション連動）
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStrategyStore, refetchFromServer as refetchViaExport } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAccess } from '@/utils/access';
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
  CheckCircle,
  LogIn,
  UserPlus,
  LineChart,
} from 'lucide-react';

/* ---------------- ユーティリティ ---------------- */
const toStr = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);
const asArr = (v: any) => (Array.isArray(v) ? v : []);
const asObj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

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
  const s = useStrategyStore();
  const userStore = useUserStore();
  const { user, companyId, hydrated } = userStore;
  const { canView, canEditCompany } = useAccess();

  const [domHydrated, setDomHydrated] = useState(false);
  useEffect(() => setDomHydrated(true), []);

  const [notification, setNotification] = useState<string>('');

  const currentUserId: string | undefined = user?.id;

  /* ===== アクション ===== */
  const ensureMembershipOrRedirect = () => {
    if (!hydrated || !domHydrated) {
      setNotification('⏳ 権限を判定中です…');
      return false;
    }
    if (!user?.id) {
      setNotification('⚠️ ログインが必要です');
      router.push('/login');
      return false;
    }
    if (!companyId || !canView()) {
      setNotification('⚠️ 会社所属が未設定です。サインアップから参加してください。');
      router.push('/signup');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!ensureMembershipOrRedirect()) return;
    if (!canEditCompany()) {
      setNotification('⛔ 権限がありません（保存は管理者のみ）');
      return;
    }
    if (!companyId) {
      setNotification('⚠️ 会社IDが未確定です。サインアップ/所属設定をご確認ください。');
      return;
    }

    try {
      // store の revision 連動セーフセーブを使用
      await useStrategyStore.getState().saveStrategyData();
      setNotification('✅ サーバーへ保存しました');
    } catch (e) {
      console.error('❌ handleSave error:', e);
      setNotification('❌ 保存に失敗しました');
    }
  };

  const handleRefetch = async () => {
    if (!ensureMembershipOrRedirect()) return;
    const ok = confirm('ローカル変更を破棄しサーバー最新版を読み込みます。続行しますか？');
    if (!ok) return;

    try {
      // store の refetch（__isFetchingFromServer ガード付き）
      await useStrategyStore.getState().refetchFromServer();
      // もしくはエクスポートを使用: await refetchViaExport();
      setNotification('✅ サーバーから最新を取得しました');
    } catch (e) {
      console.error('❌ handleRefetch error:', e);
      setNotification('❌ 取得に失敗しました');
    }
  };

  const handleClear = async () => {
    if (!ensureMembershipOrRedirect()) return;
    if (!canEditCompany()) {
      setNotification('⛔ 権限がありません（全削除は管理者のみ）');
      return;
    }
    const ok = confirm('⚠ Supabase上の戦略データも含め、すべて削除します。よろしいですか？');
    if (!ok) return;

    try {
      await useStrategyStore.getState().deleteAllOnServer();
      // ローカルの永続もリセット（store側でやっているが保険で）
      localStorage.removeItem('strategy-store');
      setNotification('🗑 すべて削除しました');
    } catch (e) {
      console.error('❌ handleClear error:', e);
      setNotification('❌ 削除に失敗しました');
    }
  };

  useEffect(() => {
    if (!notification) return;
    const tm = setTimeout(() => setNotification(''), 4000);
    return () => clearTimeout(tm);
  }, [notification]);

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
        <nav className="space-y-1.5" role="navigation" aria-label="メインナビゲーション">
          <PillLink href="/strategy" icon={<FileText size={18} strokeWidth={1.5} />} label="STAGE 1：経営基本情報" active={isActive('/strategy')} />
          <PillLink href="/story-process" icon={<BookOpen size={18} strokeWidth={1.5} />} label="STAGE 2：経営戦略策定" active={isActive('/story-process')} />
          <PillLink href="/cascade" icon={<Share size={18} strokeWidth={1.5} />} label="STAGE 3：部門戦略策定" active={isActive('/cascade')} />
          <PillLink href="/okr" icon={<CheckCircle size={18} strokeWidth={1.5} />} label="STAGE 4：実行計画策定" active={isActive('/okr')} />
          <PillLink href="/execution" icon={<Activity size={18} strokeWidth={1.5} />} label="STAGE 5：実行計画支援" active={isActive('/execution')} />
          <PillLink href="/simulation" icon={<LineChart size={18} strokeWidth={1.5} />} label="STAGE 6：業績シミュレーション" active={isActive('/simulation')} />
          {/* 管理者 */}
          <PillLink
            href="/admin/members"
            icon={<Settings size={18} strokeWidth={1.5} />}
            label="管理者専用"
            active={isActive('/admin/members')}
            disabled={adminDisabledVisual}
          />
        </nav>

        {/* アクション */}
        <div className="space-y-1.5">
          <GhostAction onClick={handleSave} icon={<Download size={18} strokeWidth={1.5} />} label="サーバーへ保存" />
          <GhostAction onClick={handleRefetch} icon={<RotateCcw size={18} strokeWidth={1.5} />} label="サーバーから再取得" />
          <GhostAction onClick={handleClear} icon={<Trash2 size={18} strokeWidth={1.5} />} label="全削除" tone="destructive" />
        </div>

        {notification && (
          <div
            role="alert"
            className={`rounded-xl border px-3 py-2 shadow-sm ${ITEM_TEXT_CLASS} ${
              notification.includes('削除') || notification.includes('❌')
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {notification}
          </div>
        )}
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
        // ベース：角はやや丸、細字、13.5px、字間広め
        'no-underline group flex h-10 items-center gap-2 rounded-full px-3 transition',
        ITEM_TEXT_CLASS,
        // 状態
        active
          ? 'bg-gray-900 text-white shadow hover:bg-black/90'
          : 'bg-white text-gray-800 hover:bg-white/90 shadow-sm border border-gray-200',
        // アクセシビリティ
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

function GhostAction({
  onClick,
  icon,
  label,
  tone,
}: {
  onClick: () => void | Promise<void>;
  icon: React.ReactNode;
  label: string;
  tone?: 'destructive';
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'no-underline group flex h-10 w-full items-center gap-2 rounded-xl px-3 transition',
        ITEM_TEXT_CLASS,
        'border border-gray-200 bg-white hover:bg-white/90 shadow-sm',
        'focus:outline-none focus:ring-1 focus:ring-black/10',
        tone === 'destructive' ? 'text-rose-600' : 'text-gray-800',
      ].join(' ')}
    >
      <AIcon>{icon}</AIcon>
      <span className="truncate">{label}</span>
    </button>
  );
}

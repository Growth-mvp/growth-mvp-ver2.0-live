'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  X,
  Coffee,
} from 'lucide-react';

function AIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center text-zinc-600">
      {children}
    </span>
  );
}

const ITEM_TEXT_CLASS = 'font-normal tracking-[0.01em] leading-6 text-[14px]';
const ITEM_SUBTITLE_CLASS = 'font-normal tracking-[0.01em] text-[12px] leading-[1.3]';
const STAGE_LABEL_CLASS = 'font-medium tracking-[0.01em] text-[14px] leading-6 text-zinc-800';
const STAGE_NUM_CLASS = 'font-medium text-[13px] text-zinc-600';
const GROUP_TITLE_CLASS = 'px-3 pb-1 text-[12px] font-medium text-zinc-600';

/**
 * 開閉（モバイルのドロワー）は呼び出し側（app/layoutClient.tsx）が1か所で管理する。
 * onMobileClose は、ドロワー内で表示される閉じるボタンに渡す（PC側では渡さない）。
 */
export default function Sidebar({ onMobileClose }: { onMobileClose?: () => void }) {
  const pathname = usePathname();

  const userStore = useUserStore();
  const user = userStore.user;

  const { canEditCompany } = useAccess();

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

  const isPasswordPage = pathname === '/account/password';

  return (
    <>
      {/* Sidebar（モバイルでは呼び出し側のドロワー内に表示される） */}
      <aside className="z-[56] h-full w-full bg-zinc-50 border-r border-zinc-200 text-zinc-800 flex flex-col">
        {onMobileClose && (
        <div className="lg:hidden shrink-0 flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="text-[14px] font-medium text-zinc-800">メニュー</div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onMobileClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        )}

        <div className="shrink-0 overflow-visible border-b border-zinc-200 px-1 py-3">
          <Link href="/" aria-label="トップページへ" className="flex justify-center no-underline">
            <img
              src="/GROWTH SHIFT.png"
              alt="GROWTH Logo"
              className="block h-auto w-[235px] max-w-none object-contain transition-transform hover:scale-[1.02]"
            />
          </Link>
        </div>

        {!user && (
          <div className="shrink-0 px-4 py-3 border-b border-zinc-200 flex items-center justify-center gap-2">
            <Link
              href="/login"
              className="no-underline inline-flex h-9 items-center gap-1 rounded-xl border border-zinc-300 bg-white px-3 text-[13px] font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              <LogIn size={14} strokeWidth={1.5} />
              ログイン
            </Link>
            <Link
              href="/signup"
              className="no-underline inline-flex h-9 items-center gap-1 rounded-xl bg-accent-action px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <UserPlus size={14} strokeWidth={1.5} />
              新規登録
            </Link>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-5 overscroll-contain">
          <nav className="space-y-5" role="navigation" aria-label="メインナビゲーション">
            <div className="space-y-1">
              <div className={GROUP_TITLE_CLASS}>経営ステージ</div>
              <NavLink
                href="/stage0"
                stageNum="STAGE0"
                label="アイスブレイク"
                active={isActive('/stage0')}
              />
              <NavLink
                href="/stage1"
                stageNum="STAGE1"
                label="会社の現状はどうか"
                subtitle="企業価値分析"
                active={isActive('/stage1')}
              />
              <NavLink
                href="/stage2"
                stageNum="STAGE2"
                label="会社は何を目指すのか"
                subtitle="全社戦略"
                active={isActive('/stage2')}
              />
              <NavLink
                href="/cascade"
                stageNum="STAGE3"
                label="各部門の役割は何か"
                subtitle="事業・部門別戦略"
                active={isActive('/cascade')}
              />
              <NavLink
                href="/okr"
                stageNum="STAGE4"
                label="現場は何をするのか"
                subtitle="実行計画策定"
                active={isActive('/okr')}
              />
              <NavLink
                href="/execution"
                stageNum="STAGE5"
                label="どうやって前に進めるか"
                subtitle="実行支援"
                active={isActive('/execution')}
              />
              <NavLink
                href="/stage6"
                stageNum="STAGE6"
                label="成果を確かめる"
                subtitle="業績シミュレーション"
                active={isActive('/stage6')}
              />
            </div>

            <div className="h-px bg-zinc-200" />

            <div className="space-y-1">
              <div className={GROUP_TITLE_CLASS}>組織変革ルーム</div>
              <NavLink
                href="/org-transformation"
                icon={<UsersRound size={18} strokeWidth={1.5} />}
                label="組織変革・違和感を伝えるルーム"
                active={isActive('/org-transformation')}
              />
              <NavLink
                href="/org-transformation/shared"
                icon={<UsersRound size={18} strokeWidth={1.5} />}
                label="組織変革・全社すり合わせルーム"
                active={isActive('/org-transformation/shared')}
              />
            </div>

            <div className="h-px bg-zinc-200" />

            {/* ★STEP9: 出力・レポート */}
            <NavLink
              href="/report"
              icon={<FileText size={18} strokeWidth={1.5} />}
              label="経営計画書"
              active={isActive('/report')}
            />

            <div className="h-px bg-zinc-200" />

            <NavLink
              href="/admin/members"
              icon={<Settings size={18} strokeWidth={1.5} />}
              label="管理者専用"
              active={isActive('/admin/members')}
              disabled={adminDisabledVisual}
            />
          </nav>
        </div>

        <GlobalSidebarSaveStatus />

        {user && (
          <div className="shrink-0 border-t border-zinc-200 px-4 py-4 space-y-1.5">
            <div className="text-[12px] font-medium text-zinc-600 mb-1">アカウント</div>
            <div className="text-[12px] text-zinc-600 mb-3 truncate">{user.email}</div>
            <div className="space-y-1.5">
              <Link
                href="/account/password"
                className={`no-underline flex h-10 items-center justify-center rounded-xl text-[14px] font-medium transition-colors ${
                  isPasswordPage
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                アカウント設定
              </Link>
              <LogoutButton />
            </div>
          </div>
        )}

        <footer className="shrink-0 border-t border-zinc-200 px-4 py-3 text-[12px] text-zinc-600">
          © 2026 GROWTH SHIFT Platform

        </footer>
      </aside>
    </>
  );
}

function NavLink({
  href,
  icon,
  label,
  subtitle,
  stageNum,
  active,
  disabled,
}: {
  href: string;
  icon?: React.ReactNode;
  label: string;
  subtitle?: string;
  stageNum?: string;
  active: boolean;
  disabled?: boolean;
}) {
  const isStageLink = !!stageNum;
  const linkHeight = subtitle ? 'min-h-12 py-1.5' : 'h-10';
  const stageLabel = stageNum ? `${stageNum}｜${label}` : label;

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
        'no-underline group relative flex items-center gap-2 rounded-xl px-3 transition-colors',
        linkHeight,
        active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-700 hover:bg-zinc-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        disabled ? 'opacity-50 pointer-events-auto cursor-not-allowed' : '',
      ].join(' ')}
      aria-label={subtitle ? `${stageLabel} (${subtitle})` : stageLabel}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
    >
      {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent" />}
      {icon && <AIcon>{icon}</AIcon>}
      <div className="flex flex-col justify-center min-w-0">
        {isStageLink ? (
          <>
            <div className="flex items-baseline gap-1 truncate">
              <span className={`shrink-0 ${STAGE_NUM_CLASS} ${active ? 'text-zinc-900' : ''}`}>{stageNum}</span>
              <span className="text-zinc-400">｜</span>
              <span className={`truncate ${STAGE_LABEL_CLASS} ${active ? 'font-semibold text-zinc-900' : ''}`}>{label}</span>
            </div>
            {subtitle && (
              <span className={`truncate ${ITEM_SUBTITLE_CLASS} text-zinc-600`}>
                {subtitle}
              </span>
            )}
          </>
        ) : (
          <>
            <span className={`truncate ${ITEM_TEXT_CLASS} ${active ? 'font-semibold text-zinc-900' : ''}`}>{label}</span>
            {subtitle && (
              <span className={`truncate ${ITEM_SUBTITLE_CLASS} text-zinc-600`}>
                {subtitle}
              </span>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

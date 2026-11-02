export type ScreenArea =
  | 'home'
  | 'stage'
  | 'org'
  | 'plan'
  | 'admin'
  | 'auth'
  | 'account'
  | 'legal'
  | 'support'
  | 'legacy';

export type ScreenEntry = {
  id: string;
  pathname: string;
  label: string;
  area: ScreenArea;
  stage?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  navVisible: boolean;
  status: 'active' | 'redirect';
  lifecycle?: 'active' | 'legacy' | 'undetermined';
  helpEnabled?: boolean;
  requiredRole?: 'member' | 'manager' | 'admin';
  redirectTo?: string;
  note?: string;
};

export const SCREENS: readonly ScreenEntry[] = [
  { id: 'home', pathname: '/', label: 'トップページ', area: 'home', navVisible: true, status: 'active' },

  { id: 'stage0', pathname: '/stage0', label: 'STAGE0 アイスブレイク', area: 'stage', stage: 0, navVisible: true, status: 'active' },
  { id: 'stage1', helpEnabled: true, pathname: '/stage1', label: 'STAGE1 会社の現状はどうか', area: 'stage', stage: 1, navVisible: true, status: 'active' },
  { id: 'stage2', helpEnabled: true, pathname: '/stage2', label: 'STAGE2 会社は何を目指すのか', area: 'stage', stage: 2, navVisible: true, status: 'active' },
  { id: 'stage3', helpEnabled: true, pathname: '/cascade', label: 'STAGE3 各部門の役割は何か', area: 'stage', stage: 3, navVisible: true, status: 'active' },
  { id: 'stage3-redirect', lifecycle: 'legacy', pathname: '/stage3', label: 'STAGE3（旧ルート）', area: 'stage', stage: 3, navVisible: false, status: 'redirect', redirectTo: '/cascade' },
  { id: 'stage4', helpEnabled: true, pathname: '/okr', label: 'STAGE4 現場は何をするのか', area: 'stage', stage: 4, navVisible: true, status: 'active' },
  {
    id: 'stage4-page',
    lifecycle: 'undetermined',
    pathname: '/stage4',
    label: 'STAGE4 実行計画策定（ナビ外）',
    area: 'legacy',
    stage: 4,
    navVisible: false,
    status: 'active',
    note: '/okr とは別実装（594行）。ナビ未掲載。operationData の一部がこのパスを参照',
  },
  { id: 'stage5', helpEnabled: true, pathname: '/execution', label: 'STAGE5 どうやって前に進めるか', area: 'stage', stage: 5, navVisible: true, status: 'active' },
  { id: 'stage6', helpEnabled: true, pathname: '/stage6', label: 'STAGE6 成果を確かめる', area: 'stage', stage: 6, navVisible: true, status: 'active' },
  { id: 'strategy-redirect', lifecycle: 'legacy', pathname: '/strategy', label: '戦略（旧ルート）', area: 'legacy', navVisible: false, status: 'redirect', redirectTo: '/stage1' },
  {
    id: 'review',
    lifecycle: 'undetermined',
    pathname: '/review',
    label: 'OKRレビュー画面（旧）',
    area: 'legacy',
    navVisible: false,
    status: 'active',
    note: 'ナビ未掲載。見出しは「OKRレビュー画面」',
  },

  { id: 'org-personal', helpEnabled: true, pathname: '/org-transformation', label: '組織変革・違和感を伝えるルーム', area: 'org', navVisible: true, status: 'active' },
  { id: 'org-shared', helpEnabled: true, pathname: '/org-transformation/shared', label: '組織変革・全社すり合わせルーム', area: 'org', navVisible: true, status: 'active' },

  { id: 'plan-hub', helpEnabled: true, pathname: '/report', label: '経営計画書', area: 'plan', navVisible: true, status: 'active' },
  { id: 'plan-bank', helpEnabled: true, pathname: '/report/bank-plan', label: '銀行向け経営計画書', area: 'plan', navVisible: false, status: 'active' },
  { id: 'plan-shareholder', helpEnabled: true, pathname: '/report/shareholder-plan', label: '株主向け経営計画書', area: 'plan', navVisible: false, status: 'active' },
  { id: 'plan-employee', helpEnabled: true, pathname: '/report/employee-plan', label: '社員向け経営計画書', area: 'plan', navVisible: false, status: 'active' },
  {
    id: 'plan-midterm',
    lifecycle: 'undetermined',
    pathname: '/report/midterm-plan',
    label: '中期計画書（ナビ外）',
    area: 'legacy',
    navVisible: false,
    status: 'active',
    note: '内部リンクなし。生成・保存の経路に含まれない（調査）',
  },
  {
    id: 'plan-execution-report',
    pathname: '/report/execution-report',
    label: '戦略実行レポート',
    area: 'plan',
    navVisible: false,
    status: 'active',
    note: '/report/preview からのリダイレクト先',
  },
  { id: 'plan-stage2-strategy', pathname: '/report/stage2-strategy', label: '全社戦略書（STAGE2）', area: 'plan', navVisible: false, status: 'active' },
  {
    id: 'plan-stakeholder-select',
    lifecycle: 'legacy',
    pathname: '/report/stakeholder-select',
    label: '計画書の選択（旧）',
    area: 'plan',
    navVisible: false,
    status: 'redirect',
    redirectTo: '/report',
  },
  {
    id: 'plan-preview-redirect',
    lifecycle: 'legacy',
    pathname: '/report/preview',
    label: '計画書プレビュー（旧）',
    area: 'plan',
    navVisible: false,
    status: 'redirect',
    redirectTo: '/report/execution-report',
  },

  { id: 'admin-console', pathname: '/admin', label: '管理コンソール（戦略データ管理）', area: 'admin', requiredRole: 'admin', navVisible:false, status: 'active' },
  { id: 'admin-members', pathname: '/admin/members', label: '管理者専用：メンバー管理', area: 'admin', requiredRole: 'admin', navVisible:true, status: 'active' },
  { id: 'admin-invites', pathname: '/admin/invites', label: '招待', area: 'admin', requiredRole: 'admin', navVisible:false, status: 'active' },
  { id: 'admin-data', pathname: '/admin/data-management', label: 'データ管理', area: 'admin', requiredRole: 'admin', navVisible:false, status: 'active' },
  { id: 'admin-org-insights', pathname: '/admin/org-insights', label: '組織論点ダッシュボード', area: 'admin', requiredRole: 'admin', navVisible:false, status: 'active' },

  { id: 'login', pathname: '/login', label: 'ログイン', area: 'auth', navVisible: true, status: 'active' },
  { id: 'signup', lifecycle: 'legacy', pathname: '/signup', label: '新規登録（ログインへ）', area: 'auth', navVisible: true, status: 'redirect', redirectTo: '/login' },
  { id: 'signup-admin-redirect', lifecycle: 'legacy', pathname: '/signup/admin', label: '管理者登録（旧）', area: 'auth', navVisible: false, status: 'redirect', redirectTo: '/signup-admin' },
  { id: 'signup-admin', pathname: '/signup-admin', label: '管理者専用 新規会社登録', area: 'auth', navVisible: false, status: 'active' },
  { id: 'onboarding', lifecycle: 'undetermined', pathname: '/onboarding', label: '所属設定（オンボーディング）', area: 'auth', navVisible: false, status: 'active', note: '内部からのリンクは未確認' },
  { id: 'invite-accept', pathname: '/invite/accept', label: '招待の受け入れ', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-callback', pathname: '/auth/callback', label: 'ログイン処理中', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-welcome', pathname: '/auth/welcome', label: '初回ログイン（ようこそ）', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-set-password', pathname: '/auth/set-password', label: '初回パスワード設定', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-update-password', pathname: '/auth/update-password', label: 'パスワード更新', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-forgot-password', pathname: '/auth/forgot-password', label: 'パスワード再設定', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-resend-set-password', pathname: '/auth/resend-set-password', label: 'パスワード設定メールの再送', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-mfa-enroll', pathname: '/auth/mfa/enroll', label: '2段階認証の登録', area: 'auth', navVisible: false, status: 'active' },
  { id: 'auth-mfa-challenge', pathname: '/auth/mfa/challenge', label: '2段階認証の確認', area: 'auth', navVisible: false, status: 'active' },

  { id: 'account-password', pathname: '/account/password', label: 'アカウント設定（パスワード変更）', area: 'account', navVisible: true, status: 'active' },

  { id: 'support-forbidden', pathname: '/403', label: 'アクセス権限がありません', area: 'support', navVisible: false, status: 'active' },
  { id: 'support-contact', pathname: '/contact', label: 'お問い合わせ', area: 'support', navVisible: false, status: 'active' },
  { id: 'legal-terms', pathname: '/terms', label: '利用規約', area: 'legal', navVisible: false, status: 'active' },
  { id: 'legal-privacy', pathname: '/privacy', label: 'プライバシーポリシー', area: 'legal', navVisible: false, status: 'active' },
];

const BY_PATHNAME = new Map(SCREENS.map((s) => [s.pathname, s] as const));
const BY_ID = new Map(SCREENS.map((s) => [s.id, s] as const));

export function findScreenByPathname(pathname: string): ScreenEntry | null {
  return BY_PATHNAME.get(pathname) ?? null;
}

export function findScreenById(id: string): ScreenEntry | null {
  return BY_ID.get(id) ?? null;
}

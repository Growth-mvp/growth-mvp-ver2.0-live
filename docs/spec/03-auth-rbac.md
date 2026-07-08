# 03. 認証・マルチテナント・RBAC

本書は、認証（Supabase Auth）・マルチテナント（会社スコープ）・RBAC（権限マトリクスと API ガード）・招待・RLS/監査の実装を記述する。

- **関連**: エンドポイントごとの認証・認可分類は [07] §1、監査項目は [08] A〜D・K カテゴリを参照。

## 1. 認証（Supabase Auth）

- Supabase Auth（メール + パスワード）を使用。クライアントは `@supabase/ssr` / `auth-helpers-nextjs`。
- 主なクライアント:
  - `lib/supabaseClient.ts` … ブラウザ用
  - `lib/supabaseServer.ts` … サーバ用（`getServerUser` 等）
  - `lib/supabaseAdmin.ts` … `getSupabaseAdmin()`（Service Role、RLS バイパス。API でのみ使用）
- API 認証は主に **Bearer トークン**。`lib/server/rbacGuard.ts` の `getAuthUserIdFromBearer(admin, req)` が `Authorization: Bearer <token>` を検証して `userId` を返す。セッション系 API では `lib/authUtils.ts` の `getAuthenticatedUserIdWithVerification(req)` も使用する。

### 1.1 認証関連ページ・フロー

| ルート | 役割 |
|---|---|
| `/login` | ログイン |
| `/signup`, `/signup/admin`, `/signup-admin` | サインアップ（管理者初回含む） |
| `/auth/callback` | 認証コールバック（`CallbackClient`） |
| `/auth/set-password`, `/auth/resend-set-password` | パスワード設定/再送 |
| `/auth/welcome` | 初回ウェルカム |
| `/invite/accept` | 招待受諾（`InviteAcceptClient`） |
| `/onboarding` | オンボーディング（Step1〜5: 基本情報/ポートフォリオ/SWOT/財務/MVV/確認） |

### 1.2 会社プロビジョニング

- `POST /api/companies/provision` … サインアップ後に会社（`companies`）と `profiles`、初期 membership を用意し、会社選択 Cookie を設定する。Service Role で実行。

## 2. マルチテナント（会社スコープ）

- すべてのデータは **会社（`companies`）単位**で分離。`company_members` がユーザーと会社の関係（ロール・担当部門）を持つ。
- クライアントの現在会社は `store/userStore.ts`（`companyId` / `departmentId` / `role`）と `context/CompanyContext.tsx` が保持。
- 会社切替時は `utils/resetAll.ts` の `hardResetForCompanySwitch()` でストアを初期化し、別会社データの混入を防ぐ。
- Cookie による会社選択: `app/api/_session/set-company`, `set-cookie`。どちらも現在は認証済みユーザーのみ呼び出せる。`set-cookie` は許可された Cookie 名のみ設定する。

### 2.1 複数所属時の既定会社選択

ユーザーが複数会社に所属する場合の「既定会社」選択ロジック:
- サーバ: `pickOneMembershipServer(admin, userId)` … 優先度 `admin > manager > member`、同ロールなら `created_at` 新しい順。
- `requireMembership(admin, userId, companyId?)` … 指定会社の membership を取得。`department_id` 列が無い環境（エラーコード `42703`）へのフォールバックを内蔵。

## 3. RBAC（権限制御）

権限の**単一ソースは `lib/rbac.ts`**（UI/API 共用）。

### 3.1 ロール

`Role = 'admin' | 'manager' | 'member'`。重み: admin=3, manager=2, member=1（`roleWeight`）。

### 3.2 アクション（`Action`）と権限マトリクス（`getCapabilities`）

| Action | admin | manager | member |
|---|:---:|:---:|:---:|
| `members:invite` | ✓ | ✗ | ✗ |
| `members:updateRole` | ✓ | ✗ | ✗ |
| `members:remove` | ✓ | ✗ | ✗ |
| `strategy:edit`（MVV/SWOT/Story/Departments/Projects/OKR） | ✓ | ✓ | ✗ |
| `department:edit`（部門スコープ付き） | ✓ | ✓（自部門のみ） | ✗ |
| `department:delete` | ✓ | ✗ | ✗ |
| `progress:write`（progress_logs 書込） | ✓ | ✓ | ✓ |
| `agent:use`（CEOChat 利用） | ✓ | ✓ | ✓ |

> 注: `getCapabilities(null)` は member 相当（最小権限）にフォールバックする。

### 3.3 部門スコープ（Manager の制限）

`canEditDepartment(role, actorDeptId, targetDeptId)` / `canActionInDepartment(...)`:
- **admin**: 常に編集可。
- **manager**: `actorDeptId`（担当部門）が存在し、`targetDeptId` と一致するときのみ編集可。担当部門が無い場合は**安全側で不可**。
- **member**: 常に不可（編集系）。
- 部門削除（`department:delete`）は **admin のみ**。

## 4. API 層のガード（`lib/server/rbacGuard.ts`）

書き込み API は以下の関数で防御する（`server-only`）。

| 関数 | 役割 |
|---|---|
| `getAuthUserIdFromBearer(admin, req)` | Bearer トークンから `userId` を検証取得 |
| `requireMembership(admin, userId, companyId?)` | membership 取得（`department_id` 欠落フォールバックあり） |
| `pickOneMembershipServer(admin, userId)` | 複数所属時の既定 membership 選択 |
| `assertCapability(membership, action, {targetDeptId})` | capability 強制。部門系は部門スコープも判定。失敗時 `Error('forbidden')` |
| `assertMinRole(membership, minRole)` | 最低ロール要求（例: admin 限定） |
| `assertCompanyScopeByStrategyId(admin, membership, strategyId)` | `strategy_data.company_id` が membership と一致するか検証（クロステナント防止） |
| `assertDepartmentScope(membership, targetDepartmentId)` | manager を自部門に限定 |
| `requireUserMatch(authUserId, bodyUserId)` | 本人一致検証（自分の OKR のみ更新 等） |
| `resolveCompanyIdFromStrategyId(admin, strategyId)` | strategyId → companyId 解決 |

### 標準的な書き込み API の防御順序

```
1. getSupabaseAdmin()
2. getAuthUserIdFromBearer() → userId（無ければ 401）
3. requireMembership() / pickOneMembershipServer() → membership（無ければ 403）
4. assertCapability() / assertMinRole()（権限不足は 403）
5. assertCompanyScopeByStrategyId() / assertDepartmentScope()（スコープ外は 403）
6. 本処理
```

## 5. UI 側の権限利用

- `hooks/useCapabilities.ts` … 現在ロールから capability マップを取得（`getCapabilities` を利用）。
- `components/RoleGate.tsx` / `AccessGate.tsx` / `AuthGuards.tsx` / `app/StrategyGuard.tsx` … ロール・認証・戦略存在に応じた表示制御／リダイレクト。
- `app/admin/AdminGuard.tsx` … 管理者画面のガード。`app/403/page.tsx` が権限不足ページ。
- **UI 判定の唯一の真実は `userStore.role`**（membership のミラー）。プロフィール上の `role` は UI 判定に使わない（`userStore.ts` コメント）。

> ⚠️ **重要な前提（書込権限の強制点）**: 戦略データの保存（`strategy_data`/`okrs`/`progress_logs`）は **API（`rbacGuard`）を経由せず、クライアントから直接 DB へ書き込む**（[02] §1.1 ★）。
> したがって `strategy:edit` 等の **書込権限はここ（UI の capability 判定）と RLS の二段だけで担保**され、**サーバ API による強制は効かない**。
> UI 判定はバイパス可能（ブラウザから直接 `.from(...).update()` を投げられる）ため、**書込の最終防衛線は RLS のロール条件**になる。`20260628_fix_strategy_data_rls_role_control.sql` は存在するが、Stage4 保存との整合により PoC 適用はリスク受容扱い。実環境での適用状態と member 書込拒否は監査で確認する（[08] D-05・C-07）。

## 6. 招待（invite）

アプリ制御のトークンベース招待（Supabase Auth 招待は使わない）。テーブルは `company_invites`（`20260212130000_create_company_invites.sql`）。

- `email`, `role`（admin/manager/member）, `token_hash`(unique), `expires_at`, `accepted_at`, `accepted_by`, `created_by` を持ち、`(company_id, email) where accepted_at is null` で同一メール重複招待を防止。RLS 有効。
- 主要 API:
  - `POST /api/invites/create` … 32 byte ランダムトークン生成 → SHA ハッシュ保存 → 招待 URL 生成。`pickOneMembershipServer` で発行者権限を確認。
  - `POST /api/invites/accept` … 旧受諾 API。現実装は 410 Gone を返す。
  - `GET /api/invites/info`, `POST /api/invites/complete` … 招待情報確認と受諾完了。
  - `POST /api/admin/invite`, `POST /api/admin/members/invite` … 管理画面からの招待。
  - `POST /api/auth/link-invited-user` … 招待ユーザーと auth アカウントの紐付け。
- 関連ドキュメント: `docs/_md_dump/APP_INVITE_TOKEN_IMPLEMENTATION.md`, `INVITE_ACCEPT_FIX.md`。

## 7. RLS と監査

- 主要テーブルで Row Level Security を有効化する設計。RLS 検証は `scripts/rbac-check.sh` / `rbac-e2e-min.sh`、ドキュメントは `docs/_md_dump/RBAC_*.md` 群。
- AI 呼び出しは `agent_logs`（`lib/supabase/agentLogs.ts` `insertAgentLog`）に記録。重要操作の永続監査ログは `audit_logs`（`20260628_create_audit_logs_table.sql`）と `lib/server/auditLog.ts` を使用する。DB 適用状況・対象操作の網羅・一般ユーザーからの UPDATE/DELETE 拒否は監査対象（[08] K-01・K-02・K-05）。

---

## 変更履歴

| 日付 | 変更内容 | 変更者 |
|---|---|---|
| 2026-06-22 | 初版（基準コミット `f7b9c03`。以後セッション API 認証化・audit_logs の追記あり） | 仕様書作成（Claude Code） |
| 2026-07-06 | 表記統一（目的宣言・関連文書・旧08 参照の [08] 項目 ID への更新・変更履歴の追加） | ドキュメント整備（Claude Code） |

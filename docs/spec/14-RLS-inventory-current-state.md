# A-5 RLS 現状棚卸しレポート

**作成日**: 2026-06-28  
**ステータス**: 現状確認中（未修正）  
**担当**: セキュリティ改善タスク A-5  

## 1. 概要

Supabase Row Level Security (RLS) の現状を調査し、各テーブルの実装状況を棚卸しした。

### 調査対象テーブル

- companies
- company_members
- company_invites
- strategy_data
- okrs
- progress_logs
- profiles
- org_alignment 系テーブル（requests, shared_topics, insights, stage_reflection_candidates）

---

## 2. RLS 実装状況（テーブル別）

### A) 新規追加テーブル（RLS実装済み）

#### company_invites
- **RLS有効**: ✅ 有効
- **ポリシー**:
  - SELECT: ✅ admin_select_company_invites（admin のみ）
  - INSERT: ✅ admin_insert_company_invites（admin のみ）
  - UPDATE: ✅ admin_update_company_invites（admin のみ）
  - DELETE: ✅ admin_delete_company_invites（admin のみ）
- **テナント分離**: ✅ company_id による分離
- **role 制御**: ✅ admin role による書込制限
- **備考**: API層で token 検証を別途実施

#### okrs
- **RLS有効**: ✅ 有効（PHASE_2A_SUPABASE_MIGRATION.sql で定義）
- **ポリシー**:
  - SELECT: ✅ "Users can read okrs in their company"（全員読取）
  - INSERT: ✅ "Company admins can insert okrs"（admin のみ）
  - UPDATE: ✅ "Company admins can update okrs"（admin のみ）
  - DELETE: ✅ "Company admins can delete okrs"（admin のみ）
- **テナント分離**: ✅ user_companies テーブル経由（company_id チェック）
- **role 制御**: ✅ admin role による書込制限
- **備考**: user_companies テーブルの役割が重要（user ↔ company のマッピング）

#### org_alignment_insights
- **RLS有効**: ✅ 有効
- **ポリシー**:
  - SELECT: ✅ admin_select_org_alignment_insights（admin のみ）
  - INSERT: ✅ admin_insert_org_alignment_insights（admin のみ）
  - UPDATE: ✅ admin_update_org_alignment_insights（admin のみ）
  - DELETE: ✅ admin_delete_org_alignment_insights（admin のみ）
- **テナント分離**: ✅ company_id による分離
- **role 制御**: ✅ admin role による制限
- **備考**: 意思決定支援用テーブルのため admin のみアクセス

#### org_alignment_shared_topics
- **RLS有効**: ✅ 有効
- **ポリシー**:
  - SELECT: ✅ 2つのポリシー
    - "Admin can see all shared topics"（admin: draft/published 両方）
    - "Members can see published shared topics"（member: published 且つ company内 のみ）
  - INSERT: ✅ "Only admins can insert shared topics"（admin のみ）
  - UPDATE: ✅ "Only admins can update shared topics"（admin のみ）
  - DELETE: ❌ **明示的なポリシーなし**
- **テナント分離**: ✅ company_id による分離
- **role 制御**: ✅ admin による書込制限
- **課題**: DELETE ポリシーが未定義

#### org_alignment_requests
- **RLS有効**: ✅ 有効
- **ポリシー**:
  - SELECT: ✅ "member_select_own_org_alignment_requests"（自分または admin）
  - INSERT: ✅ "member_insert_org_alignment_requests"（requested_by = auth.uid()）
  - UPDATE: ✅ "admin_update_org_alignment_requests"（admin のみ）
  - DELETE: ❌ **明示的なポリシーなし**
- **テナント分離**: ✅ company_id による分離
- **role 制御**: ✅ member（insert）/ admin（update）による制限
- **課題**: DELETE ポリシーが未定義

#### org_alignment_stage_reflection_candidates
- **RLS有効**: ✅ 有効
- **ポリシー**:
  - SELECT: ✅ org_alignment_stage_reflection_candidates_select（company_id が members に存在）
  - INSERT: ✅ org_alignment_stage_reflection_candidates_insert（同上）
  - UPDATE: ✅ org_alignment_stage_reflection_candidates_update（同上）
  - DELETE: ✅ org_alignment_stage_reflection_candidates_delete（同上）
- **テナント分離**: ✅ company_id による分離
- **role 制御**: ⚠️ **role チェックなし** - company_id チェックのみ
- **課題**: admin/member の role による書込制御が不完全

### B) 基本テーブル（RLS状況未確認）

#### companies
- **CREATE TABLE 定義**: ❓ migration ファイルに見当たらず（初期セットアップ時の手動作成と推定）
- **RLS有効**: ❓ **確認待ち**
- **テナント分離**: ❓ **確認待ち**
- **role 制御**: ❓ **確認待ち**

#### company_members / memberships
- **CREATE TABLE 定義**: ❓ migration ファイルに見当たらず
- **RLS有効**: ❓ **確認待ち**
- **role 定義**: 複数の場所で参照（company_members.role, memberships.role）
- **課題**: company_members と memberships の両方が使われている（正規化問題）

#### strategy_data
- **CREATE TABLE 定義**: ❓ migration ファイルに見当たらず
- **RLS有効**: ❓ **確認待ち**
- **スクリプト**: diag_policies.sql で診断スクリプト存在
- **課題**: okrs テーブルとの同期状態追跡あり（okrs_migration_status）

#### progress_logs
- **CREATE TABLE 定義**: ❓ migration ファイルに見当たらず
- **RLS有効**: ❓ **確認待ち**
- **拡張**: okrs テーブル連携用に okr_id カラム追加（PHASE_2A_SUPABASE_MIGRATION.sql）
- **課題**: RLS 定義確認必要

#### profiles
- **CREATE TABLE 定義**: ❓ migration ファイルに見当たらず
- **RLS有効**: ❓ **確認待ち**
- **用途**: ユーザープロフィール（auth.users との関連）

---

## 3. 発見された課題と要修正候補

### 🔴 **優先度High - DELETE ポリシー不足**

| テーブル | 状況 | 影響 |
|---------|------|------|
| org_alignment_shared_topics | DELETE ポリシーなし | レコード削除時に権限チェックなし → 任意削除可能か |
| org_alignment_requests | DELETE ポリシーなし | レコード削除時に権限チェックなし → 任意削除可能か |

**対応策候補**:
- admin のみ削除可能なポリシー追加
- Soft delete 導入（is_deleted フラグ）

---

### 🟡 **優先度Medium - role による書込制御の不完全性**

| テーブル | 状況 | 影響 |
|---------|------|------|
| org_alignment_stage_reflection_candidates | role チェックなし | admin/member の役割に基づく制御がない → member が管理者権限で変更可能か |

**対応策候補**:
- admin role チェックを UPDATE/DELETE ポリシーに追加
- member role は SELECT 限定に変更検討

---

### 🟡 **優先度Medium - 基本テーブルの RLS 確認待ち**

| テーブル | 課題 | 影響範囲 |
|---------|------|---------|
| companies | CREATE TABLE 定義未発見、RLS状況未確認 | テナント管理の基盤 |
| company_members | CREATE TABLE 定義未発見、RLS状況未確認 | 多くのテーブルで FK 参照 |
| strategy_data | RLS 定義未確認 | OKR 統合の中心テーブル |
| progress_logs | RLS 定義未確認 | 進捗追跡の重要テーブル |
| profiles | RLS 定義未確認 | ユーザー関連データ保護 |

---

### 🟢 **優先度Low - 正規化問題（非RLS）**

- **company_members** と **memberships** の両方が使われている → マッピング ロジック複雑化の可能性
- **user_companies** テーブルの役割が重要だが、定義が migration ファイルに見当たらない

---

## 4. Supabase で実行すべき確認 SQL

### セット1: すべてのテーブルの RLS 有効化状況確認

```sql
-- RLS有効化状態の一覧表示
SELECT
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

**期待結果**: 上記で RLS有効 ✅ と記載したテーブルが rowsecurity = true となること

---

### セット2: 各テーブルのポリシー一覧

```sql
-- すべてのテーブルのポリシー確認
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd as operation,  -- SELECT, INSERT, UPDATE, DELETE
  roles,
  qual as using_condition,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**期待結果**: SELECT, INSERT, UPDATE, DELETE ポリシーが定義されていることを確認

**特に確認すべき点**:
- org_alignment_shared_topics に DELETE ポリシーあるか
- org_alignment_requests に DELETE ポリシーあるか
- org_alignment_stage_reflection_candidates に role チェックあるか

---

### セット3: 基本テーブルの CREATE TABLE 定義確認

```sql
-- companies テーブルの定義
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'companies'
ORDER BY ordinal_position;

-- company_members テーブルの定義
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'company_members'
ORDER BY ordinal_position;

-- strategy_data テーブルの RLS ポリシー
SELECT
  policyname,
  permissive,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'strategy_data'
ORDER BY policyname;

-- progress_logs テーブルの RLS ポリシー
SELECT
  policyname,
  permissive,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'progress_logs'
ORDER BY policyname;

-- profiles テーブルの RLS ポリシー
SELECT
  policyname,
  permissive,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;
```

---

### セット4: テナント分離の確認（company_id レベル）

```sql
-- user_companies テーブルの存在と構造確認
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'user_companies'
ORDER BY ordinal_position;

-- memberships / company_members の関係確認
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('memberships', 'company_members', 'user_companies')
  AND table_schema = 'public';
```

---

### セット5: DELETE ポリシー確認

```sql
-- DELETE ポリシーが定義されているテーブル一覧
SELECT
  tablename,
  COUNT(*) as delete_policy_count
FROM pg_policies
WHERE cmd = 'DELETE'
GROUP BY tablename
ORDER BY tablename;

-- org_alignment_shared_topics の DELETE ポリシー確認
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'org_alignment_shared_topics'
  AND cmd = 'DELETE';

-- org_alignment_requests の DELETE ポリシー確認
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'org_alignment_requests'
  AND cmd = 'DELETE';
```

---

## 5. テナント越境テスト設計

### 前提条件

- **テスト環境**: 開発環境 Supabase インスタンス
- **テストユーザー**: 
  - Company A の admin（user_a_admin）
  - Company A の member（user_a_member）
  - Company B の admin（user_b_admin）
  - Company B の member（user_b_member）
  - 会社未所属ユーザー（user_no_company）

### テスト1: SELECT権限のテナント分離確認

#### T1-1: strategy_data のテナント分離

```
【実行】
- user_a_admin: SELECT * FROM strategy_data WHERE company_id = 'Company A ID'
- user_b_admin: SELECT * FROM strategy_data WHERE company_id = 'Company A ID'
- user_no_company: SELECT * FROM strategy_data WHERE company_id = 'Company A ID'

【期待結果】
- user_a_admin: Company A のデータのみ読取可能 → OK
- user_b_admin: 結果0件（Company B のデータのみ読取可能） → OK
- user_no_company: 401/403 エラー（権限なし） → OK
```

#### T1-2: okrs テーブルのテナント分離

```
【実行】
- user_a_admin: SELECT * FROM okrs WHERE company_id = 'Company A ID'
- user_a_member: SELECT * FROM okrs WHERE company_id = 'Company A ID'
- user_b_admin: SELECT * FROM okrs WHERE company_id = 'Company A ID'

【期待結果】
- user_a_admin: 読取可能 → OK
- user_a_member: 読取可能 → OK
- user_b_admin: 結果0件（Company B のデータのみ） → OK
```

#### T1-3: company_invites のテナント分離

```
【実行】
- user_a_admin: SELECT * FROM company_invites WHERE company_id = 'Company A ID'
- user_a_member: SELECT * FROM company_invites WHERE company_id = 'Company A ID'
- user_b_admin: SELECT * FROM company_invites WHERE company_id = 'Company A ID'

【期待結果】
- user_a_admin: 読取可能 → OK
- user_a_member: 結果0件（非admin なため） → OK
- user_b_admin: 結果0件（Company B のデータのみ） → OK
```

---

### テスト2: INSERT権限の role 制御確認

#### T2-1: okrs テーブル への INSERT

```
【実行】
- user_a_admin: INSERT INTO okrs (company_id, strategy_id, ...) VALUES (...)
- user_a_member: INSERT INTO okrs (company_id, strategy_id, ...) VALUES (...)
- user_b_admin: INSERT INTO okrs (company_id='Company A ID', ...) VALUES (...)

【期待結果】
- user_a_admin: 挿入成功 → OK
- user_a_member: RLS エラー（admin のみ） → OK
- user_b_admin: RLS エラー（Company B のみ） → OK
```

#### T2-2: company_invites への INSERT

```
【実行】
- user_a_admin: INSERT INTO company_invites (company_id, email, ...) VALUES (...)
- user_a_member: INSERT INTO company_invites (company_id, email, ...) VALUES (...)

【期待結果】
- user_a_admin: 挿入成功 → OK
- user_a_member: RLS エラー（admin のみ） → OK
```

---

### テスト3: UPDATE権限の role 制御確認

#### T3-1: okrs テーブルの UPDATE

```
【実行】
- user_a_admin: UPDATE okrs SET objective = '...' WHERE id = 'OKR A ID'
- user_a_member: UPDATE okrs SET objective = '...' WHERE id = 'OKR A ID'
- user_b_admin: UPDATE okrs SET objective = '...' WHERE id = 'OKR A ID'

【期待結果】
- user_a_admin: 更新成功 → OK
- user_a_member: RLS エラー（admin のみ） → OK
- user_b_admin: RLS エラー（Company B のみ） → OK
```

---

### テスト4: DELETE権限の role 制御確認（修正後）

#### T4-1: org_alignment_shared_topics の DELETE

```
【実行】
- user_a_admin: DELETE FROM org_alignment_shared_topics WHERE id = '...'
- user_a_member: DELETE FROM org_alignment_shared_topics WHERE id = '...'
- user_b_admin: DELETE FROM org_alignment_shared_topics WHERE id = '...' (Company A のレコード)

【期待結果】
- user_a_admin: 削除成功 → OK
- user_a_member: RLS エラー（admin のみ） → OK
- user_b_admin: RLS エラー（Company B のみ） → OK
```

---

### テスト5: API層での認証テスト（Bearer トークン）

#### T5-1: /api/stage5/assist-execution（既に実装済み）

```
【実行】
- curl -X POST /api/stage5/assist-execution -H "Authorization: Bearer <invalid>"
- curl -X POST /api/stage5/assist-execution -H "Authorization: Bearer <valid_user_no_company>"
- curl -X POST /api/stage5/assist-execution -H "Authorization: Bearer <valid_user_with_company>" -d '{"memo":"..."}'

【期待結果】
- 無効トークン: 401 Unauthorized → OK
- トークン有効だが非会員: 403 Forbidden → OK
- トークン有効で会員: 200 OK with assist result → OK
```

---

## 6. 推奨される次のステップ

1. **Supabase 管理画面での確認**（本レポート セット1～5 実行）
   - 基本テーブルの RLS 状況を把握
   - 不足ポリシーを特定

2. **migration ファイルの作成**（詳細は A-5別文書）
   - 不足ポリシーの追加
   - role による書込制御の強化
   - DELETE ポリシーの定義

3. **テナント越境テストの実施**（本レポート セット実施）
   - RLS が正しく機能しているか確認
   - Admin/Member の権限分離を検証

4. **API層との整合性確認**
   - Bearer 認証と RLS の相互作用を確認
   - Middleware で追加の権限チェックが必要か検討

---

## 7. 参考資料

- Supabase RLS ドキュメント: https://supabase.com/docs/guides/auth/row-level-security
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- プロジェクト診断スクリプト: `scripts/sql/diag_policies.sql`
- OKR テーブル定義: `docs/phase2a/PHASE_2A_SUPABASE_MIGRATION.sql`

---

**最終更新**: 2026-06-28  
**ステータス**: 現状確認完了。修正は別タスク（A-5後続フェーズ）で実施予定。

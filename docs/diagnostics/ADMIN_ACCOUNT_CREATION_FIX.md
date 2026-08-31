# GROWTH 初期管理者アカウント作成 修正ガイド

## 修正内容サマリー

### 根本原因
初期ユーザー作成時に `/api/companies/provision` エンドポイントが以下を実行していなかった：
1. **profile の存在確認** - なければ作成
2. **company_members への登録** - INSERT が失敗していた可能性
3. **エラーハンドリング** - 詳細なログが不足

### 修正内容

#### 1. `/app/api/companies/provision/route.ts` の改善

**追加：profile の事前確認と作成**
```typescript
// ★重要：profile の存在確認・作成（FK エラー回避）
const profileRes = await ensureProfileExists(admin, userId!);
if (!(profileRes as any).ok) {
  console.warn('[provision] profile check failed', { userId, detail: (profileRes as any).detail });
}
```

**改善：company_members の INSERT**
- `upsert` から `insert` に変更（重複時の挙動を明確化）
- `.select('*').single()` で結果を確認
- department_id カラム不在時の自動リトライ
- 詳細なエラーログを追加

```typescript
let insMember = await admin
  .from('company_members')
  .insert([{ company_id: companyId, user_id: userId!, role: 'admin', ... }])
  .select('*')
  .single();
```

**追加：役割（role）の返却**
- レスポンスに `role: 'admin'` を含める
- フロントが role を信頼して使用できるように

#### 2. `/app/auth/welcome/page.tsx` の改善

**追加：provision からの role を反映**
```typescript
const provisionedRole = j.role && typeof j.role === 'string' ? j.role : 'admin';
console.info('[auth/welcome] company created', { companyId, role: provisionedRole, via: j.via });
setRole(provisionedRole);
```

---

## 検証手順

### 環境準備
1. Supabase コンソールで以下の確認：
   - `profiles` テーブルが存在すること
   - `companies` テーブルの `created_by` カラムが存在すること
   - `company_members` テーブルが存在すること

2. ローカル開発環境：
   ```bash
   npm run dev
   # または
   yarn dev
   ```

### テストケース 1: 新規ユーザーの管理者アカウント作成

#### シナリオ
新しいメールアドレスで初回登録し、管理者として会社を作成する。

#### 手順

**STEP 1: 新規ユーザー登録（Auth ユーザーの作成）**
```
1. http://localhost:3000/signup-admin にアクセス
2. 以下を入力：
   - メールアドレス: test-admin-20250507@example.com
   - パスワード: TestPassword123!
   - 会社名: テスト会社 20250507
3. [アカウント作成] をクリック
```

**期待される動作:**
- ✅ Auth ユーザーが作成される
- ✅ メール確認（email_confirmed_at に値が入る）
- ✅ /api/companies/provision が呼ばれる
- ✅ ステータス: 200 OK, { ok: true, companyId: "...", role: "admin" }

**STEP 2: Supabase 側で確認**

```sql
-- A) Auth ユーザーの確認
SELECT id, email, email_confirmed_at, last_sign_in_at
FROM auth.users
WHERE email = 'test-admin-20250507@example.com';
-- 期待: id が存在、email_confirmed_at に値あり

-- B) profiles テーブルの確認
SELECT id, created_at
FROM profiles
WHERE id = '(上記のid)';
-- 期待: 行が存在

-- C) companies テーブルの確認
SELECT id, name, created_by, created_at
FROM companies
WHERE name LIKE 'テスト会社%';
-- 期待:
--   - id が存在（UUID）
--   - created_by に user_id が入っている（NULL ではない）
--   - created_at に値あり

-- D) company_members テーブルの確認
SELECT company_id, user_id, role, created_at
FROM company_members
WHERE user_id = '(Auth ユーザーの id)';
-- 期待:
--   - 1 行存在
--   - role = 'admin'
--   - company_id が companies テーブルの id と一致

-- E) strategy_data テーブルの確認
SELECT id, company_id, user_id, created_at
FROM strategy_data
WHERE company_id = '(companies の id)';
-- 期待:
--   - 1 行存在
--   - company_id が companies の id と一致
```

**STEP 3: フロント側で確認**

1. **ブラウザのコンソール**
   - DevTools → Console で以下のログを確認：
   ```
   [provision] begin
   [provision] company created successfully { userId: "...", companyId: "...", created_by: "..." }
   [provision] company_members insert successful { userId: "...", companyId: "...", role: "admin" }
   [provision] success (fallback) { companyId: "...", strategyId: "...", role: "admin" }
   ```

2. **レスポンス確認**
   - Network タブで `/api/companies/provision` を確認
   - Status: 200
   - Response:
   ```json
   {
     "ok": true,
     "companyId": "uuid-here",
     "strategyId": "uuid-here",
     "role": "admin",
     "via": "fallback",
     "strategySeeded": true
   }
   ```

3. **画面遷移**
   - ✅ `/admin` 画面に遷移
   - ✅ 管理者メニューが表示される
   - ✅ company_id の cookie が設定されている

---

### テストケース 2: 既存ユーザーの再ログイン

#### シナリオ
すでに company_members に登録されているユーザーが再度ログインする場合。

#### 手順

**STEP 1: ログイン**
```
1. http://localhost:3000/login にアクセス
2. 上記で作成したメール・パスワードでログイン
```

**期待される動作:**
- ✅ ログイン成功
- ✅ `/api/companies/provision` が呼ばれる
- ✅ ステータス: 200 OK, { ok: true, companyId: "...", role: "admin", note: "already_in_company" }

**STEP 2: コンソール確認**
```
[provision] begin
[provision] already_in_company { userId: "...", companyId: "...", role: "admin" }
[provision] seed ok (already_in_company) { companyId: "...", strategyId: "..." }
[provision] success (already_in_company) { companyId: "...", strategyId: "...", role: "admin" }
```

---

### テストケース 3: エラーケース（デバッグ用）

#### CASE A: profile が自動作成されない場合の確認

**チェック方法:**
1. Supabase Console → SQL Editor で実行：
```sql
-- 不正な user_id を確認（profile がない）
SELECT id FROM auth.users
WHERE id NOT IN (SELECT id FROM profiles);
```

**修正:**
- 自動作成ロジックが working しているか確認
- logs で `profile check failed` が出ていないか確認

#### CASE B: company_members INSERT が失敗する場合

**デバッグ:**
1. ブラウザのコンソールで以下を確認：
```
[provision] company_members_insert_failed {
  error_code: "...",
  error_message: "...",
  error_details: "..."
}
```

**考えられる原因:**
- `companies` テーブルの `company_id` が存在しない（FK 制約違反）
- `user_id` が profiles にない（FK 制約違反）
- `role` カラムの CHECK 制約エラー（'admin' 以外の値）
- テーブルが存在しない（42P01）
- department_id カラムが存在しない（42703）

**対応:**
- ログから error_code を確認
- FK 制約: 先に companies / profiles が正しく作成されているか確認
- CHECK 制約: role の値を確認
- カラム存在: スキーマ確認

#### CASE C: strategy_data の seed 失敗

**デバッグ:**
```
[provision] seed failed on fallback {
  userId: "...",
  companyId: "...",
  error: { code: "...", message: "..." }
}
```

**考えられる原因:**
- `company_id` が companies に存在しない
- `user_id` が profiles に存在しない
- UNIQUE 制約違反（同じ company_id で複数行）
- RLS ポリシー エラー

**対応:**
- テーブル FK を確認
- company_id の一意性を確認

---

## DB 側の推奨改善（オプション）

以下は既存データを確認してから実行してください。

### 制約追加

```sql
-- company_members に一意制約を追加（重複防止）
ALTER TABLE company_members
ADD CONSTRAINT company_members_unique_company_user
UNIQUE (company_id, user_id);

-- company_members.role に CHECK 制約を追加（値の制限）
ALTER TABLE company_members
ADD CONSTRAINT company_members_role_check
CHECK (role IN ('admin', 'manager', 'member'));

-- strategy_data に一意制約を追加（1社1行）
ALTER TABLE strategy_data
ADD CONSTRAINT strategy_data_unique_company
UNIQUE (company_id);

-- companies.created_by に NOT NULL を追加（デフォルト防止）
ALTER TABLE companies
ALTER COLUMN created_by SET NOT NULL;
```

### インデックス追加（クエリ高速化）

```sql
CREATE INDEX idx_company_members_user_id
ON company_members(user_id);

CREATE INDEX idx_company_members_company_id
ON company_members(company_id);

CREATE INDEX idx_strategy_data_company_id
ON strategy_data(company_id);
```

---

## トラブルシューティング

### Issue: 「needs_membership」エラーで会社作成できない

**原因:**
- `allowCreateCompany` が false になっている
- または `x-growth-provision-mode: create` ヘッダーが設定されていない

**解決:**
- signup-admin ページから作成しているか確認
- Authorization bearer token が正しいか確認

### Issue: role が 'member' のままになっている

**原因:**
- `company_members` に role='member' で登録されている
- または provision レスポンスの role を反映していない

**解決:**
- 手動で company_members の role を 'admin' に変更：
```sql
UPDATE company_members
SET role = 'admin'
WHERE user_id = '(user_id)'
AND company_id = '(company_id)';
```

### Issue: company.created_by が NULL になっている

**原因:**
- 古い会社レコード（修正前に作成）
- または RPC 経由で作成された可能性

**解決:**
```sql
-- 修正
UPDATE companies
SET created_by = (
  SELECT user_id FROM company_members
  WHERE company_id = companies.id
  AND role = 'admin'
  LIMIT 1
)
WHERE created_by IS NULL;
```

---

## ログ確認コマンド

### Supabase Function Logs（if using RPC）

```bash
supabase functions list
supabase functions logs provision_company
```

### Local Development Console

ブラウザの DevTools → Console で以下のパターンを検索：

- ✅ `[provision] success` - 成功
- ⚠️ `[provision] warn` - 警告（seed 失敗など）
- ❌ `[provision] error` - エラー（重要）
- ℹ️ `[provision]` - 全ログ

---

## まとめ

修正後、新規ユーザーが admin を作成すると：

1. ✅ Auth.users に行が作成
2. ✅ profiles に行が作成
3. ✅ companies に行が作成（created_by = user_id）
4. ✅ company_members に行が作成（role = 'admin'）
5. ✅ strategy_data に初期行が作成
6. ✅ フロント Store に companyId / role='admin' が反映
7. ✅ 管理者画面（/admin）にアクセス可能

既存ユーザーがログインすると：

1. ✅ company_members から既存の companyId / role を取得
2. ✅ strategy_data の seed を確認
3. ✅ フロント Store に反映
4. ✅ 元の機能をすべて使用可能

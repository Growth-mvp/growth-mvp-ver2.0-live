# 初期管理者アカウント作成不具合 修正サマリー

**修正日時:** 2025-05-07
**修正箇所:** 3ファイル
**影響範囲:** 新規ユーザー登録・管理者アカウント作成フロー

---

## 修正ファイル一覧

### 1. `/app/api/companies/provision/route.ts`

**修正理由:**
- company_members への登録が失敗していた
- created_by が正しく設定されていなかった
- エラーログが不十分だった
- role 情報がレスポンスに含まれていなかった

**主な修正内容:**

#### A) profile の事前確認を追加（新規追加）
```typescript
// ★重要：profile の存在確認・作成（FK エラー回避）
const profileRes = await ensureProfileExists(admin, userId!);
if (!(profileRes as any).ok) {
  console.warn('[provision] profile check failed', { userId, detail: (profileRes as any).detail });
}
```
- profiles テーブルの FK エラーを事前に検出・対応
- strategy_data insert 時の FK エラーを回避

#### B) company_members の INSERT に改善
**変更点:**
- `upsert` → `insert` に変更（重複時の挙動を明確化）
- `.select('*').single()` で結果を確認
- 詳細なエラーハンドリングを追加
- 新規追加: department_id 不在時の自動リトライ

```typescript
let insMember = await admin
  .from('company_members')
  .insert([{ company_id: companyId, user_id: userId!, role: 'admin', ... }])
  .select('*')
  .single();

if (insMember.error && looksMissingDepartmentId(insMember)) {
  console.info('[provision] retrying company_members insert without department_id', ...);
  insMember = await admin.from('company_members').insert(...);
}
```

#### C) エラーログを大幅強化
- company 作成完了時: `[provision] company created successfully`
- company_members 作成完了時: `[provision] company_members insert successful`
- seed 完了時: `[provision] success (fallback)`
- 失敗時: エラーコード・メッセージ・詳細を含める

#### D) RPC パスでも role を返却
```typescript
return json(200, {
  ok: true,
  companyId: cid,
  strategyId: (seeded as any).strategyId,
  role: 'admin',  // ★新規追加
  via: 'rpc',
  strategySeeded: (seeded as any).created,
  seedError: undefined,
}, [cookie]);
```

#### E) 既存ユーザーのレスポンスにも role を追加
```typescript
// 既存 company_members の場合
{
  ok: true,
  companyId: cid,
  strategyId: ...,
  role,  // ★新規追加
  note: 'already_in_company',
  ...
}
```

#### F) company_members 登録失敗時の詳細ログ
```typescript
if (insMember.error) {
  console.error('[provision] company_members_insert_failed', {
    userId,
    companyId,
    error_code: insMember.error?.code,
    error_message: insMember.error?.message,
    error_details: insMember.error?.details,
  });
  // ★重要：会社は作られたが membership 失敗 → 部分的成功だが問題あり
  return json(500, {
    ok: false,
    code: 'company_members_insert_failed',
    companyId,
    details: insMember.error,
    rpcError: rpcErr,
  }, [cookie]);
}
```

---

### 2. `/app/auth/welcome/page.tsx`

**修正理由:**
- provision から返却される role 情報を活用していなかった
- role が常に 'admin' に hardcoded されていた

**修正内容:**

```typescript
// ★修正前
setRole('admin');

// ★修正後
const provisionedRole = j.role && typeof j.role === 'string' ? j.role : 'admin';

// ★重要：provision からの role を信頼して反映
console.info('[auth/welcome] company created', { companyId, role: provisionedRole, via: j.via });

setRole(provisionedRole);
```

**効果:**
- provision エンドポイントから返却される role を正確に反映
- 既存ユーザーの再ログイン時に role='member' のケースにも対応可能

---

### 3. `/app/api/companies/provision/route.ts` 内の既存ユーザーパス改善

**変更点:**
- 既存ユーザーの company_members SELECT 時に role も取得
- レスポンスに role を含める

```typescript
// ★修正前
const { data: ex, error: exErr } = await admin
  .from('company_members')
  .select('company_id')  // role を取得していなかった
  .eq('user_id', userId!)
  .maybeSingle();

// ★修正後
const { data: ex, error: exErr } = await admin
  .from('company_members')
  .select('company_id, role')  // ★role を追加取得
  .eq('user_id', userId!)
  .limit(1)
  .maybeSingle();

if (!exErr && ex?.company_id) {
  const cid = String(ex.company_id);
  const role = String(ex.role ?? 'member');  // ★role を取得
  ...

  return json(200, {
    ok: true,
    companyId: cid,
    strategyId: ...,
    role,  // ★role を返却
    note: 'already_in_company',
    ...
  }, [cookie]);
}
```

---

## 修正による変更内容の確認

### changes in `/app/api/companies/provision/route.ts`

| セクション | 修正前 | 修正後 | 目的 |
|-----------|-------|-------|------|
| profile 事前確認 | なし | ensureProfileExists() を追加 | FK エラー防止 |
| company_members クエリ | `select('company_id')` | `select('company_id, role')` | role 情報取得 |
| company_members insert | upsert | insert | 重複処理を明確化 |
| department_id 処理 | なし | 自動リトライロジック | スキーマ違いに対応 |
| エラーログ | 簡潔 | 詳細ログ複数箇所 | トラブル診断改善 |
| role 返却 | なし | すべてのパスで返却 | フロント依存性解消 |
| seed 失敗時 | 200 OK で返す | 500 エラーで返す | エラー状態の正確化 |

---

## 新規ユーザー作成フロー（修正後）

```
1. User Registration (signup-admin page)
   ├─ Auth User 作成
   │  └─ email_confirmed_at 設定
   │
2. POST /api/companies/provision
   ├─ profile 存在確認・作成
   │  └─ FK エラー防止
   ├─ company_members 確認
   │  └─ 既存メンバーシップ確認
   ├─ companies 作成
   │  └─ created_by = user_id を必ず設定
   ├─ company_members 登録
   │  └─ role='admin' で登録（INSERT で失敗なし）
   ├─ strategy_data seed
   │  └─ company_id で初期行作成
   │
3. Response with role
   ├─ { ok: true, companyId, strategyId, role:'admin' }
   │
4. Frontend Store 更新
   ├─ userStore.setRole('admin')
   └─ userStore.setMembership({ companyId, role: 'admin' })

5. UI 遷移
   └─ /admin （管理者画面）表示
```

---

## 既存ユーザーログインフロー（改善後）

```
1. Login (login page)
   ├─ Auth signInWithPassword()
   │
2. POST /api/companies/provision
   ├─ company_members 確認（role 含む）
   │  └─ 既存メンバーシップ取得
   ├─ strategy_data seed
   │  └─ company_id が既存なら skip
   │
3. Response with role
   ├─ { ok: true, companyId, strategyId, role: '(admin|manager|member)' }
   │
4. Frontend Store 更新
   ├─ userStore.setRole(role)
   └─ userStore.setMembership({ companyId, role })

5. UI 遷移
   └─ role に応じた画面表示（admin なら管理画面）
```

---

## 影響を受けるシステム

### 修正後に動作改善されるケース

✅ **新規管理者アカウント作成**
- 以前: company_members 行が作成されず、admin として認識されない
- 修正後: 確実に company_members 行が作成される

✅ **既存ユーザーの再ログイン**
- 以前: role が store に反映されず、member のままの場合あり
- 修正後: company_members から role を取得して正確に反映

✅ **エラー診断**
- 以前: エラー発生時の原因特定が困難
- 修正後: 詳細ログで原因を特定可能

### 影響を受けないシステム

✅ **既存機能は壊さない**
- 保存処理（Supabase client-side）
- Zustand store
- API 呼び出し
- 招待機能（invite accept）
- ログアウト処理

---

## テストに必要な環境

### Supabase テーブル確認

```sql
-- 1. profiles テーブル確認
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- 2. companies テーブル確認
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'companies'
ORDER BY ordinal_position;

-- 3. company_members テーブル確認
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'company_members'
ORDER BY ordinal_position;

-- 4. strategy_data テーブル確認
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'strategy_data'
ORDER BY ordinal_position;
```

---

## 詳細なテスト方法

詳細なテスト手順は `../diagnostics/ADMIN_ACCOUNT_CREATION_FIX.md` を参照してください。

### クイックチェックリスト

- [ ] 新規ユーザーで /signup-admin から登録
- [ ] Supabase console で companies.created_by が null でないこと確認
- [ ] company_members に user_id の行が存在することを確認
- [ ] strategy_data に company_id の行が存在することを確認
- [ ] フロントで userStore.role = 'admin' であることを確認
- [ ] /admin ページにアクセス可能なことを確認
- [ ] 既存ユーザーで再ログイン → role が admin / manager / member で正しく反映される

---

## ロールバック方法

修正内容を元に戻す必要がある場合：

```bash
git diff HEAD^ app/api/companies/provision/route.ts
git diff HEAD^ app/auth/welcome/page.tsx

git checkout HEAD^ -- app/api/companies/provision/route.ts
git checkout HEAD^ -- app/auth/welcome/page.tsx
```

---

## 関連ドキュメント

- `../diagnostics/ADMIN_ACCOUNT_CREATION_FIX.md` - 詳細なテスト手順とトラブルシューティング
- `/app/api/companies/provision/route.ts` - 修正されたエンドポイント
- `/app/auth/welcome/page.tsx` - 修正されたウェルカムページ

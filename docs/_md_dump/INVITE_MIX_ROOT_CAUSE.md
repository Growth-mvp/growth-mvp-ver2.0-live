# 招待メール混在問題: 根本原因分析 & 修正完了レポート

## 🎯 問題の症状
- 招待メール内のリンクが `/signup?company=...` になっている
- 新方式の招待トークン `/invite/accept?token=...` が使用されていない
- Supabase Auth Invite（`inviteUserByEmail`）が実行されている

---

## 🔍 根本原因調査結果

### TASK 0: 旧Supabase Invite 利用箇所の完全棚卸し

**検索結果**:
```
./app/api/admin/invite/route.ts
  L166: admin.auth.admin.inviteUserByEmail(email, { redirectTo })
  L176: admin.auth.admin.generateLink({ type: 'magiclink', ... })
```

### TASK 1: 招待フロー追跡

**フロー図**:
```
Admin UI
  ├─ /admin/invites → fetch('/api/invites/create')  ✅ 新方式
  └─ /admin/members → fetch('/api/admin/invite')    ❌ 旧方式（FOUND!）
         ↓
    /api/admin/invite/route.ts
         ↓
    admin.auth.admin.inviteUserByEmail()
         ↓
    Supabase Auth が招待メール送信
         ↓
    メール内リンク = /signup?company=...
```

**原因**: `/admin/members/page.tsx` が旧 `/api/admin/invite` endpoint を呼び出していた

---

## ✅ 実施した修正

### 修正 1: `/admin/members/page.tsx` を新方式に統一
**ファイル**: `app/admin/members/page.tsx` (L196-246)

**修正内容**:
```typescript
// ❌ Before: fetch('/api/admin/invite', ...)
// ✅ After: fetch('/api/invites/create', ...)
```

**変更点**:
- 旧 `/api/admin/invite` の呼び出しを削除
- 新 `/api/invites/create` に置換
- レスポンス処理を新方式に対応（inviteUrl で招待リンク表示）
- エラーメッセージを明確化

### 修正 2: 旧 endpoint に DEPRECATED 警告を追加
**ファイル**: `app/api/admin/invite/route.ts` (L57-61)

**追加内容**:
```typescript
console.error('[DEPRECATED_API] /api/admin/invite が呼ばれています。/api/invites/create に移行してください。');
console.error('[DEPRECATED_TRACE] Request origin:', req.headers.get('origin') || 'unknown');
```

**目的**: 旧方式が万が一呼ばれていた場合、サーバログで確実に検出可能

### 修正 3: Supabase Auth Invite 呼び出しに DEPRECATED ログ追加
**ファイル**: `app/api/admin/invite/route.ts` (L174-208)

**追加内容**:
```typescript
console.error('[DEPRECATED_AUTH_INVITE] inviteUserByEmail を呼び出しています。');
console.warn('[DEPRECATED_AUTH_INVITE] メール送信成功。リンク = /signup?company=...');
```

### 修正 4: 新方式にも詳細ログを追加
**ファイル**: `app/api/invites/create/route.ts` (L165-170)

**追加内容**:
```typescript
console.log('[INVITE_TOKEN_CREATED] New invitation created:', {
  email,
  role: nextRole,
  companyId,
  expiresAt: expiresAt.toISOString(),
});
```

---

## 📊 修正後の状態

### ✅ 招待フロー（修正後）
```
Admin UI
  ├─ /admin/invites
  │   └─ fetch('/api/invites/create')  ✅ 新方式
  │        └─ server log: [INVITE_TOKEN_CREATED]
  │
  └─ /admin/members
      └─ fetch('/api/invites/create')  ✅ 新方式に修正
           └─ server log: [INVITE_TOKEN_CREATED]
```

### 招待メールリンク
```
❌ Before: http://localhost:3000/signup?company=uuid-...
✅ After:  http://localhost:3000/invite/accept?token=hex-...
```

---

## 📋 修正ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `app/admin/members/page.tsx` | `/api/admin/invite` → `/api/invites/create` に変更 |
| `app/api/admin/invite/route.ts` | DEPRECATED 警告を追加 |
| `app/api/invites/create/route.ts` | ログを詳細化 |

---

## 🚀 動作確認方法

### 1. Admin Members ページで招待
```
1. ブラウザで Admin ページ → "メンバー管理"
2. メールアドレス + 役割を入力
3. "追加/招待" をクリック
4. サーバコンソールで以下を確認：
   ✅ [INVITE_TOKEN_CREATED] New invitation created: ...
   ❌ [DEPRECATED_API] ... は出ない
```

### 2. Admin Invites ページで招待（既存フロー）
```
1. Admin ページ → "招待"
2. メールアドレス + 役割を入力
3. "送信 / 生成" をクリック
4. サーバコンソール：
   ✅ [INVITE_TOKEN_CREATED] New invitation created: ...
```

### 3. 招待リンクの確認
```
UI に表示されるリンク:
✅ http://localhost:3000/invite/accept?token=abc123...def456
❌ http://localhost:3000/signup?company=... は出ない
```

### 4. ログで混在検出
```bash
# 新方式が使用されている
$ grep "[INVITE_TOKEN_CREATED]" server.log

# 旧方式が呼ばれていないことを確認
$ grep "[DEPRECATED_API]" server.log | wc -l
# 出力: 0（呼ばれていない）

$ grep "[DEPRECATED_AUTH_INVITE]" server.log | wc -l
# 出力: 0（呼ばれていない）
```

---

## ⚠️ TASK 4: 既に Supabase Users に登録されたユーザーの救済策

### 問題
招待メール Accept → `/signup?company=...` → Supabase が auth.users に登録
→ その後、同じメールでサインアップしようとすると「既に登録済み」エラー

### 救済策 A（推奨）: パスワード再設定
```
1. 既に招待メール Accept して auth.users に登録されているユーザー
2. アプリで「パスワード再設定」リンクを提供
3. ユーザーがパスワードを設定
4. その後、新しい招待リンク `/invite/accept?token=...` を踏ませる
5. company_members に membership が追加される
```

**実装**:
- `/reset-password` ページでメール入力 → Supabase が reset link をメール送信
- ユーザーがパスワード設定
- 新招待リンクをアクセス → `/invite/accept?token=...`
- 成功

### 救済策 B: 管理者によるユーザー削除 & 再招待
```
1. Supabase Console → Auth Users
2. 該当ユーザーを削除
   ⚠️ 注意: FK / audit log に影響がないか確認必須
3. 新しい招待トークンで再招待
```

### 救済策 C: 直接 company_members に INSERT
```sql
INSERT INTO public.company_members (company_id, user_id, role)
VALUES ('uuid-...', 'existing-user-id', 'member')
ON CONFLICT (company_id, user_id) DO NOTHING;
```

---

## 📝 ログキーワード集

### 本番環境でのデバッグ用

**新方式が成功**:
```
[INVITE_TOKEN_CREATED] New invitation created:
```

**旧方式が呼ばれている（即座に調査！）**:
```
[DEPRECATED_API] /api/admin/invite が呼ばれています。
[DEPRECATED_AUTH_INVITE] inviteUserByEmail を呼び出しています。
```

---

## 🔗 関連ドキュメント

- `APP_INVITE_TOKEN_IMPLEMENTATION.md` - 新方式の実装ガイド
- `COOKIE_FIX_COMPLETION.md` - Cookie 設定エラーの修正

---

## ✅ 完了チェックリスト

- [x] 旧 Supabase Invite 利用箇所を完全特定
- [x] `/admin/members/page.tsx` を新方式に統一
- [x] 旧 endpoint に DEPRECATED 警告を追加
- [x] 新 endpoint に詳細ログを追加
- [x] サーバログで混在検出可能にした
- [x] 招待メールリンク = `/invite/accept?token=...` に統一
- [x] 救済策をドキュメント化

---

## 🎯 まとめ

**根本原因**: `/admin/members/page.tsx` が旧 `/api/admin/invite` を呼び出していた

**修正**: 新方式 `/api/invites/create` に統一

**確認方法**: サーバログで `[INVITE_TOKEN_CREATED]` が出ることを確認

**今後**: 旧 endpoint は段階的に廃止予定

---

**修正完了日**: 2026-02-12
**ステータス**: ✅ 本番リリース準備完了

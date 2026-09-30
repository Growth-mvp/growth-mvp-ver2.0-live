# アプリ招待トークン方式 実装ガイド

## 概要

Supabase Auth invite を廃止し、アプリ側で管理する**トークンベースの招待システム**に移行しました。

### メリット
- 招待の期限管理（7日間有効）
- 招待の取消・再発行が容易
- メール一致による乗っ取り防止
- 監査ログの記録が可能
- RLS競合エラーの回避

---

## 1. 実装内容

### DB テーブル: `company_invites`
`supabase/migrations/20260212130000_create_company_invites.sql`

**カラム**:
- `id`: UUID (主キー)
- `company_id`: 会社ID (FK)
- `email`: 招待メールアドレス
- `role`: 役割 ('member', 'manager', 'admin')
- `token_hash`: トークンのSHA-256ハッシュ（DB保存用）
- `expires_at`: 招待有効期限（7日間）
- `accepted_at`: 受け入れ時刻（NULL=未使用）
- `accepted_by`: 受け入れたユーザーID
- `created_by`: 招待作成者ID
- `created_at`: 作成日時

**RLS**: Admin のみがアクセス可能

---

### API エンドポイント

#### 1. `POST /api/invites/create` - 招待を作成

**認可**: Admin role 必須

**リクエスト**:
```json
{
  "email": "user@example.com",
  "role": "member",
  "companyId": "uuid..."
}
```

**レスポンス**:
```json
{
  "ok": true,
  "inviteUrl": "https://app.example.com/invite/accept?token=...",
  "email": "user@example.com",
  "role": "member",
  "expiresAt": "2026-02-19T13:30:00Z",
  "companyId": "uuid..."
}
```

**エラー**:
- `401`: 認証なし
- `403`: Admin 権限なし
- `409`: メール重複（既に招待済み）
- `500`: サーバエラー

---

#### 2. `POST /api/invites/accept` - 招待を受け入れる

**認可**: ログイン必須 + メール一致

**リクエスト**:
```json
{
  "token": "..."
}
```

**レスポンス**:
```json
{
  "ok": true,
  "companyId": "uuid...",
  "role": "member",
  "email": "user@example.com"
}
```

**エラー**:
- `401`: 認証なし
- `404`: トークン不正
- `410`: 期限切れ / 既使用
- `403`: メール不一致
- `500`: サーバエラー

---

### フロント画面

#### 1. `/admin/invites` - 招待作成UI
- 管理者が招待を作成
- 招待リンクをコピーして共有

#### 2. `/invite/accept?token=...` - 招待受け入れ
- 未ログイン → `/login?redirectTo=...` へ誘導
- ログイン済み → API で受け入れ処理
- 成功時 → `/` へ遷移

#### 3. `/signup` - 通常のサインアップ
- 招待と関連なくサインアップ可能
- 成功時 → `/auth/welcome` へ遷移

---

## 2. テスト手順

### 前提条件
- Supabase migration を実行済み
- 開発環境でアプリ起動

### Step 1: DB migration を実行

```bash
# Supabase CLI がインストール済みの場合
supabase migration up

# または Supabase Dashboard のSQL エディタで直接実行
# supabase/migrations/20260212130000_create_company_invites.sql の内容をコピペ
```

### Step 2: Admin で招待を作成

1. **ブラウザA**: `/admin` でログイン（Admin ユーザー）
2. **ナビゲーション**: "招待" をクリック → `/admin/invites`
3. **入力**:
   - メール: `newuser@example.com`
   - 役割: `member`
   - ボタン: "送信 / 生成"
4. **結果**: 招待リンクが表示される
   ```
   https://localhost:3000/invite/accept?token=abc123...
   ```

### Step 3: 招待を受け入れる（新規ユーザー）

1. **ブラウザB**: シークレットモード / 別プロファイル を開く
2. **ステップ2で取得した招待リンク** をアクセス
3. **未ログイン画面** → ログイン画面へ自動遷移
4. **サインアップ**:
   - メール: `newuser@example.com`
   - パスワード: `password123`
5. **成功**: ホーム（`/`）へ遷移
6. **確認**: `company_members` に新しい行が追加されている

### Step 4: 同じ招待を2回使用（期限切れテスト）

1. **同じトークン** を再度使用
2. **エラー**: "This invitation has already been accepted"
3. ✅ 期待通り：使用済み招待は拒否される

### Step 5: メール不一致テスト

1. **別ユーザーでログイン** (例: `other@example.com`)
2. **招待リンク** にアクセス
3. **エラー**: "This invitation is for newuser@example.com, but you are logged in as other@example.com"
4. ✅ 期待通り：メール不一致は拒否される

### Step 6: 期限切れテスト（開発用）

1. **DB 直接編集** (開発環境のみ):
   ```sql
   UPDATE public.company_invites
   SET expires_at = NOW() - INTERVAL '1 day'
   WHERE email = 'newuser@example.com';
   ```
2. **新しいブラウザ** で招待リンクをアクセス
3. **エラー**: "This invitation has expired"
4. ✅ 期待通り：期限切れは拒否される

### Step 7: 管理者ページで招待を再確認

1. **ブラウザA** (Admin) で `/admin/invites` を開く
2. **テーブル or ログ** で招待履歴を確認
   - `created_by`: Admin ユーザーID
   - `accepted_by`: 受け入れたユーザーID
   - `accepted_at`: 受け入れ日時

---

## 3. 運用ガイド

### 招待の共有方法

#### メール経由
```
以下のリンクから登録してください：
https://your-app.com/invite/accept?token=abc123...

有効期限: 7日間
```

#### チャット等
リンクをコピーして貼り付け

### 招待の管理

#### 再招待
1. 前回の招待を削除（DB から）
2. 新しい招待を作成

#### キャンセル
DB から該当行を削除

---

## 4. トラブルシューティング

### Q: 招待リンクをクリックしても何も起きない
**A**: ブラウザの開発者ツール（DevTools）のコンソールをチェック：
```javascript
// 期待されるログ
[invite/accept]認証を確認中...
[invite/accept] onAuthStateChange event: SIGNED_IN
```

### Q: "Invalid or expired token" エラーが出る
**A**: 以下を確認：
1. トークンをコピーペーストする際、改行が含まれていないか
2. token_hash がDB に正しく保存されているか
3. 7日以内の招待か

### Q: "email_mismatch" エラーが出る
**A**: 招待されたメールとログイン中のメールが異なります：
1. 正しいメールでサインアップしているか確認
2. 別メールでログインしている場合、ログアウトしてから再度アクセス

### Q: API 呼び出しで 42501 (RLS) エラーが出る
**A**: RLS ポリシーを確認：
```sql
-- company_invites は SELECT 等に RLS が有効
-- Admin のみがアクセス可能
SELECT * FROM company_invites; -- Admin のみ可能
```

---

## 5. セキュリティ考慮

### トークンについて
- **生成**: `crypto.randomBytes(32)` で32byte（256bit）のランダム値
- **保存**: SHA-256 でハッシュ化してDB保存（平文は保存しない）
- **送信**: HTTPS を必須に
- **有効期限**: 7日間（環境変数で変更可能）

### メール検証
- **乗っ取り防止**: 招待メール ≠ ログイン中のメール で拒否
- **重複チェック**: 同一メールへの未承認招待は1つのみ

### RLS ポリシー
- `company_invites` テーブルは Admin のみ
- トークン検証は API（Service Role）で実行
- クライアント側では RLS をバイパスしない

---

## 6. マイグレーション チェックリスト

- [ ] Supabase migration を実行
- [ ] `/api/invites/create` API をデプロイ
- [ ] `/api/invites/accept` API をデプロイ
- [ ] `/invite/accept` ページをデプロイ
- [ ] `/admin/invites` ページを更新
- [ ] テスト環境で Step 1-5 を実施
- [ ] 既存の `/api/admin/invite` を非推奨化（段階的廃止）
- [ ] 本番環境に migration をデプロイ
- [ ] 本番環境でテスト

---

## 7. 今後の拡張

### メール送信統合
```typescript
// /api/invites/create で以下のように呼び出し可能
await sendInviteEmail(email, inviteUrl);
```

### 監査ログ
```sql
-- 履歴テーブルを追加
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  action TEXT,
  invited_at TIMESTAMPTZ,
  ...
);
```

### 招待の一括リサイズ
```typescript
// 複数メール対応
POST /api/invites/create-batch
{
  emails: ["a@ex.com", "b@ex.com", ...]
}
```

---

## 質問・問題報告

何か問題が発生した場合は、以下の情報を添えて報告してください：

1. **エラーメッセージ** (完全な内容)
2. **ブラウザコンソール** の出力
3. **API レスポンス** (DevTools Network タブ)
4. **DB ログ** (if available)
5. **再現手順**

---

**実装日**: 2026-02-12
**バージョン**: 1.0
**ステータス**: リリース準備完了

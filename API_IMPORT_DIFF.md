# `/api/stage1/import` vs `/api/stage1/import-dev` 差分分析

## 本番固有の処理（HTTP 500 の原因候補）

### 1. getSupabaseAdmin() - Step 1
**本番のみ**
```typescript
const admin = getSupabaseAdmin();
```
- 例外可能性：環境変数不足、Supabase SDK初期化エラー
- 発生時刻：POST開始直後

### 2. Authorization header 取得 - Step 2
**本番のみ**
```typescript
const authHeader = request.headers.get('authorization') || '';
```
- 例外可能性：低い（ヘッダー取得は通常安全）
- 但し malformed header で後続処理が失敗する可能性

### 3. getAuthUserIdFromBearer() - Step 3
**本番のみ**
```typescript
const userId = await getAuthUserIdFromBearer(admin, request);
```
- 例外可能性：**高**
  - Supabase接続エラー
  - JWT検証失敗
  - Bearer token 形式エラー
  - Supabase DB接続タイムアウト

### 4. requireMembership() - Step 4
**本番のみ**
```typescript
const membership = await requireMembership(admin, userId);
```
- 例外可能性：**高**
  - Supabase接続エラー
  - ユーザー・会社関連テーブルアクセス失敗
  - RLS（Row Level Security）ポリシー違反

### 5. assertMinRole() - Step 5
**本番のみ**
```typescript
await assertMinRole(membership, 'manager');
```
- 例外可能性：中
  - membership オブジェクトの構造エラー
  - ロール情報取得失敗

### 6. request.formData() - Step 6
**両方で実装されているが、認証後の本番でのみ呼ばれる**
```typescript
const formData = await request.formData();
```
- 例外可能性：中
  - multipart/form-data パース失敗
  - Content-Length > MAX_FILE_SIZE でタイムアウト
  - Edge Runtime と Node.js Runtime の互換性問題（Vercel 本番環境）

## ローカル開発環境での検証結果

| テストファイル | HTTP Status | 成功 | candidates | 問題 |
|-------------|-----------|-----|-----------|-----|
| test-01 (empty) | 200 | ✓ | 0 | なし |
| test-03 (PL+BS) | 200 | ✓ | 6 | なし |
| test-04 (PL+BS+SegPL) | 200 | ✓ | 12 | なし |
| test-05 (all sheets) | 200 | ✓ | 18 | なし |

**結論：** `/api/stage1/import-dev`（認証なし）では全テスト成功
→ Excel解析・multipart/form-data・候補生成ロジックは正常

## HTTP 500 の原因推定（優先度順）

1. **Supabase 接続エラー（最有力）**
   - 本番環境での DATABASE_URL/認証キー設定不備
   - Supabase サーバーが落ちている
   - コネクションプール枯渇

2. **JWT/認証エラー（中程度）**
   - Bearer token 期限切れ
   - getAuthUserIdFromBearer() の例外未処理

3. **RBAC/会社情報取得エラー（中程度）**
   - RLS ポリシー違反
   - ユーザー・会社リレーション問題

4. **multipart/form-data パース（低程度）**
   - ローカルではNode.js Runtime使用
   - 本番 Vercel では Edge Runtime の可能性
   - Runtime間での Buffer/ArrayBuffer 互換性

## Vercel 本番ログで確認すべき項目

```
[stage1/import] [${reqId}] [Step 1] getSupabaseAdmin() FAILED
[stage1/import] [${reqId}] [Step 3] getAuthUserIdFromBearer() FAILED
[stage1/import] [${reqId}] [Step 4] requireMembership() FAILED
[stage1/import] [${reqId}] [Step 5] assertMinRole() FAILED
[stage1/import] [${reqId}] [Step 6] formData parsing FAILED
[stage1/import] [${reqId}] === FATAL ERROR ===
```

これらのログエントリで、どのステップで例外が発生したかを特定できます。

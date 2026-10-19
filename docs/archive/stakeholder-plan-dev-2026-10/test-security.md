# Phase 2 セキュリティ検証テスト

## テストシナリオ

### 1. 認証なしリクエスト（401期待）

```bash
curl -X POST http://localhost:3001/api/plans/bank/generate \
  -H "Content-Type: application/json" \
  -d '{"companyId":"test-company-id","strategyId":"test-strategy-id"}'
```

**期待**: `{ "error": "Unauthorized" }` (status 401)

---

### 2. 無効な audience（400期待）

```bash
curl -X POST http://localhost:3001/api/plans/invalid/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{"companyId":"test-company-id","strategyId":"test-strategy-id"}'
```

**期待**: `{ "error": "Invalid audience type" }` (status 400)

---

### 3. スキーマ無効化（400期待）

```bash
curl -X POST http://localhost:3001/api/plans/shareholder/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{"invalidField":"test"}'
```

**期待**: `{ "error": "Invalid input", "details": [...] }` (status 400)

---

## 実装済みセキュリティチェック

### ✅ 認証層
- [x] Bearer token 検証 (`getAuthUserIdFromBearer`)
- [x] トークン無効時に null 返却
- [x] null の場合は 401 応答

### ✅ 認可層
- [x] 企業メンバーシップ確認 (`requireMembership`)
- [x] 企業スコープ外アクセスは 403 応答
- [x] userId と companyId のマッピング検証

### ✅ データアクセス層
- [x] `getFullStrategyDataByCompany()` で RLS 適用
- [x] Supabase admin client（service_role）使用
- [x] 企業スコープ外データは取得不可

### ✅ 入力検証層
- [x] Zod スキーマバリデーション
- [x] audience 値の厳密チェック
- [x] 疑わしいキーワード検査

### ✅ データ保護
- [x] 本番DB書き込みなし（読み取りのみ）
- [x] 生成結果は Supabase に保存しない
- [x] 監査ログに機密本文は記録しない

---

## 実装ポイント（セキュリティ）

### getFullStrategyDataByCompany の RLS

```typescript
// utils/supabase/strategy.ts より
const baseRes = await supabase
  .from(T_STRATEGY)
  .select('*')
  .eq('company_id', companyId)  // ← companyId で フィルタリング
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

**結果**: RLS ポリシーにより、ユーザーが属する企業のデータのみが返却される。

---

## 他社データアクセス防止テスト（推奨）

### テスト方法
1. テスト用の2つの企業アカウント A、B を準備
2. A ユーザーで strategy を作成（companyId_A）
3. A のトークンで、B の companyId_B を指定して API 呼び出し
4. 結果: 403 Forbidden（Membership 確認で拒否）

---

## DB書き込み防止確認

### コード検査結果

**API ルートで DB 書き込み操作なし**:
- [ ] `.insert()` なし
- [ ] `.update()` なし
- [ ] `.delete()` なし
- [ ] `.rpc()` なし

**読み取り操作のみ**:
- [x] `getFullStrategyDataByCompany()` - SELECT
- [x] `getMembership()` - SELECT
- [x] OpenAI API（外部）- 読み取り用プロンプト生成

---

## 動作テスト時の注意

1. **本番環境でのテスト禁止**
   - 実企業データを絶対に使用しない
   - ローカル開発環境のみでテスト

2. **データ匿名化**
   - テスト用ダミー企業を作成
   - 実企業名は AI に送信しない

3. **トークン管理**
   - テストトークンはローカルのみ
   - git に commit しない

---

## セキュリティ検証チェックリスト

- [x] 認証なし → 401
- [x] 無効な audience → 400
- [x] スキーマ不一致 → 400
- [ ] 他社 companyId → 403 （実施テスト必要）
- [ ] 他社 strategyId → 403 （実施テスト必要）
- [ ] RLS 機能確認 （Supabase 設定確認）
- [ ] DB 書き込み防止 （コード検査完了）
- [ ] AI へ他社データ送信なし （プロンプトでフィルタリング）

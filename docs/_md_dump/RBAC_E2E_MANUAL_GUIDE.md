# RBAC E2E Test - 手動実行ガイド

**目的**: 本番投入前の最終保証として、RBAC の実動作を確認する

---

## 📋 前提条件

- ✅ Node.js 18+ がインストール済み
- ✅ npm dependencies が install 済み（`npm install`）
- ✅ `.env.local` に Supabase 認証情報がセット済み
- ✅ ローカル開発サーバーが起動可能な状態

---

## 🚀 実行手順（最短5分）

### STEP 0: 環境準備

**ターミナル 1** - ローカル開発サーバーを起動:

```bash
npm run dev:3000
```

出力例:
```
▲ Next.js 15.3.6
- Local:        http://localhost:3000
```

**ターミナル 2** - テスト実行用に別タブ/ウィンドウを開く

### STEP 1: テスト用アカウント作成 & トークン取得

```bash
node scripts/setup-e2e-test-accounts.mjs
```

**期待される出力**:

```
========================================
RBAC E2E Test Account Setup
========================================

📍 Creating test company...
✅ Company created: 123e4567-e89b-12d3-a456-426614174000

📍 Creating test users...
✅ User created: rbac-test-1707123456789-admin@test.example.com (...)
✅ User created: rbac-test-1707123456789-manager@test.example.com (...)
✅ User created: rbac-test-1707123456789-member@test.example.com (...)

📍 Creating strategy for company 1...
✅ Strategy created: strategy-001

========================================
✅ Setup Complete!
========================================

📋 Copy and paste the following to set environment variables:

export BASE_URL="http://localhost:3000"
export TOKEN_ADMIN="eyJhbGciOiJIUzI1NiIs..."
export TOKEN_MANAGER="eyJhbGciOiJIUzI1NiIs..."
export TOKEN_MEMBER="eyJhbGciOiJIUzI1NiIs..."
export STRATEGY_ID_COMPANY_A="strategy-001"
export STRATEGY_ID_COMPANY_B="strategy-002"
export USER_ID_ADMIN="admin-user-id-..."
export USER_ID_MEMBER="member-user-id-..."
export COMPANY_ID_A="123e4567-e89b-12d3-a456-426614174000"
```

**出力された env をコピーして、ターミナル 2 に貼り付けます** ⬇️

### STEP 2: 環境変数セット & 自動E2E実行

**bash/zsh の場合**:

```bash
export BASE_URL="http://localhost:3000"
export TOKEN_ADMIN="eyJhbGciOiJIUzI1NiIs..."
export TOKEN_MANAGER="eyJhbGciOiJIUzI1NiIs..."
export TOKEN_MEMBER="eyJhbGciOiJIUzI1NiIs..."
export STRATEGY_ID_COMPANY_A="strategy-001"
export STRATEGY_ID_COMPANY_B="strategy-002"
export USER_ID_ADMIN="admin-user-id-..."
export USER_ID_MEMBER="member-user-id-..."
export COMPANY_ID_A="123e4567-e89b-12d3-a456-426614174000"

# 実行
npm run rbac:e2e:min
```

**PowerShell (Windows) の場合**:

```powershell
$env:BASE_URL = "http://localhost:3000"
$env:TOKEN_ADMIN = "eyJhbGciOiJIUzI1NiIs..."
$env:TOKEN_MANAGER = "eyJhbGciOiJIUzI1NiIs..."
$env:TOKEN_MEMBER = "eyJhbGciOiJIUzI1NiIs..."
$env:STRATEGY_ID_COMPANY_A = "strategy-001"
$env:STRATEGY_ID_COMPANY_B = "strategy-002"
$env:USER_ID_ADMIN = "admin-user-id-..."
$env:USER_ID_MEMBER = "member-user-id-..."
$env:COMPANY_ID_A = "123e4567-e89b-12d3-a456-426614174000"

# 実行
npm run rbac:e2e:min
```

---

## 📊 期待される テスト結果

### 全8テストケース

| # | テストケース | 期待値 | 説明 |
|---|------------|--------|------|
| 1 | Bearer Token なし | 401 | 認証なしで API アクセスを拒否 |
| 2 | Admin が招待 | 200 | Admin は member を招待可能 |
| 3 | Manager が招待 | 403 | Manager は招待不可（admin-only）|
| 4 | Member が招待 | 403 | Member は招待不可 |
| 5 | Member が Agent 利用 | 200 | Member は agent:use 権限あり |
| 6 | クロス会社アクセス | 403 | Company-A のユーザーが Company-B の strategy にアクセス不可 |
| 7 | メンバー一覧取得 | 200 | Admin はメンバー一覧を取得可能 |
| 8 | Role 更新 | 200 (Admin) / 403 (Manager) | Admin のみ role 更新可能 |

---

## ✅ 成功条件（Ship OK）

以下の 5テストが全て PASS していれば、RBAC 実装は本番投入可能：

- ✅ **Test 1**: Bearer なし → 401
- ✅ **Test 2 or 3**: Admin 招待 → 200 / Manager 招待 → 403
- ✅ **Test 5 or 4**: Member Agent 利用 → 200 / Member 招待 → 403
- ✅ **Test 6**: Cross-company → 403

---

## 🛠️ トラブルシューティング

### ❌ `node: command not found`

Node.js がインストールされていません：

```bash
# macOS
brew install node

# Windows
# https://nodejs.org/ からインストール
```

### ❌ `setup-e2e-test-accounts.mjs` が失敗

**原因 1: 環境変数が不正**

```bash
# 確認
echo $NEXT_PUBLIC_SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
```

**原因 2: Supabase 接続エラー**

```bash
# 確認
curl -s https://yuerkbxpivdhaikrnsar.supabase.co/rest/v1/ \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | jq .
```

### ❌ `npm run rbac:e2e:min` が失敗

**テスト前に確認**:

```bash
# 1. 開発サーバーが起動しているか確認
curl http://localhost:3000/api/diag/whoami -H "Authorization: Bearer test" -s | jq .

# 2. Bearer token が正しいか確認（401 の代わりに 200 が返る）
curl -s http://localhost:3000/api/diag/whoami \
  -H "Authorization: Bearer $TOKEN_ADMIN" | jq .

# 3. members API が動作しているか確認
curl -s http://localhost:3000/api/members \
  -H "Authorization: Bearer $TOKEN_ADMIN" | jq .
```

### ❌ `Cross-company access` テストが失敗

**原因**: STRATEGY_ID_COMPANY_B が設定されていない

```bash
# 確認
echo "STRATEGY_ID_COMPANY_A=$STRATEGY_ID_COMPANY_A"
echo "STRATEGY_ID_COMPANY_B=$STRATEGY_ID_COMPANY_B"

# もし STRATEGY_ID_COMPANY_B が空の場合、setup スクリプトを再実行
node scripts/setup-e2e-test-accounts.mjs
```

---

## 📝 結果の記録

### テスト結果を RBAC_E2E_RESULTS.md に記録

```bash
# スクリプトの出力をコピーして、RBAC_E2E_RESULTS.md の該当セクションに貼り付け
# または、以下の手動コマンドで個別テストの結果を確認
```

### 手動 curl テスト（確実に 401/403/200 を踏みたい場合）

#### Test 1: Bearer Token なし → 401

```bash
curl -X POST http://localhost:3000/api/ask-ceo-agent \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}],"userId":"test","strategyId":"test"}'

# 期待: 401 Unauthorized
```

#### Test 2: Admin 招待 → 200

```bash
curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"newuser@example.com\",\"role\":\"member\",\"companyId\":\"$COMPANY_ID_A\"}"

# 期待: 200 OK
```

#### Test 3: Manager 招待 → 403

```bash
curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $TOKEN_MANAGER" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"newuser@example.com\",\"role\":\"member\",\"companyId\":\"$COMPANY_ID_A\"}"

# 期待: 403 Forbidden
```

#### Test 6: Cross-company access → 403

```bash
curl -X POST http://localhost:3000/api/ask-ceo-agent \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Help\"}],\"userId\":\"$USER_ID_ADMIN\",\"strategyId\":\"$STRATEGY_ID_COMPANY_B\"}"

# 期待: 403 Forbidden
```

---

## 📋 チェックリスト

完了後、以下をチェック：

- [ ] ローカル開発サーバーが起動している
- [ ] `node scripts/setup-e2e-test-accounts.mjs` が正常に完了
- [ ] 環境変数が全て設定済み
- [ ] `npm run rbac:e2e:min` が実行可能
- [ ] 全 8 テストの結果が RBAC_E2E_RESULTS.md に記録されている
- [ ] 最低 5 つのテストが PASS している
- [ ] 結果の証跡が確認可能

---

## 🎯 成功時の次のステップ

テストが全て PASS したら：

```bash
# 1. 変更内容を確認
git status

# 2. テスト用アカウント削除（オプション）
# Supabase ダッシュボード → Authentication → Users で削除可能

# 3. 本番へのデプロイ
# vercel deploy --prod

# 4. 本番環境でポストデプロイ確認
curl -X POST https://growth.example.com/api/admin/invite \
  -H "Content-Type: application/json" \
  -d '{}'
# 期待: 401 (no Bearer token)
```

---

**Generated**: 2026-02-11
**Status**: Ready for Manual E2E Execution

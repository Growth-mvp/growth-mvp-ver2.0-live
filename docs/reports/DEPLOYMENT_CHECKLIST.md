# デプロイ前チェック手順

このドキュメントは本番環境へのデプロイ前に実施すべきチェックリストと手順を定めます。**npm run build が成功してもランタイムエラーが発生し得る前提で設計**されています。

## 概要

デプロイフロー：

```
ローカル開発 → ローカルビルド確認 → ローカル起動テスト
  ↓
GitHub PR / push
  ↓
Preview Deployment（Vercel自動）
  ↓
Preview で全チェック実施
  ↓
Production 反映
  ↓
本番スモークテスト
  ↓
問題検出時は即ロールバック
```

---

## Phase 1: ローカル開発完了時のチェック

### 1.1 ビルド確認

```bash
npm run build
```

**確認項目**:
- ✅ エラーなく完了（"Compiled successfully"）
- ✅ TypeScript エラーなし
- ✅ ESLint 警告なし（--max-warnings 0 で実行）
- ✅ ビルドサイズが異常増加していないか（前回比較）

**失敗時の対応**:
```bash
npm run type-check    # 型エラーを詳細確認
npm lint              # ESLint エラーを詳細確認
git diff HEAD         # 最近の変更を確認
```

### 1.2 package.json 依存関係チェック

```bash
npm list              # 重複、脆弱性を確認
npm audit             # セキュリティ脆弱性をチェック
```

**確認項目**:
- ✅ 新規依存を追加した場合、必要性と互換性を確認
- ✅ 深刻なセキュリティ脆弱性がないか（npm audit で high/critical をチェック）

### 1.3 環境変数確認

```bash
# .env.local に必須変数が揃っているか確認
grep -E "^[A-Z_]+" .env.local
```

**確認項目**:
- ✅ OPENAI_API_KEY
- ✅ NEXT_PUBLIC_SUPABASE_URL
- ✅ NEXT_PUBLIC_SUPABASE_ANON_KEY
- ✅ その他プロセス固有のキー

---

## Phase 2: ローカル起動テスト

### 2.1 開発サーバー起動

```bash
npm run dev
```

**待機**: "Local: http://localhost:3000" が表示されるまで（通常 5-10 秒）

### 2.2 主要画面の起動確認（ブラウザで実施）

以下のリストで順に訪問し、各画面が**エラーなく表示**されることを確認。

| 画面                | URL                    | 確認項目 |
|-------------------|------------------------|---------|
| ログイン             | http://localhost:3000/login | フォーム表示、入力可 |
| ホーム             | http://localhost:3000/ | サイドバー、コンテンツロード |
| STAGE0 (初期情報)  | http://localhost:3000/stage0 | フォーム表示 |
| STAGE1 (分析)      | http://localhost:3000/stage1 | データテーブル表示 |
| STAGE2 (戦略)      | http://localhost:3000/stage2 | 12問フォーム表示 |
| STAGE3 (展開)      | http://localhost:3000/stage3 | ブリッジコンテンツ表示 |
| STAGE4 (OKR)       | http://localhost:3000/stage4 | OKR テーブル表示 |
| CEO チャット       | http://localhost:3000 右パネル | パネル表示（開閉可） |
| レポート           | http://localhost:3000/report | レポート一覧表示 |

### 2.3 ブラウザコンソールエラー確認（重要）

ブラウザ DevTools > Console タブを開き、各画面でのエラー、警告を確認。

```
Uncaught ReferenceError: ...      ❌ デプロイNG
Uncaught TypeError: ...           ❌ デプロイNG
Application error: ...            ❌ デプロイNG
Warning: ...                      ⚠️  検証要（critical でなければOK）
```

**デプロイを止めるべきエラー**:
- `ReferenceError`, `TypeError`, `SyntaxError`
- `Cannot read property of undefined/null`
- `fetch failed`, `API error 500`（一度きりなら一時的エラー）

### 2.4 CEOChatPanel 送信確認（統合テスト）

1. CEOチャットパネルを開く（右パネル）
2. メッセージを入力（例：「会社の財務状況について教えてください」）
3. 送信ボタンを押す
4. **期待動作**:
   - ✅ 送信直後、ローディングスピナー表示
   - ✅ ブラウザコンソールにエラーなし
   - ✅ 約 3-10 秒後に AI 回答が表示
   - ✅ Network タブで `/api/ask-ceo-agent` が HTTP 200 を返す

**失敗時の診断**:
```javascript
// ブラウザコンソールで実行：
window.__STRATEGY_STORE_GETSTATE__()
// 以下を確認
// - strategyId が存在（UUID形式）
// - restoreReady が true
// - isFetchingFromServer が false
```

### 2.5 Supabase 接続確認

1. 開発サーバーの Network タブで Supabase API へのリクエストを確認
2. `/rest/v1/` で始まるリクエストが HTTP 200 で応答
3. WebSocket 接続 (`wss://...`) が確立されている

**失敗時**:
```bash
# Supabase 接続をテスト
curl -H "Authorization: Bearer <ANON_KEY>" \
  "https://<PROJECT>.supabase.co/rest/v1/growth_strategies?limit=1"
```

---

## Phase 3: Preview Deployment での確認

### 3.1 GitHub PR 作成 → Vercel Preview 自動生成

1. フィーチャーブランチで変更をコミット、push
2. GitHub で PR を作成
3. Vercel が自動的に Preview Deployment を生成（約 1-3 分）
4. PR コメントに **Visit Preview** リンク出現

### 3.2 Preview 環境での全チェック（Phase 2 を繰り返す）

Preview URL で以下をすべて実施：

- [ ] 主要画面 9 つの起動確認
- [ ] ブラウザコンソール エラーなし確認
- [ ] CEOChatPanel 送信テスト
- [ ] Supabase 接続テスト

**Preview での追加チェック項目**:
- ✅ ログイン/セッション復元（本番用 Supabase を使用）
- ✅ 既存データの読み込み（本番DBから）
- ✅ データ保存（updateが成功するか）
- ✅ RBAC が正常に機能するか

### 3.3 Preview で問題検出時の対応

```
問題なし
  ↓ PR Approve & Merge
  ↓ Production 反映

問題あり
  ↓ ローカルで原因特定
  ↓ 修正 & コミット & push
  ↓ Preview 再デプロイ（自動）
  ↓ 再テスト
```

---

## Phase 4: Production 反映前チェックリスト

PR マージ直前に以下を確認：

- [ ] **ローカルビルド成功** (`npm run build` エラーなし)
- [ ] **Preview で全テスト完了** かつ **エラーなし**
- [ ] **commit メッセージが適切** （何が変わったか明確）
- [ ] **型チェック完了** (`npm run type-check`)
- [ ] **ESLint 完了** (`npm lint`)
- [ ] **不要な console.log 削除** （デバッグ用ログを削除）
- [ ] **diagnostic ログの状態確認** （本番リリース時は削除予定のものをクリア）
- [ ] **セキュリティ確認** （環境変数、API キー露出なし）
- [ ] **CHANGELOG / リリースノート更新** （重要な変更は記載）

---

## Phase 5: Production 反映（デプロイ実行）

### 5.1 GitHub で PR Merge

```bash
# ローカルで確認
git log origin/main..HEAD    # マージ予定の全コミット確認

# GitHub UI で "Squash and merge" または "Merge pull request"
# ⚠️ 本番への直接 push は禁止
```

### 5.2 Vercel 自動デプロイ待機

- GitHub main へのマージ → Vercel Production 自動デプロイ開始
- Vercel ダッシュボードで進行状況を監視（デプロイ完了まで 2-5 分）

**デプロイ完了の確認**:
```bash
# Vercel CLI で確認（インストール済み時）
vercel list --prod
# または Vercel Dashboard で Production環境の最新デプロイを確認
```

---

## Phase 6: Production スモークテスト（デプロイ直後）

**制限時間**: デプロイ完了から 10 分以内に以下をすべて実施

### 6.1 本番 URL へのアクセス

```
本番URL: https://growth-mvp.com（または割り当てられた URL）
```

1. ページをリロード（Cmd+Shift+R / Ctrl+Shift+R で キャッシュクリア）
2. ブラウザコンソール確認（F12 > Console）

**期待状態**:
- ✅ ページが正常に表示される
- ✅ コンソールに `ReferenceError`, `TypeError` なし

### 6.2 重要機能の動作確認

| 項目 | 手順 | 期待動作 |
|-----|------|--------|
| ログイン | login画面でメール送信 | メール受信、ログイン可 |
| STAGE2表示 | /stage2 へナビゲート | 12問フォーム表示 |
| CEOChat送信 | メッセージ送信 | AI応答表示、/api/ask-ceo-agent 200 |
| データ保存 | STAGE1で データ編集、自動保存 | Supabase に保存確認 |
| レポート生成 | /report/stage2-strategy へアクセス | PDF生成可能 |

### 6.3 本番ログ確認

**Supabase ダッシュボード > Logs**:
```
- Auth errors なし
- RLS policy violations なし
- API errors (5xx) なし
```

**Vercel ダッシュボード > Logs**:
```
- Function エラーなし
- Edge Function エラーなし
```

### 6.4 Sentry / 外部監視ツール確認（導入済み時）

エラートラッキングサービスで本番デプロイ直後の異常なし確認。

---

## Phase 7: 問題検出時のロールバック手順

### 7.1 問題判定基準

以下のいずれかに該当する場合は **即ロールバック**：

- ❌ `Application error: a client-side exception has occurred` が繰り返し表示
- ❌ ブラウザコンソールに `ReferenceError`, `TypeError`, `SyntaxError`
- ❌ CEOChatPanel が完全に動作しない（送信不可）
- ❌ ログイン処理が失敗（Supabase 認証エラー）
- ❌ 主要な API が HTTP 500 を返す

### 7.2 ロールバック実行

```bash
# Option A: Vercel ダッシュボード（最速）
# Vercel Dashboard > Project > Deployments
#   → 直前の成功したデプロイを選択
#   → "Promote to Production" クリック
# 完了時間: 約 30 秒

# Option B: GitHub Revert コミット
git log --oneline main     # 問題のあるコミットを確認
git revert <commit-sha>    # revert コミット生成
git push origin main       # 自動デプロイ開始
# 完了時間: 約 2-3 分
```

### 7.3 ロールバック後の確認

ロールバック完了後、Phase 6 のスモークテストを再実行。

### 7.4 原因分析と修正

ロールバック後、ローカルで詳細な原因特定：

```bash
# 最新コード取得
git pull origin main

# 問題のあるコミットを確認
git log --oneline -5

# 当該部分を詳細確認
git show <problem-commit>

# ローカルで npm run dev で再現テスト
npm run dev

# 修正後、Phase 1-6 をやり直し
```

---

## 付録 A: 自動化可能な npm コマンド

以下のコマンドで本運用を支援します（別途実装）：

### 提案: npm run predeploy-check

```bash
npm run predeploy-check
```

**実装内容**:
```bash
# scripts/predeploy-check.sh（または .mjs）内で：
1. npm run build              # ビルド確認
2. npm run type-check         # 型チェック
3. npm lint                   # ESLint
4. npm audit --audit-level=high  # セキュリティチェック
5. 環境変数チェック（.env.local に必須キー）
6. console.log デバッグ行の検出（警告）
```

**実行例**:
```bash
npm run predeploy-check
# ✅ Build succeeded
# ✅ Types OK
# ✅ Lint OK
# ⚠️  Security: 1 medium vulnerability (npm audit で詳細確認)
# ⚠️  Debug logs found: 3 instances in app/layoutClient.tsx
# ✅ Environment variables: All required keys present
# Ready for PR review
```

### 提案: npm run smoke-test

本番デプロイ後、Preview または Production で実行可能なスモークテスト：

```bash
npm run smoke-test -- https://growth-mvp.com
```

**実装内容** (Playwright E2E):
- ✅ ログインフロー テスト
- ✅ 主要画面 (STAGE2-4) 起動テスト
- ✅ CEOChatPanel 送信テスト
- ✅ API 応答テスト (`/api/ask-ceo-agent`, `/api/companies/provision`)

---

## 付録 B: よくあるエラーと対応

| エラー | 原因 | 対応 |
|-------|------|------|
| `ReferenceError: strategyId is not defined` | useEffect 依存配列にない変数を参照 | ローカルで再現、依存配列確認、修正 |
| `Uncaught TypeError: Cannot read properties of undefined` | null/undefined チェック不足 | Optional chaining (`?.`) 追加 |
| `Application error: a client-side exception has occurred` | 総合的なJS エラー | ブラウザコンソール詳細確認、ローカルで再現 |
| `/api/ask-ceo-agent 429` | OpenAI レート制限 | API キー確認、リクエスト制限確認 |
| `/api/ask-ceo-agent 403` | 権限不足（RBAC） | ユーザーロール、会社所属確認 |
| `CEOChatPanel が応答しない` | Zustand hydration 遅延 | `strategyId` 復元待ち、`restoreReady` 確認 |
| `Supabase connection timeout` | DB 接続エラー | Supabase ダッシュボードで接続確認 |

---

## 付録 C: デプロイチェックリスト（印刷用）

```
本番デプロイ実行チェックリスト
==============================

Phase 1: ローカル開発完了時
  [ ] npm run build - エラーなし
  [ ] npm run type-check - エラーなし
  [ ] npm lint - エラーなし
  [ ] npm audit - high/critical なし
  [ ] .env.local - 必須キー揃ってる

Phase 2: ローカル起動テスト
  [ ] npm run dev - 起動成功
  [ ] 主要画面 9 つ - エラーなし表示
  [ ] ブラウザコンソール - ReferenceError/TypeError なし
  [ ] CEOChatPanel - 送信成功、AI応答表示
  [ ] /api/ask-ceo-agent - Network タブで 200

Phase 3: Preview Deployment テスト
  [ ] PR → Vercel Preview 自動生成
  [ ] Preview URL で Phase 2 を繰り返し
  [ ] ログイン、データ保存、RBAC 確認
  [ ] エラーなければ Approve

Phase 4: Production 反映前
  [ ] コミットメッセージ確認
  [ ] console.log デバッグ行削除
  [ ] diagnostic ログ状態確認
  [ ] CHANGELOG 更新
  [ ] Merge ボタンを押す

Phase 5: Production デプロイ
  [ ] Vercel デプロイ完了確認（Dashboard）
  [ ] デプロイ完了: 2-5 分

Phase 6: 本番スモークテスト（10分以内）
  [ ] https://growth-mvp.com へアクセス
  [ ] キャッシュクリアリロード
  [ ] ブラウザコンソール - エラーなし
  [ ] ログイン テスト
  [ ] STAGE2 表示 テスト
  [ ] CEOChat 送信 テスト
  [ ] Supabase Logs - エラーなし
  [ ] Vercel Logs - エラーなし

完了 ✅ / 問題検出 → ロールバック ❌
```

---

## 更新履歴

- **2026-09-27**: 初版作成。本番での client-side exception（ea195a4 revert）の教訓を反映。

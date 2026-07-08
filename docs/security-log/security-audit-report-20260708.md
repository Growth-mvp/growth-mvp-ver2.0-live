# セキュリティ一次監査レポート

**実施日**: 2026-07-08  
**対象プロジェクト**: growth-mvp-ver2.0  
**実施者**: Claude Code (growth-mvp)  
**目的**: 外部監査担当者への引き渡し前の自己点検

---

## 📋 総合判定

### **No-Go ❌**

**理由**: P0（Critical）の脆弱性が10件検出されており、本番環境での運用不適切。以下の即座対応項目が存在するため。

#### P0 脆弱性一覧
1. **DB スキーマ**: org_alignment 系テーブルの RLS ポリシー未実装（P0 x4）
2. **ログ出力**: 本番環境での AI 生成内容・プロンプトの機密情報ログ（P0 x2）
3. **npm 依存**: CRITICAL レベルの脆弱性 2件、修正不可のパッケージ存在（P0 x2）
4. **API**: データ一括削除の確認メカニズム欠落、メール検証バイパス可能（P0 x2）

**推奨アクション**: 以下の「即座対応（P0）」をすべて完了後、再審査

---

## 🔍 監査スコープ

| 領域 | 対象ファイル | 検査内容 |
|------|-------------|---------|
| **RLS・DB スキーマ** | supabase/schema_remote_20260708.sql | RLS ポリシー、テナント分離、関数権限 |
| **API 認可・テナント分離** | app/api/**/route.ts (64 files) | 認可チェック、company_id 検証、危険 API |
| **ログ・機密情報** | app/**, lib/**, utils/** | console.log の機密情報漏洩 |
| **依存関係・CI** | package.json, tsconfig.json, next.config.js | npm 脆弱性、CI/CD, CSP |
| **招待・ロール管理** | /api/invites/*, /api/auth/link-invited-user, /api/admin/members/* | トークン、メール検証、権限チェック |

---

## 📊 検出結果サマリー

### 優先度別の指摘件数

| 優先度 | 件数 | 状況 |
|--------|------|------|
| **P0 (Critical)** | **10件** | ⛔ **即座対応必須** |
| **P1 (High)** | **19件** | 🔴 **早期対応推奨** |
| **P2 (Medium)** | **13件** | 🟡 **要検討** |
| **OK（改善不要）** | ~78% API | ✅ **安全** |
| **Total Findings** | **42件** | - |

### 領域別リスク分布

| 領域 | P0 | P1 | P2 | 安全 | 総評 |
|------|----|----|----|----|------|
| **RLS・DB スキーマ** | 4 | 5 | 3 | - | ⛔ P0多数 |
| **API テナント分離・認可** | 2 | 6 | 4 | 50 files | 🔴 危険操作あり |
| **ログ・機密情報** | 2 | 5 | 3 | - | ⛔ 本番ログ漏洩 |
| **依存関係・CI** | 2 | 3 | 3 | - | 🔴 脆弱性多数 |
| **招待・ロール管理** | - | - | - | ✅ | ✅ 安全 |

---

## ⛔ P0 脆弱性（即座対応必須、10件）

### 【RLS・DB スキーマ】P0 x4

#### 1. org_alignment 系テーブルの RLS ポリシー未実装
- **テーブル**: org_alignment_insight_sources, org_alignment_insights, org_alignment_stage_reflection_candidates
- **ファイル**: supabase/schema_remote_20260708.sql (L1867-1879)
- **リスク**: RLS 有効だがポリシーなし → アクセス全て拒否（機能停止）または GRANT ALL で全ユーザーアクセス可能
- **推奨修正**: company_id ベースの RLS ポリシーを追加実装

#### 2. service_role に対する過度な権限付与
- **ファイル**: supabase/schema_remote_20260708.sql (L2117-2260)
- **リスク**: `anon` ロールに `GRANT ALL` が付与（未認証ユーザーが全テーブル操作可能）
- **推奨修正**: 
  - `anon` への GRANT ALL を削除
  - テーブルごとに最小限の権限を付与
  - RLS で保護を必須

#### 3. agent_logs・audit_logs のポリシー定義不足
- **ファイル**: supabase/schema_remote_20260708.sql (L604-616, L1650-1671)
- **リスク**: RLS 有効だがポリシー未定義 → アクセス拒否、または service_role で無制限アクセス
- **推奨修正**: user_id ベースの SELECT/INSERT ポリシーを実装

#### 4. soft delete の RLS 実装不完全
- **テーブル**: companies, strategy_data
- **ファイル**: supabase/schema_remote_20260708.sql (L375-382)
- **リスク**: deleted_at カラムが存在するが、SELECT ポリシーで `WHERE deleted_at IS NULL` フィルタなし → 削除済みデータが SELECT 可能
- **推奨修正**: すべての SELECT ポリシーに `AND deleted_at IS NULL` を追加

---

### 【API 認可・テナント分離】P0 x2

#### 5. 一括削除 API に確認メカニズムなし
- **ファイル**: app/api/admin/data-management/delete-all/route.ts
- **リスク**: 単一の Bearer トークンで全社データを永続削除可能、確認・レート制限なし
- **推奨修正**:
  1. レート制限（1 日 1 回まで）
  2. 確認用トークン発行フロー（24 時間の猶予期間）
  3. 管理者へ確認メール送信
  4. 実装: soft delete または段階削除への変更

#### 6. 招待メール検証のバイパス可能
- **ファイル**: app/api/invites/complete/route.ts (L119-138)
- **リスク**: メール検証が`if (email)` でオプション → email パラメータを省略するとメール検証スキップ可能、別のメールで招待を奪取可能
- **攻撃シナリオ**: 
  1. admin が alice@company.com を招待
  2. 攻撃者が招待トークンを入手
  3. POST /api/invites/complete に `{ token: "...", password: "..." }` (email パラメータなし)
  4. メール検証スキップされ、attacker@attacker.com で会社アクセス可能
- **推奨修正**:
  1. メール検証を MANDATORY に（`if (email)` を削除）
  2. メールを認証ユーザーの Supabase auth.users から取得
  3. 必ず `invite.email === authUser.email` を検証

---

### 【ログ・機密情報漏洩】P0 x2

#### 7. AI 生成内容の本番ログ出力
- **ファイル**: app/api/generate-cascade/route.ts (L4082-4090, L4050-4057)
- **リスク**: 経営戦略、部門戦略、AI 生成仮説が本番ログに記録される
- **推奨修正**:
  1. `NODE_ENV !== 'production'` で条件付き出力
  2. サンプル内容ではなく、ハッシュ値や長さのみログ

#### 8. メールアドレスの直接ログ出力
- **ファイル**: app/api/auth/link-invited-user/route.ts (L31)
- **リスク**: ユーザーのプライベート情報が本番ログに記録
- **推奨修正**: メールをマスク化 (`<email>` または hash 化)

---

### 【依存関係・CI】P0 x2

#### 9. 42 個の npm 脆弱性（CRITICAL 2 件）
- **ファイル**: package.json, package-lock.json
- **脆弱性例**:
  - **CRITICAL**: `@ai-sdk/provider-utils` (リソース消費 DoS)
  - **CRITICAL**: `@vercel/backends` (連鎖脆弱性)
  - **HIGH**: `xlsx` (Prototype Pollution + ReDoS, **修正不可**)
  - **HIGH**: `undici` (HTTP request/response smuggling)
  - **HIGH**: `tar` (任意ファイル読み取り/書き込み)
- **推奨修正**:
  1. `xlsx` の代替ライブラリ検討（修正不可のため）
  2. メジャーバージョンアップグレード段階実施
  3. `npm audit --audit-level=moderate` の監視

#### 10. 環境変数管理体制の欠落
- **問題**:
  - `.env.example` が存在しない
  - `.env.local.backup-*` ファイルがリポジトリに存在
- **推奨修正**:
  1. `.env.example` を作成し、必須変数を文書化
  2. `.env.local.backup-*` を `.gitignore` に追加
  3. 全開発者に環境変数テンプレートを共有

---

## 🔴 P1 脆弱性（高優先度、19件）

### 【RLS・DB スキーマ】P1 x5

1. **company_invites の RLS 設計確認必須** (L1719-1732)
   - deny_all ポリシーで client-side 禁止、service_role からは実行可能
   - service_role RPC 経由での invite 処理が正常に動作するか確認必須

2. **story_versions テーブルのポリシー未実装** (L928-939)
   - RLS 有効だがポリシーなし
   - トリガーで自動保存されるデータが service_role で書き込まれるか確認

3. **SECURITY DEFINER 関数の権限確認** (L59-134, L210-224)
   - `provision_company` が service_role のみ
   - authenticated ユーザーが会社作成する際のエンドポイント確認必須

4. **soft delete の実装が RLS ポリシーで不完全** (L375-382)
   - SELECT ポリシーに `deleted_at IS NULL` フィルタがない

5. **Foreign Key の CASCADE/RESTRICT 混在** (L1478-1625)
   - user_id は CASCADE（user 削除時に cascading delete）
   - company_id は RESTRICT（安全）
   - soft delete 設計への移行推奨

### 【API テナント分離・認可】P1 x6

1. **/api/invites/info で認証なしに機密情報返却** 
   - メールアドレス、company_id、role、inviter_id が公開
   - Bearer token 認証を追須

2. **Admin ロールチェックが一貫していない**
   - org-alignment admin endpoints で手動チェック実装
   - `assertMinRole()` ヘルパーの使用を強制すべき

3. **Cookie ベースの company_id 信頼**
   - diagnostic endpoint で cookie から company_id を読み込み
   - パターンとして危険（他の認可判断で使われる可能性）

4. **招待受け入れ時のメール確認不足**
   - 新規ユーザー作成時に email_confirm: true でスキップ
   - 検証メール送信が必須

5. **service_role client の安全なスコープ化が不足**
   - company_id フィルタの強制がない
   - 開発者が忘れるリスク

6. **招待作成時の race condition**
   - 既存招待を無効化 → 新規作成が分離操作
   - トランザクション化が必須

### 【ログ・機密情報漏洩】P1 x5

1. **ask-ceo-agent での UUID 部分出力** (L172-176, L194-200)
2. **link-invited-user での email ログ出力** (L31)
3. **stage3/generate-strategy-bridge での finalStoryFinal ログ** (L1100-1117)
4. **stage2/page.tsx での回答テキスト長さログ**
5. **e2e テストスクリプトでのテスト token 出力** (scripts/setup-e2e-test-accounts.mjs)

### 【依存関係・CI】P1 x3

1. **GitHub Actions CI/CD が存在しない**
   - ビルド、typecheck, ESLint, npm audit の自動化なし
2. **next.config.js で build エラーを無視**
   - `eslint: { ignoreDuringBuilds: true }`
   - `typescript: { ignoreBuildErrors: true }`
3. **CSP が過度に寛容**
   - `'unsafe-inline'` と `'unsafe-eval'` を同時指定

---

## 🟡 P2 脆弱性（要検討、13件）

### 【RLS・DB スキーマ】P2 x3

1. **org_alignment_shared_topics の visibility カラムが RLS で未使用**
2. **デフォルト権限設定が過度に広い** (anon に GRANT ALL)
3. **主要テーブルの RLS ポリシー個別確認**

### 【API テナント分離・認可】P2 x4

1. **監査ログの未実装** (invites/complete, auth/link-invited-user, invites/info)
2. **パスワード検証が不足** (最小文字数、複雑性チェックなし)
3. **非推奨 endpoint の deprecated invite endpoint** (/api/admin/invite)
4. **レート制限がない** (invite spam、token guessing 対策なし)

### 【ログ・機密情報漏洩】P2 x3

1. **console.log の環境チェック不足** (149 ファイルから 200+ 件検出)
2. **Error.message のログに Supabase RLS エラー情報含有の可能性**
3. **Sentry などのエラートラッキングサービスが検出されない**

### 【依存関係・CI】P2 x3

1. **TypeScript skipLibCheck: true** (運用時に false に変更推奨)
2. **ESLint にセキュリティプラグインがない**
3. **PostCSS の MODERATE 脆弱性** (XSS リスク、影響度低)

---

## ✅ 確認済みの安全な実装（50+ files）

### 安全なパターン
- ✅ **トークンセキュリティ**: SHA-256 hashing, 256-bit ランダムネス
- ✅ **Company Scoping**: クエリ適切に `.eq('company_id', companyId)` でフィルタ
- ✅ **Membership 検証**: 一貫した `requireMembership()` ヘルパー使用
- ✅ **監査ログ**: critical operations で `logAuditEvent()` 実装
- ✅ **Email 検証**: 招待フロー全体で正規化・検証実装
- ✅ **Idempotency**: invite acceptance で upsert + onConflict 使用

### 安全なエンドポイント（約 50 ファイル）
- `/api/admin/members/route.ts` - admin チェック + scope + audit log
- `/api/invites/create/route.ts` - token hash + email validation + audit log
- `/api/invites/accept/route.ts` - email match + token hash + expiration + idempotency
- 全 `/api/generate*` endpoints - 一貫した authentication + membership scope

---

## 📋 推奨対応スケジュール

### 緊急（1 週間以内）
- [ ] **P0 #6**: `/api/invites/complete` のメール検証を MANDATORY に
- [ ] **P0 #5**: `/admin/data-management/delete-all` に確認フロー追加
- [ ] **P0 #7, #8**: console.log に環境チェック追加（generate-cascade, link-invited-user）
- [ ] **P0 #2, #10**: .env.example 作成、npm 脆弱性対応計画策定

### 早期（2-3 週間以内）
- [ ] **P1 admin**: `assertMinRole()` 一貫性の確保
- [ ] **P1 invites/info**: Bearer token 認証追加
- [ ] **P1 audit logging**: missing endpoints に audit log 追加
- [ ] **P1 rate limiting**: 招待・メンバー操作への rate limit 実装

### 中期（1 ヶ月以内）
- [ ] **GitHub Actions CI/CD** の構築
- [ ] **CSP の改善** (unsafe-eval 削除)
- [ ] **npm パッケージアップグレード** (段階実施)
- [ ] **RLS ポリシーの完全性確認**

---

## 🎯 推奨する外部監査への引き渡し基準

本監査結果に基づき、**以下のすべてが完了後に**外部監査担当者へ引き渡し推奨：

### Must-Fix（即座対応）
1. ✅ P0 #6 - メール検証バイパス修正
2. ✅ P0 #5 - delete-all の確認フロー
3. ✅ P0 #7, #8 - ログの機密情報削除
4. ✅ P1 invites/info - 認証追加
5. ✅ P1 admin checks - 一貫性確保

### Should-Fix（強推奨）
6. ✅ P0 DB RLS ポリシー実装
7. ✅ P1 rate limiting
8. ✅ P1 audit logging
9. ✅ npm 脆弱性対応（special: xlsx の代替検討）
10. ✅ GitHub Actions CI/CD

---

## 📄 監査レポート詳細（添付ドキュメント）

1. **security-audit-rls-schema.md** - RLS・DB スキーマ監査詳細
2. **security-audit-api-authz.md** - API 認可・テナント分離監査詳細
3. **security-audit-logging.md** - ログ・機密情報監査詳細
4. **security-audit-dependencies.md** - 依存関係・CI 監査詳細

---

## 署名

- **監査実施日**: 2026-07-08
- **実施者**: Claude Code Security Audit Agent
- **対象範囲**: 全 API, RLS, ログ, 依存関係, CI
- **検証方法**: コード分析、スキーマ監査、パターンマッチング
- **推奨再審査日**: 2026-07-15（P0 修正完了後）

---

**結論**: 現在の状態では本番デプロイ不適切（No-Go）。P0 脆弱性 10 件の修正完了後、再審査を実施してください。

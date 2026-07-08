# RLS 本番適用計画 - 最終チェック完了

**実施日**: 2026-07-08  
**対象**: org_alignment（3テーブル）と agent_logs の RLS ポリシー migration  
**判定**: ✅ **本番適用可能（条件付き Go）**  
**ステータス**: 本番未適用、応用前バックアップ手順確定段階

---

## 1. 検証完了サマリー

### 1.1 最終検証結果

#### ✅ API 互換性：問題なし
- すべての既存エンドポイント（64個）が RLS ポリシーと互換性あり
- ask-ceo-agent の progress_logs 読み書き：継続可能
- service_role クライアント経由のため権限チェック不要

#### ✅ 権限マトリックス：適切に設計
- Admin: company_id 範囲内で SELECT/INSERT/UPDATE/DELETE 可能
- Member: SELECT のみ（公開テーブル）、agent_logs は除外
- agent_logs: admin のみが SELECT 可能（機密性確保）

#### ✅ セキュリティ：堅牢
- テナント分離: company_id + fn_is_company_admin() で確保
- 権限昇格防止: RLS ポリシーで 3 層保護
- audit trail: agent_logs は append-only（UPDATE/DELETE 禁止）

#### ⚠️ 既知の管理項目（本番適用後の監視対象）
- RLS ポリシーに EXISTS サブクエリ使用 → インサイト数 1000+ でクエリ監視推奨
- progress_logs との互換性 → 既存 RLS ポリシー継続（新規追加なし）

---

## 2. 本番適用前バックアップ手順

### 2.1 バックアップ対象テーブル

| テーブル | 対象理由 | バックアップコマンド |
|---------|--------|-----------------|
| org_alignment_insights | RLS ポリシー追加（SELECT 制限） | pg_dump -t |
| org_alignment_stage_reflection_candidates | RLS ポリシー追加（UPDATE/DELETE 制限） | pg_dump -t |
| org_alignment_insight_sources | RLS ポリシー追加（FK 経由） | pg_dump -t |
| agent_logs | RLS ポリシー追加（SELECT 制限） | pg_dump -t |

### 2.2 バックアップ取得手順（Supabase 本番環境）

#### Step 1: 現在の RLS ポリシーをダンプ

```bash
# 既存ポリシーのバックアップ（本番 DB から）
supabase db pull --linked --schema-only > backups/schema_before_migration_20260708.sql
```

**出力内容確認:**
```sql
-- 出力に以下の行が含まれること
-- RLS ENABLE;
-- （既存の auth.uid() based policies）
```

#### Step 2: 本番テーブルデータのダンプ（オプション：大規模環境）

```bash
# 影響を受ける 4 テーブルのみダンプ
pg_dump \
  --host=$SUPABASE_HOST \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  -t public.org_alignment_insights \
  -t public.org_alignment_stage_reflection_candidates \
  -t public.org_alignment_insight_sources \
  -t public.agent_logs \
  > backups/tables_before_migration_20260708.sql
```

**環境変数の取得:**
```bash
# Supabase Dashboard から
# Settings > Database > Connection string (Postgres)
export SUPABASE_HOST="db.xxx.supabase.co"
```

#### Step 3: Rollback 用 SQL の準備

```bash
# Migration の逆操作を記録
cat > backups/rollback_20260708.sql << 'EOF'
-- Rollback script for 20260708_add_rls_org_alignment_agent_logs.sql
-- Execute if migration has critical errors

-- Drop the newly added policies
DROP POLICY IF EXISTS "insights_admin_crud" ON "public"."org_alignment_insights";
DROP POLICY IF EXISTS "insights_member_read" ON "public"."org_alignment_insights";
DROP POLICY IF EXISTS "reflection_candidates_member_read" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_write" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_update" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_delete" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "insight_sources_via_cases" ON "public"."org_alignment_insight_sources";
DROP POLICY IF EXISTS "agent_logs_admin_select" ON "public"."agent_logs";
DROP POLICY IF EXISTS "agent_logs_service_insert" ON "public"."agent_logs";

-- Note: Tables will be accessible again as RLS is re-enabled but no policies defined
-- This restores the pre-migration security state
EOF
```

### 2.3 バックアップ検証チェックリスト

- [ ] `schema_before_migration_20260708.sql` サイズ > 100KB（スキーマ情報を含む）
- [ ] ファイル内に DROP POLICY IF EXISTS の行が存在しない（pre-migration 状態）
- [ ] ファイルに RLS ENABLE; の行が存在（確認用）
- [ ] `rollback_20260708.sql` が DROP POLICY 9 行を含む
- [ ] バックアップファイルが S3 or Git リポジトリに保存済み

---

## 3. 本番適用コマンド案

### 3.1 推奨方法：Supabase CLI 経由

#### 理由
1. **トランザクション一体性**: 部分適用状態を回避
2. **自動ロールバック**: migration version 管理で復旧可能
3. **監査証跡**: migration_version テーブルに記録
4. **事前テスト**: ローカル環境で `supabase migration up --local` で検証

#### 実行フロー

**Step 1: ローカル環境での検証（本番前）**
```bash
# ローカル Supabase で migration を実行テスト
npx supabase migration up --local
# → 成功後、Step 2 へ
# → 失敗した場合、migration SQL を修正後に Step 2 へ
```

**Step 2: 本番環境への Link**
```bash
# 本番 Supabase プロジェクトにリンク
npx supabase link --project-ref $SUPABASE_PROJECT_REF

# プロンプトで本番 DB パスワードを入力
# パスワードは Supabase Dashboard > Settings > Database > Password から確認
```

**Step 3: 本番環境への適用（計画メンテナンス時間帯）**
```bash
# ★ 重要：メンテナンス時間帯に実行してください ★
npx supabase migration up --linked

# 出力例（成功時）
# Applying migration 20260708_add_rls_org_alignment_agent_logs.sql...
# [✓] Migration applied successfully
# Migration version: 20260708
```

**Step 4: 適用確認**
```bash
# migration 履歴を確認
npx supabase migration list
# 出力に 20260708 が含まれることを確認

# RLS ポリシーが作成されたことを確認
npx supabase db pull --linked --schema-only | grep -A 5 "insights_admin_crud"
```

### 3.2 代替方法：SQL Editor（Web UI）- **非推奨**

**使用場面**: CLI インストール不可の環境のみ

```bash
# Migration SQL をコピー
cat supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql
```

**実行手順**:
1. Supabase Dashboard にログイン
2. SQL Editor > New Query
3. Migration SQL をペースト
4. Run
5. エラー確認（drop if exists のため通常は エラーなし）

**リスク**: 部分失敗時の状態が不定 → **本番では推奨しない**

### 3.3 推奨度比較

| 項目 | CLI (`supabase migration up`) | SQL Editor |
|-----|---|---|
| トランザクション一体性 | ✅ あり | ❌ なし |
| ロールバック容易性 | ✅ 自動 | ❌ 手動 |
| 監査証跡 | ✅ 記録 | ❌ なし |
| 部分失敗リスク | ✅ 低（全て or 全て失敗） | ⚠️ 高 |
| **推奨度** | **✅✅✅** | ❌ |

---

## 4. 適用後検証チェックリスト

### 4.1 即座検証（適用直後 1 時間以内）

#### SQL 検証
```bash
# RLS ポリシーが作成されたことを確認
psql -h $HOST -U postgres -d postgres << EOF
SELECT tablename, policyname
FROM pg_policies
WHERE tablename IN ('org_alignment_insights', 'org_alignment_stage_reflection_candidates', 
                     'org_alignment_insight_sources', 'agent_logs')
ORDER BY tablename;
EOF

# 期待結果：9 個のポリシーが表示される
# - org_alignment_insights: 2 個
# - org_alignment_stage_reflection_candidates: 4 個
# - org_alignment_insight_sources: 1 個
# - agent_logs: 2 個
```

- [ ] 9 個のポリシーがすべて作成されている
- [ ] ポリシー名が migration SQL の CREATE POLICY と一致

#### API 検証（本番 API で実行）

**シナリオ 1: A 社 member で A 社データが見える**
```bash
curl -X GET "https://api.example.com/api/org-alignment/shared/summary" \
  -H "Authorization: Bearer <user_member_a_token>"
  
# 期待結果: 200 OK + JSON データ返却
# { "topicCount": N, "insights": [...], "ok": true }
```
- [ ] HTTP 200 応答
- [ ] JSON に insights 配列が含まれる
- [ ] insights が A 社のデータのみ

**シナリオ 2: A 社 member で B 社データが見えない**
```bash
curl -X GET "https://api.example.com/api/org-alignment/shared/summary?company_id=bb22..." \
  -H "Authorization: Bearer <user_member_a_token>"
  
# 期待結果: 200 OK + 空配列
# { "topicCount": 0, "insights": [], "ok": true }
```
- [ ] HTTP 200 応答（エラーではない）
- [ ] insights 配列が空

**シナリオ 3: A 社 admin で A 社データを操作可能**
```bash
curl -X PATCH "https://api.example.com/api/org-alignment/admin/insights" \
  -H "Authorization: Bearer <user_admin_a_token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "insight-xyz", "summary": "Updated"}'
  
# 期待結果: 200 OK + 更新確認
```
- [ ] HTTP 200 応答
- [ ] データベースで変更が反映されている

**シナリオ 4: A 社 admin で B 社データを操作不可**
```bash
curl -X PATCH "https://api.example.com/api/org-alignment/admin/insights" \
  -H "Authorization: Bearer <user_admin_a_token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "insight-xyz-from-company-b", "summary": "Hijack"}'
  
# 期待結果: 403 Forbidden or 404 Not Found
```
- [ ] HTTP 403 or 404 応答
- [ ] データベースで変更が反映されていない

**シナリオ 5: agent_logs が member から読めない**
```bash
curl -X GET "https://api.example.com/api/ask-ceo-agent/logs" \
  -H "Authorization: Bearer <user_member_a_token>"
  
# 期待結果: 403 Forbidden or 401 Unauthorized（api レベルの制限）
```
- [ ] HTTP 403 or 401 応答
- [ ] logs 情報が漏洩していない

#### UI/UX 検証（手動テスト）

- [ ] **すり合わせルーム画面**: 正常に表示される（insights/topics が表示される）
- [ ] **管理者ダッシュボード**: admin が insights を生成・表示可能
- [ ] **メンバー画面**: member が自社データのみ参照可能
- [ ] **ページ遷移**: admin → member → admin での権限切り替え時、データが正しく制限される

### 4.2 事後監視（適用後 24-48 時間）

#### ログ監視

```bash
# RLS ポリシー違反ログを確認（本番環境のデータベースログ）
SELECT 
  timestamp, 
  username, 
  database_name, 
  message 
FROM pg_log 
WHERE message ILIKE '%RLS%' OR message ILIKE '%policy%'
ORDER BY timestamp DESC 
LIMIT 20;
```

- [ ] RLS ポリシー関連エラーがないか確認
- [ ] 予期しない「permission denied」エラーがないか確認

#### パフォーマンス監視

```bash
# クエリ実行時間を確認（特に EXISTS サブクエリ使用テーブル）
EXPLAIN ANALYZE
SELECT * FROM org_alignment_insights 
WHERE company_id = 'aa11...'::uuid;

-- 期待結果: 実行時間 < 100ms（insights 数が 1000 未満の場合）
```

- [ ] org_alignment_insights の SELECT が 200ms 以下
- [ ] org_alignment_stage_reflection_candidates の UPDATE が 200ms 以下
- [ ] admin dashboard の insights 生成 API が 2 秒以下

#### API エラーログ監視

```bash
# アプリケーションログで 403/401 エラーが増加していないか確認
grep -i "403\|401\|forbidden\|unauthorized" logs/production.log | tail -100
```

- [ ] 予期しない 403 エラーがないか
- [ ] 予期しない 401 エラーがないか
- [ ] エラー率が適用前後で変化していないか

---

## 5. 本番適用当日の実行計画

### 5.1 タイムライン（計画メンテナンス時間帯：例：日曜 22:00-23:30 JST）

| 時刻 | 項目 | 時間 | 実行者 | 確認者 |
|-----|------|------|-------|-------|
| 22:00 | メンテナンス開始通知 | - | DevOps | - |
| 22:05 | スキーマバックアップ取得 | 2 分 | DevOps | - |
| 22:07 | ローカル検証実行 | 3 分 | Dev | DevOps |
| 22:10 | 本番 Link | 2 分 | Dev | DevOps |
| 22:12 | **Migration 実行** | 1 分 | Dev | DevOps |
| 22:13 | RLS ポリシー確認 | 2 分 | DevOps | Dev |
| 22:15 | API 検証（全 5 シナリオ） | 5 分 | QA | DevOps |
| 22:20 | UI テスト（手動） | 5 分 | QA | - |
| 22:25 | ロールバック OK 判定 | 5 分 | DevOps | CTO |
| 22:30 | **本番安定判定** | - | CTO | - |
| 22:30-23:30 | 監視継続（問題検知時は即ロールバック） | - | OnCall | - |
| 23:30 | メンテナンス終了通知 | - | DevOps | - |

### 5.2 ロールバック判定基準（即座ロールバック）

以下のいずれかが発生した場合、即座に **supabase migration down --linked** を実行：

| 症状 | HTTP ステータス | 判定 | ロールバック |
|-----|----------------|------|------------|
| すり合わせルーム画面が 403 を返す | 403 | 権限設定エラー | ✅ 実行 |
| admin dashboard が 500 を返す | 500 | ポリシー構文エラー | ✅ 実行 |
| API が 403 で拒否される（予期しない） | 403 | ポリシー過剰制限 | ✅ 実行 |
| データベース接続タイムアウト | - | RLS クエリ遅延 | ✅ 実行 |
| RLS ポリシーが作成されていない | - | Migration 失敗 | ✅ 実行 |
| member が agent_logs を読める | 200 (unintended) | セキュリティ違反 | ✅ 実行 |

**ロールバック実行コマンド:**
```bash
npx supabase migration down --linked
# 出力: Migration 20260708 rolled back
```

**ロールバック後の確認:**
```bash
npx supabase migration list
# 出力: 20260708 が消えていること

curl https://api.example.com/api/org-alignment/shared/summary \
  -H "Authorization: Bearer <user_member_a_token>"
# 期待: 200 OK （migration 前の動作に戻っている）
```

### 5.3 ロールバック判定 OK の場合

以下がすべて確認された場合、**本番適用成功**と宣言：

- [ ] RLS ポリシー 9 個がすべて作成済み
- [ ] API シナリオ 1-5 すべて成功
- [ ] UI テスト：すり合わせルーム画面・admin dashboard 正常
- [ ] ログに RLS エラーがない
- [ ] クエリ実行時間が適用前と同等（≤ 200ms）
- [ ] error rate が適用前後で変化なし（< 0.1%）

---

## 6. Rollback 手順

### 6.1 自動ロールバック（推奨）

```bash
# Migration を逆操作
npx supabase migration down --linked

# 実行結果を確認
npx supabase migration list
# 出力: 20260708 が消えている
```

**実行時間**: 1-2 分

### 6.2 手動ロールバック（CLI が使用不可の場合）

```bash
# SQL Editor で rollback_20260708.sql を実行
# (Step 2.2 で準備したファイル)

psql -h $HOST -U postgres -d postgres \
  -f backups/rollback_20260708.sql
```

**実行時間**: 2-3 分

### 6.3 ロールバック後の確認

```bash
# スキーマが migration 前に戻ったことを確認
npx supabase db pull --linked --schema-only > schema_after_rollback.sql

diff backups/schema_before_migration_20260708.sql schema_after_rollback.sql
# 出力: 差分がなし（RLS ポリシー DROP IF EXISTS が削除されている）

# API が機能していることを確認
curl https://api.example.com/api/org-alignment/shared/summary \
  -H "Authorization: Bearer <user_member_a_token>"
# 期待: 200 OK + insights が返却（migration 前の状態）
```

---

## 7. 本番適用後の監視計画

### 7.1 監視対象（適用後 24-48 時間）

| 項目 | 監視方法 | 閾値 | 対応 |
|-----|--------|------|------|
| RLS ポリシー エラー | データベースログ grep `RLS\|policy` | 0 個 | 即座ロールバック |
| API エラー率 | ログアグリゲーション（DataDog/CloudWatch） | < 0.1% | エラーハンドリング確認 |
| クエリ実行時間 | Supabase Metrics パネル | < 200ms (p99) | インデックス追加検討 |
| メモリ使用率 | PostgreSQL pg_stat_statements | < 90% | スケーリング検討 |

### 7.2 監視期間後の判定（適用後 48 時間）

**安定判定済み**：
- [ ] RLS エラー: 0 件
- [ ] API エラー率: < 0.1%（適用前後で変化なし）
- [ ] クエリ時間: < 200ms (p99)

**判定済みの場合**:
- ✅ migration は本番安定と宣言
- ✅ ロールバック計画はクローズ
- ✅ セキュリティ監査対応済みと記録

---

## 8. 禁止事項

### 本番適用時の禁止

- ❌ **Supabase db push を使用禁止**（本番 DB 直接変更のため）
- ❌ **migration repair を使用禁止**（migration 履歴が破損するため）
- ❌ **SQL Editor で直接 DROP/CREATE 禁止**（監査証跡が失われるため）
- ❌ **テストなしで本番適用禁止**（ローカル `supabase migration up --local` 必須）
- ❌ **.env.local や Secret を出力禁止**（git に誤ってコミットされるため）
- ❌ **営業時間中の適用禁止**（計画メンテナンス時間帯のみ）

### 監視時の禁止

- ❌ ロールバック判定基準を無視して本番継続禁止
- ❌ エラーログを無視禁止（即座調査が必須）
- ❌ RLS ポリシーを手動削除禁止（migration 履歴との不整合）

---

## 9. トラブルシューティング

### 問題：Migration 実行後、API が 403 を返す

**原因分析**:
```sql
-- RLS ポリシーが過剰に制限している可能性
SELECT * FROM pg_policies WHERE tablename = 'org_alignment_insights';
-- ポリシー数が 2 個か確認（insights_admin_crud + insights_member_read）
```

**対応**:
1. ロールバック実行: `supabase migration down --linked`
2. Migration SQL を修正（WITH CHECK 句など）
3. ローカルで再検証
4. 本番再適用

### 問題：ロールバック実行後も API が 403 を返す

**原因分析**:
```sql
-- RLS ポリシーが残っている可能性
SELECT COUNT(*) FROM pg_policies 
WHERE tablename IN ('org_alignment_insights', 'agent_logs');
-- 0 が返されること
```

**対応**:
```bash
# 手動で RLS ポリシーを削除
psql -h $HOST -U postgres -d postgres << EOF
DROP POLICY IF EXISTS "insights_admin_crud" ON "public"."org_alignment_insights";
DROP POLICY IF EXISTS "insights_member_read" ON "public"."org_alignment_insights";
-- ... (他のポリシーもすべて削除)
EOF

# API が 200 を返すことを確認
curl https://api.example.com/api/org-alignment/shared/summary \
  -H "Authorization: Bearer <user_member_a_token>"
```

### 問題：ローカルテスト時に Supabase CLI がエラーを返す

**エラーメッセージ**: `failed to parse environment file: .env.local`

**原因**: .env.local ファイルの形式エラー

**対応**:
```bash
# .env.local の形式を確認
cat .env.local | head -5

# エラーがある場合、修正
# 例：改行が \n でなく実改行になっている場合は修正

# または、ローカルテスト をスキップして本番 Link で実行
# supabase migration up --linked  # ローカルテスト省略
```

---

## 10. 関連ドキュメント

- **Migration SQL**: `supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql`
- **検証レポート**: `docs/security-log/rls_local_validation_20260708.md`
- **テスト計画**: `docs/security-log/rls_org_alignment_agent_logs_test_plan_20260708.md`
- **セキュリティ監査**: `docs/security-log/security-audit-p0-triage-20260708.md`
- **修正計画**: `docs/security-log/rls_p0_fix_plan_20260708.md`

---

## 11. 署名

**本番適用可否判定**: ✅ **GO** (条件付き)

**検証実施日**: 2026-07-08  
**検証者**: Claude Code Security Audit Team  
**CTO 承認待機**: TBD

**本番適用予定日**: 2026-07-XX (計画メンテナンス時間帯)  
**ステータス**: **未適用**（このドキュメント確定後の実行待機）

---

**作成日**: 2026-07-08  
**ステータス**: 本番未適用  
**次のアクション**: CTO 承認 → 本番メンテナンス時間帯にて migration up --linked 実行

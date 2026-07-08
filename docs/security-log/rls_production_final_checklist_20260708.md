# RLS 本番適用 最終チェックリスト

**実施日**: 2026-07-08  
**対象**: org_alignment（3テーブル）と agent_logs の RLS ポリシー migration  
**実行方法**: Supabase SQL Editor での直接実行

---

## 実行前チェック

### 計画メンテナンス確認

- [ ] メンテナンス時間帯の設定完了（例：日曜 22:00-23:30 JST）
- [ ] 関係者への通知完了（DevOps/QA/CTO）
- [ ] ロールバック対応者がスタンバイ
- [ ] 監視ツール（ログアグリゲーション、メトリクス）が稼働中

### SQL ファイル確認

- [ ] `rls_production_execute_sql_20260708.sql` を 2 回確認
  - [ ] BEGIN; ... COMMIT; で囲まれている
  - [ ] DROP POLICY IF EXISTS が全 12 個のポリシー削除対象
  - [ ] CREATE POLICY が全 12 個のポリシー作成対象
  - [ ] org_alignment_insight_sources に FOR SELECT (read) + admin 専用 (write) policies
  - [ ] コメント（説明文）が最小限
- [ ] `rls_production_verify_sql_20260708.sql` を確認
  - [ ] ポリシー作成数カウント（期待値：9）
  - [ ] ポリシー名一覧（個人情報なし）
  - [ ] RLS 有効状態確認（期待値：true）
  - [ ] ヘルパー関数確認（fn_is_company_admin, fn_company_role）
- [ ] `rls_production_rollback_sql_20260708.sql` を確認
  - [ ] DROP POLICY のみ（テーブル削除なし）
  - [ ] RLS disable なし
  - [ ] 全 12 個の DROP POLICY IF EXISTS

### 環境確認

- [ ] Supabase Dashboard にログイン可能
- [ ] 本番プロジェクトが正しく選択されている
- [ ] SQL Editor アクセス可能
- [ ] ネットワーク接続が安定している

### バックアップ確認

- [ ] `supabase db pull --linked --schema-only > backups/schema_before_migration_20260708.sql` 実行済み
- [ ] バックアップファイルサイズ > 100KB（スキーマ情報含む）
- [ ] `rollback_20260708.sql` がバックアップディレクトリに保存済み

### Migration 履歴確認

- [ ] 本番 DB で以下を実行して未適用を確認
  ```sql
  SELECT * FROM migrations
  WHERE name = '20260708_add_rls_org_alignment_agent_logs';
  ```
- [ ] 結果：0 rows（未適用が確認された）
  - [ ] Case 1: 未適用 → 上記チェック項目完了で実行準備 OK
  - [ ] Case 2: 既適用 → ⚠️ 実行スキップ、ポリシー確認へ進む

---

## 実行手順（メンテナンス時間帯）

### Step 1: SQL Editor で実行

- [ ] **時刻**: 計画メンテナンス開始時刻（例：22:10）
- [ ] Supabase Dashboard > SQL Editor > New Query を開く
- [ ] `rls_production_execute_sql_20260708.sql` のすべてのコンテンツをコピー
- [ ] SQL Editor にペースト
- [ ] **Run** ボタンをクリック

**期待結果**:
```
Query executed successfully
```

**エラー発生時**:
- [ ] エラーメッセージをスクリーンショット（証跡）
- [ ] ロールバック判定セクションへ進む

### Step 2: ポリシー作成確認

- [ ] 時刻: 実行直後（22:11）
- [ ] Supabase Dashboard > SQL Editor > New Query を開く
- [ ] `rls_production_verify_sql_20260708.sql` のすべてのコンテンツをコピー
- [ ] SQL Editor にペースト
- [ ] **Run** ボタンをクリック

**期待結果：セクション別確認**

#### 1. Total policy count
```
total_policy_count
       12
```
- [ ] 結果が 12 であることを確認

#### 2. Policies by table
```
tablename | policyname | ...
```
- [ ] org_alignment_insights: 2 個
  - [ ] insights_admin_crud
  - [ ] insights_member_read
- [ ] org_alignment_stage_reflection_candidates: 4 個
  - [ ] reflection_candidates_member_read
  - [ ] reflection_candidates_admin_write
  - [ ] reflection_candidates_admin_update
  - [ ] reflection_candidates_admin_delete
- [ ] org_alignment_insight_sources: 4 個（追加：4つの個別ポリシー）
  - [ ] insight_sources_member_read (read-only)
  - [ ] insight_sources_admin_write (admin write)
  - [ ] insight_sources_admin_update (admin write)
  - [ ] insight_sources_admin_delete (admin write)
- [ ] agent_logs: 2 個
  - [ ] agent_logs_admin_select
  - [ ] agent_logs_service_role_insert

#### 3. RLS enabled on target tables
```
tablename | rls_enabled
```
- [ ] すべての 4 テーブルで rls_enabled = true

#### 4. Helper functions exist
```
routine_name | routine_type
```
- [ ] fn_is_company_admin (FUNCTION)
- [ ] fn_company_role (FUNCTION)

#### 5. Quick policy summary
```
table_name | expected | actual
```
- [ ] すべての行で expected = actual

---

## 実行後検証（API・UI テスト）

### API シナリオテスト

#### シナリオ 1: A 社 member で A 社データが見える
- [ ] テスト実行
- [ ] 結果：200 OK + insights 配列が返却
- [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

#### シナリオ 2: A 社 member で B 社データが見えない
- [ ] テスト実行
- [ ] 結果：200 OK + insights 配列が空（0 rows）
- [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

#### シナリオ 3: A 社 admin で A 社データを操作可能
- [ ] UPDATE テスト実行
- [ ] 結果：200 OK + データ更新確認
- [ ] DELETE テスト実行
- [ ] 結果：200 OK + データ削除確認
- [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

#### シナリオ 4: A 社 admin で B 社データを操作不可
- [ ] UPDATE テスト実行
- [ ] 結果：403 Forbidden または 404 Not Found
- [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

#### シナリオ 5: agent_logs が member から読めない
- [ ] SELECT テスト実行
- [ ] 結果：403 Forbidden または 401 Unauthorized
- [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

### UI 機能テスト

- [ ] **すり合わせルーム画面**: 正常に表示される
  - [ ] insights が表示されている
  - [ ] API エラーが出ていない
  - [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

- [ ] **管理者ダッシュボード**: 正常に表示される
  - [ ] insights 生成ボタンが動作
  - [ ] insights リストが表示
  - [ ] API エラーが出ていない
  - [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

- [ ] **メンバーアクセス制限**: member が不正なデータを見られない
  - [ ] 他社のデータが非表示
  - [ ] 記録：実行時刻 __:__、結果 ✅ / ❌

---

## ロールバック判断基準

### 即座ロールバック対象（エラー発生時）

以下のいずれかが発生した場合、**直ちにロールバック実行**：

| 症状 | 判断基準 | ロールバック |
|-----|--------|------------|
| SQL 実行エラー | Query execution failed | ✅ 実行 |
| ポリシー作成失敗 | total_policy_count ≠ 9 | ✅ 実行 |
| RLS 有効状態エラー | rls_enabled ≠ true | ✅ 実行 |
| API 403 エラー（予期しない） | member で 403 返却 | ✅ 実行 |
| API 500 エラー | backend エラー | ✅ 実行 |
| すり合わせルーム画面が 403 | 画面表示失敗 | ✅ 実行 |
| admin dashboard が表示失敗 | 500 エラー | ✅ 実行 |

### ロールバック実行（メンテナンス時間帯内）

- [ ] **時刻**: 問題検知時刻（__:__）
- [ ] Supabase Dashboard > SQL Editor > New Query を開く
- [ ] `rls_production_rollback_sql_20260708.sql` のすべてのコンテンツをコピー
- [ ] SQL Editor にペースト
- [ ] **Run** ボタンをクリック

**期待結果**:
```
Query executed successfully
```

### ロールバック後の確認

- [ ] 以下を SQL Editor で実行してポリシーが削除されたことを確認
  ```sql
  SELECT COUNT(*) as policy_count
  FROM pg_policies
  WHERE tablename IN ('org_alignment_insights', 'org_alignment_stage_reflection_candidates', 'org_alignment_insight_sources', 'agent_logs');
  ```
- [ ] 結果：0（すべての 12 ポリシーが削除された）
- [ ] API テストで 200 OK が返されることを確認

---

## 本番適用状況記録

### 適用実行

**実行日時**: 202X-XX-XX XX:XX JST  
**実行者**: ________________  
**確認者**: ________________  

**実行結果**:
- [ ] ✅ 成功（すべてのチェック項目クリア）
- [ ] ❌ ロールバック実行（理由：_________________）

### 成功時の最終判定

以下すべてがクリアされた場合、**本番適用完了**と宣言：

- [ ] SQL 実行が成功（エラーなし）
- [ ] ポリシー 12 個が正しく作成された
- [ ] RLS 有効状態が確認できた
- [ ] API シナリオ 5 つすべてが期待結果
- [ ] UI テストで画面が正常表示

**本番適用判定**: ✅ **成功** / ❌ **ロールバック** / ⏳ **再試行予定**

### ロールバック時の記録

**ロールバック実行日時**: 202X-XX-XX XX:XX JST  
**ロールバック実行者**: ________________  
**ロールバック理由**: ________________  

**ロールバック結果**:
- [ ] ポリシー削除成功（0 ポリシー残存）
- [ ] API テスト成功（200 OK 返却）
- [ ] pre-migration 状態に復旧確認

**再試行計画**: ________________

---

## 事後監視（24-48 時間）

**適用完了後、以下を監視**:

### ログ監視

- [ ] RLS ポリシー関連エラーがないか確認
  - [ ] データベースログで「RLS」「policy」キーワードを検索
  - [ ] 予期しないエラーがないこと
- [ ] API エラーレートに異常がないか確認
  - [ ] 適用前後で error rate が変動していないこと（< 0.1%）

### パフォーマンス監視

- [ ] クエリ実行時間が適用前と同等か確認
  - [ ] org_alignment_insights SELECT: < 200ms (p99)
  - [ ] reflection_candidates UPDATE: < 200ms (p99)

### 機能監視

- [ ] すり合わせルーム画面が継続して正常に動作
- [ ] admin dashboard が継続して正常に動作

**監視結果記録**:

| 項目 | 適用 24h 後 | 適用 48h 後 | 判定 |
|-----|-----------|-----------|------|
| RLS エラー数 | __ | __ | ✅ / ⚠️ |
| API error rate | __% | __% | ✅ / ⚠️ |
| クエリ時間 (p99) | __ms | __ms | ✅ / ⚠️ |
| すり合わせルーム | OK / NG | OK / NG | ✅ / ⚠️ |
| admin dashboard | OK / NG | OK / NG | ✅ / ⚠️ |

**最終判定**: ✅ **本番安定** / ⚠️ **要監視** / ❌ **問題発生**

---

## チェックリスト完了

**チェックリスト確認者**: ________________  
**確認日時**: 202X-XX-XX XX:XX  

**石原さんによる最終実行判断**: ✅ **実行可能** / ❌ **実行延期** / ⚠️ **条件付き実行**

**判断日時**: 202X-XX-XX XX:XX  
**署名**: ________________  

---

**このチェックリストは本番適用時の唯一の正式なレコードです。**  
**すべての項目を確認して石原さんの判断を記入してください。**
